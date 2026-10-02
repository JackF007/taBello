import type { ErrorCode, NoteEvent, Sensitivity, TranscriptionProgress } from '../../shared/ipc';
import type { InstrumentId } from '../../shared/instruments';
import type { DemucsSource } from '../separation/demucs';

/** Main → transcription worker. */
export interface WorkerRequest {
  inputPath: string;
  ffmpegPath: string;
  instrument: InstrumentId;
  sensitivity: Sensitivity;
  /** Isolate one source with Demucs before detecting notes. */
  separation?: { modelPath: string; source: DemucsSource };
}

/** Transcription worker → main. */
export type WorkerMessage =
  | { type: 'progress'; progress: TranscriptionProgress }
  | { type: 'result'; notes: NoteEvent[]; durationSeconds: number }
  | { type: 'error'; code: ErrorCode; message: string };
