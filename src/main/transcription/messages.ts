import type { ErrorCode, NoteEvent, Sensitivity, TranscriptionProgress } from '../../shared/ipc';
import type { InstrumentId } from '../../shared/instruments';

/** Main → transcription worker. */
export interface WorkerRequest {
  inputPath: string;
  ffmpegPath: string;
  instrument: InstrumentId;
  sensitivity: Sensitivity;
}

/** Transcription worker → main. */
export type WorkerMessage =
  | { type: 'progress'; progress: TranscriptionProgress }
  | { type: 'result'; notes: NoteEvent[]; durationSeconds: number }
  | { type: 'error'; code: ErrorCode; message: string };
