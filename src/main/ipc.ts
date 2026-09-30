import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  IpcChannels,
  SENSITIVITIES,
  type AppInfo,
  type ExportFormat,
  type IpcResult,
  type Project,
  type ProjectSummary,
  type Sensitivity,
} from '../shared/ipc';
import { isInstrumentId } from '../shared/instruments';
import * as projects from './projects';
import * as transcription from './transcription/service';

const EXPORT_FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  midi: { name: 'MIDI file', extensions: ['mid'] },
  gp: { name: 'Guitar Pro 7', extensions: ['gp'] },
  alphatex: { name: 'alphaTex', extensions: ['alphatex', 'txt'] },
};
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

const fail = (code: 'invalid' | 'not-found' | 'failed', message: string) => ({ ok: false, error: { code, message } }) as const;

/** Rejects IPC calls from anything other than our own renderer (e.g. an injected iframe). */
function assertTrustedSender(event: IpcMainInvokeEvent, isTrustedUrl: (url: string) => boolean): void {
  const url = event.senderFrame?.url;
  if (!url || !isTrustedUrl(url)) {
    throw new Error(`Blocked IPC call from untrusted sender: ${url ?? 'unknown'}`);
  }
}

export function registerIpcHandlers(isTrustedUrl: (url: string) => boolean): void {
  // Every handler validates the sender first, then treats its arguments as untrusted input.
  const handle = <Args extends unknown[], R>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: Args) => R) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, isTrustedUrl);
      return handler(event, ...(args as Args));
    });

  handle(IpcChannels.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  handle(IpcChannels.transcribe, async (event, payload: unknown): Promise<IpcResult<ProjectSummary>> => {
    const { path: inputPath, instrument, sensitivity } = (payload ?? {}) as Record<string, unknown>;
    if (
      typeof inputPath !== 'string' || !path.isAbsolute(inputPath) ||
      !isInstrumentId(instrument) || !SENSITIVITIES.includes(sensitivity as never)
    ) {
      return fail('invalid', 'Please choose an audio or video file from your computer.');
    }
    const isFile = await stat(inputPath).then((s) => s.isFile(), () => false);
    if (!isFile) return fail('not-found', 'The selected file could not be found.');

    const sendProgress = (progress: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.transcriptionProgress, progress);
    };
    const result = await transcription.transcribe(inputPath, instrument, sensitivity as Sensitivity, sendProgress);
    if (!result.ok) return result;

    sendProgress({ stage: 'saving', fraction: 0 });
    const summary = await projects.createProject({ sourcePath: inputPath, instrument, ...result.value });
    return { ok: true, value: summary };
  });

  handle(IpcChannels.cancelTranscription, () => transcription.cancelTranscription());

  handle(IpcChannels.listProjects, () => projects.listProjects());

  handle(IpcChannels.getProject, async (_event, id: unknown): Promise<IpcResult<Project>> => {
    const project = typeof id === 'string' ? await projects.getProject(id) : null;
    return project ? { ok: true, value: project } : fail('not-found', 'This project no longer exists.');
  });

  handle(IpcChannels.updateProjectSettings, async (_event, id: unknown, settings: unknown): Promise<IpcResult<ProjectSummary>> => {
    if (typeof id !== 'string' || !projects.isValidSettings(settings)) return fail('invalid', 'Invalid project settings.');
    const summary = await projects.updateProjectSettings(id, settings);
    return summary ? { ok: true, value: summary } : fail('not-found', 'This project no longer exists.');
  });

  handle(IpcChannels.deleteProject, async (_event, id: unknown): Promise<IpcResult<void>> => {
    const deleted = typeof id === 'string' && (await projects.deleteProject(id));
    return deleted ? { ok: true, value: undefined } : fail('not-found', 'This project no longer exists.');
  });

  handle(IpcChannels.exportFile, async (event, payload: unknown): Promise<IpcResult<string | null>> => {
    const { format, suggestedName, data } = (payload ?? {}) as Record<string, unknown>;
    if (
      typeof format !== 'string' || !(format in EXPORT_FILTERS) ||
      typeof suggestedName !== 'string' ||
      !(data instanceof Uint8Array) || data.byteLength > MAX_EXPORT_BYTES
    ) {
      return fail('invalid', 'Invalid export request.');
    }
    const filter = EXPORT_FILTERS[format as ExportFormat];
    // Strip characters that are invalid in file names on Windows/macOS/Linux, including control characters.
    // eslint-disable-next-line no-control-regex
    const safeName = suggestedName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'tabello';
    const options: Electron.SaveDialogOptions = {
      title: 'Export',
      defaultPath: path.join(app.getPath('documents'), `${safeName}.${filter.extensions[0]}`),
      filters: [filter],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (canceled || !filePath) return { ok: true, value: null };
    try {
      await writeFile(filePath, data);
      return { ok: true, value: filePath };
    } catch (error) {
      return fail('failed', `Could not save the file: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
