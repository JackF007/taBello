// Contract between the main process and the renderer.
// Main registers a handler for each channel, preload exposes them as `window.tabello`.
import type { InstrumentId } from './instruments';

export const IpcChannels = {
  getAppInfo: 'app:get-info',
  transcribe: 'transcription:start',
  cancelTranscription: 'transcription:cancel',
  transcriptionProgress: 'transcription:progress',
  listProjects: 'projects:list',
  getProject: 'projects:get',
  updateProjectSettings: 'projects:update-settings',
  deleteProject: 'projects:delete',
  exportFile: 'export:save-file',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

/** Extensions offered in the file picker. FFmpeg can decode far more, this list only drives the picker. */
export const MEDIA_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'aif', 'wma',
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v',
] as const;

/** Longer inputs are rejected: inference memory grows linearly with duration. */
export const MAX_DURATION_SECONDS = 15 * 60;

/** A note detected by the model, in real time (not yet quantized to a beat grid). */
export interface NoteEvent {
  /** Onset in seconds. */
  start: number;
  /** Length in seconds. */
  duration: number;
  /** MIDI pitch (60 = middle C). */
  pitch: number;
  /** Model confidence / loudness, 0..1. */
  velocity: number;
}

export type TranscriptionStage = 'starting' | 'extracting' | 'transcribing' | 'saving';

export interface TranscriptionProgress {
  stage: TranscriptionStage;
  /** Progress within the current stage, 0..1. */
  fraction: number;
}

/** Trade-off between missing quiet notes ('low') and picking up spurious ones ('high'). */
export type Sensitivity = 'low' | 'normal' | 'high';

export const SENSITIVITIES: Sensitivity[] = ['low', 'normal', 'high'];

export interface TranscriptionRequest {
  instrument: InstrumentId;
  sensitivity: Sensitivity;
}

export interface ProjectSettings {
  instrument: InstrumentId;
  tuningId: string;
  /** User-chosen tempo in BPM; null means "use the detected tempo". */
  tempo: number | null;
  /** Capo fret for guitar/bass (0 = none); null means "use the detected capo". */
  capo: number | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceName: string;
  durationSeconds: number;
  noteCount: number;
  settings: ProjectSettings;
}

export interface Project extends ProjectSummary {
  sourcePath: string;
  /** False when the original audio/video file was moved or deleted. */
  sourceAvailable: boolean;
  notes: NoteEvent[];
}

export type ExportFormat = 'midi' | 'gp' | 'alphatex';

export interface ExportRequest {
  format: ExportFormat;
  suggestedName: string;
  data: Uint8Array;
}

export type ErrorCode = 'cancelled' | 'busy' | 'no-audio' | 'too-long' | 'not-found' | 'invalid' | 'failed';

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string } };

/** Scheme serving a project's original audio/video to the renderer, with HTTP range support. */
export const MEDIA_SCHEME = 'tabello-media';

export function projectMediaUrl(projectId: string): string {
  return `${MEDIA_SCHEME}://project/${encodeURIComponent(projectId)}`;
}

export interface TabelloApi {
  getAppInfo(): Promise<AppInfo>;
  /**
   * Transcribes a file picked by the user (file input or drag & drop) and saves it as a project.
   * Files not coming from the user's file system are rejected.
   */
  transcribe(file: File, request: TranscriptionRequest): Promise<IpcResult<ProjectSummary>>;
  cancelTranscription(): Promise<void>;
  /** Returns an unsubscribe function. */
  onTranscriptionProgress(listener: (progress: TranscriptionProgress) => void): () => void;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<IpcResult<Project>>;
  updateProjectSettings(id: string, settings: ProjectSettings): Promise<IpcResult<ProjectSummary>>;
  deleteProject(id: string): Promise<IpcResult<void>>;
  /** Shows a save dialog and writes the data. Resolves to the saved path, or null if cancelled. */
  exportFile(request: ExportRequest): Promise<IpcResult<string | null>>;
}
