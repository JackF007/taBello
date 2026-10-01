import { utilityProcess, type UtilityProcess } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import path from 'node:path';
import type { IpcResult, NoteEvent, Sensitivity, TranscriptionProgress } from '../../shared/ipc';
import type { InstrumentId } from '../../shared/instruments';
import type { WorkerMessage, WorkerRequest } from './messages';

export type SeparationJob = NonNullable<WorkerRequest['separation']>;

const WORKER_PATH = path.join(import.meta.dirname, 'transcriptionWorker.js');

export interface TranscriptionOutput {
  notes: NoteEvent[];
  durationSeconds: number;
}

let active: { child: UtilityProcess; cancelled: boolean } | null = null;

/** In a packaged app the binary is unpacked next to app.asar (see asarUnpack in electron-builder.yml). */
function ffmpegPath(): string | null {
  return ffmpegStatic?.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) ?? null;
}

export function isTranscribing(): boolean {
  return active !== null;
}

export function cancelTranscription(): void {
  if (!active) return;
  active.cancelled = true;
  active.child.kill();
}

/** Runs one transcription job in a dedicated utility process. Only one job runs at a time. */
export function transcribe(
  inputPath: string,
  instrument: InstrumentId,
  sensitivity: Sensitivity,
  onProgress: (progress: TranscriptionProgress) => void,
  separation?: SeparationJob,
): Promise<IpcResult<TranscriptionOutput>> {
  if (active) {
    return Promise.resolve({ ok: false, error: { code: 'busy', message: 'Another transcription is already running.' } });
  }
  const binary = ffmpegPath();
  if (!binary) {
    return Promise.resolve({ ok: false, error: { code: 'failed', message: 'FFmpeg is not available for this platform.' } });
  }

  const child = utilityProcess.fork(WORKER_PATH, [], { serviceName: 'TaBello transcription', stdio: 'inherit' });
  const job = { child, cancelled: false };
  active = job;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: IpcResult<TranscriptionOutput>) => {
      if (settled) return;
      settled = true;
      if (active === job) active = null;
      child.kill();
      resolve(result);
    };

    child.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') onProgress(message.progress);
      else if (message.type === 'result') finish({ ok: true, value: { notes: message.notes, durationSeconds: message.durationSeconds } });
      else finish({ ok: false, error: { code: message.code, message: message.message } });
    });

    child.on('exit', (code) => {
      if (job.cancelled) finish({ ok: false, error: { code: 'cancelled', message: 'Transcription cancelled.' } });
      else finish({ ok: false, error: { code: 'failed', message: `The transcription process stopped unexpectedly (code ${code}).` } });
    });

    onProgress({ stage: 'starting', fraction: 0 });
    const request: WorkerRequest = { inputPath, ffmpegPath: binary, instrument, sensitivity, separation };
    child.once('spawn', () => child.postMessage(request));
  });
}
