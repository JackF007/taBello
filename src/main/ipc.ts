import { app, BrowserWindow, dialog, ipcMain, net, type IpcMainInvokeEvent } from 'electron';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  IpcChannels,
  SENSITIVITIES,
  type AppInfo,
  type ExportFormat,
  type IpcResult,
  type NoteEvent,
  type Project,
  type ProjectSummary,
  type SeparationModelStatus,
  type Sensitivity,
} from '../shared/ipc';
import { isInstrumentId, type InstrumentId } from '../shared/instruments';
import { getSample } from '../shared/samples';
import * as separationModel from './separation/model';
import * as projects from './projects';
import * as transcription from './transcription/service';

const EXPORT_FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  midi: { name: 'MIDI file', extensions: ['mid'] },
  gp: { name: 'Guitar Pro 7', extensions: ['gp'] },
  alphatex: { name: 'alphaTex', extensions: ['alphatex', 'txt'] },
};
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

const fail = (code: 'invalid' | 'not-found' | 'failed' | 'cancelled', message: string) => ({ ok: false, error: { code, message } }) as const;

/** Where the separation model is kept (see separation/model.ts). */
const modelDir = () => path.join(app.getPath('userData'), 'models');

/** Bundled sample recordings: next to the app when packaged, in resources/ when run from source. */
const samplesDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'samples') : path.join(app.getAppPath(), 'resources', 'samples'));

async function separationStatus(): Promise<SeparationModelStatus> {
  return {
    installed: await separationModel.isModelInstalled(modelDir()),
    downloadBytes: separationModel.MODEL_SOURCE.downloadBytes,
    sizeBytes: separationModel.MODEL_SOURCE.bytes,
  };
}

let modelDownload: AbortController | null = null;

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

  /** Transcribes a file and saves the result as a project; progress goes to the calling window. */
  const runTranscription = async (
    event: IpcMainInvokeEvent,
    job: { inputPath: string; instrument: InstrumentId; sensitivity: Sensitivity; isolate: boolean; title?: string },
  ): Promise<IpcResult<ProjectSummary>> => {
    const sendProgress = (progress: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.transcriptionProgress, progress);
    };
    let separation: transcription.SeparationJob | undefined;
    if (job.isolate) {
      if (!(await separationModel.isModelInstalled(modelDir()))) {
        return fail('invalid', 'Download the separation model first, or turn off "Isolate".');
      }
      // Demucs separates bass, drums, vocals and "other": guitars and ukuleles are in "other".
      separation = { modelPath: path.join(modelDir(), separationModel.MODEL_FILE), source: job.instrument === 'bass' ? 'bass' : 'other' };
    }
    const result = await transcription.transcribe(job.inputPath, job.instrument, job.sensitivity, sendProgress, separation);
    if (!result.ok) return result;

    sendProgress({ stage: 'saving', fraction: 0 });
    const summary = await projects.createProject({
      sourcePath: job.inputPath,
      instrument: job.instrument,
      title: job.title,
      isolated: job.isolate,
      ...result.value,
    });
    return { ok: true, value: summary };
  };

  const validRequest = (instrument: unknown, sensitivity: unknown, isolate: unknown) =>
    isInstrumentId(instrument) && SENSITIVITIES.includes(sensitivity as never) && (isolate === undefined || typeof isolate === 'boolean');

  handle(IpcChannels.transcribe, async (event, payload: unknown): Promise<IpcResult<ProjectSummary>> => {
    const { path: inputPath, instrument, sensitivity, isolate } = (payload ?? {}) as Record<string, unknown>;
    if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath) || !validRequest(instrument, sensitivity, isolate)) {
      return fail('invalid', 'Please choose an audio or video file from your computer.');
    }
    const isFile = await stat(inputPath).then((s) => s.isFile(), () => false);
    if (!isFile) return fail('not-found', 'The selected file could not be found.');
    return runTranscription(event, {
      inputPath,
      instrument: instrument as InstrumentId,
      sensitivity: sensitivity as Sensitivity,
      isolate: isolate === true,
    });
  });

  handle(IpcChannels.transcribeSample, async (event, sampleId: unknown, payload: unknown): Promise<IpcResult<ProjectSummary>> => {
    const sample = getSample(sampleId);
    const { instrument, sensitivity, isolate } = (payload ?? {}) as Record<string, unknown>;
    if (!sample || !validRequest(instrument, sensitivity, isolate)) return fail('invalid', 'Unknown sample.');
    const inputPath = path.join(samplesDir(), sample.file);
    const isFile = await stat(inputPath).then((s) => s.isFile(), () => false);
    if (!isFile) return fail('not-found', 'This sample is missing from the installation.');
    return runTranscription(event, {
      inputPath,
      instrument: instrument as InstrumentId,
      sensitivity: sensitivity as Sensitivity,
      isolate: isolate === true,
      title: sample.title,
    });
  });

  handle(IpcChannels.separationModelStatus, () => separationStatus());

  handle(IpcChannels.downloadSeparationModel, async (event): Promise<IpcResult<SeparationModelStatus>> => {
    if (modelDownload) return fail('invalid', 'The model is already downloading.');
    const controller = new AbortController();
    modelDownload = controller;
    try {
      await separationModel.downloadModel({
        dir: modelDir(),
        // Chromium's network stack: honours the system proxy settings.
        fetch: (url, init) => net.fetch(url as string, init),
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.separationModelProgress, fraction);
        },
      });
      return { ok: true, value: await separationStatus() };
    } catch (error) {
      if (error instanceof separationModel.ModelError) {
        return fail(error.code === 'cancelled' ? 'cancelled' : error.code === 'invalid' ? 'invalid' : 'failed', error.message);
      }
      return fail('failed', error instanceof Error ? error.message : String(error));
    } finally {
      modelDownload = null;
    }
  });

  handle(IpcChannels.cancelSeparationModelDownload, () => modelDownload?.abort());

  handle(IpcChannels.importSeparationModel, async (event): Promise<IpcResult<SeparationModelStatus | null>> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Import the Demucs model',
      properties: ['openFile'],
      filters: [{ name: 'Demucs model (htdemucs.onnx)', extensions: ['onnx'] }],
    };
    const { canceled, filePaths } = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { ok: true, value: null };
    try {
      await separationModel.importModel(modelDir(), filePaths[0]);
      return { ok: true, value: await separationStatus() };
    } catch (error) {
      return fail('invalid', error instanceof Error ? error.message : String(error));
    }
  });

  handle(IpcChannels.deleteSeparationModel, async () => {
    await separationModel.deleteModel(modelDir());
    return separationStatus();
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

  handle(IpcChannels.updateProjectNotes, async (_event, id: unknown, notes: unknown): Promise<IpcResult<ProjectSummary>> => {
    if (typeof id !== 'string' || !projects.isValidNotes(notes)) return fail('invalid', 'Invalid notes.');
    const summary = await projects.updateProjectNotes(id, notes);
    return summary ? { ok: true, value: summary } : fail('not-found', 'This project no longer exists.');
  });

  handle(IpcChannels.resetProjectNotes, async (_event, id: unknown): Promise<IpcResult<NoteEvent[]>> => {
    const notes = typeof id === 'string' ? await projects.resetProjectNotes(id) : null;
    return notes ? { ok: true, value: notes } : fail('not-found', 'This project no longer exists.');
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
