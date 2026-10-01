// Contract between the main process and the renderer.
// Main registers a handler for each channel, preload exposes them as `window.tabello`.
import type { InstrumentId } from './instruments';
import type { MeterId } from './meters';

export const IpcChannels = {
  getAppInfo: 'app:get-info',
  transcribe: 'transcription:start',
  transcribeSample: 'transcription:start-sample',
  cancelTranscription: 'transcription:cancel',
  transcriptionProgress: 'transcription:progress',
  listProjects: 'projects:list',
  getProject: 'projects:get',
  updateProjectSettings: 'projects:update-settings',
  updateProjectNotes: 'projects:update-notes',
  resetProjectNotes: 'projects:reset-notes',
  deleteProject: 'projects:delete',
  exportFile: 'export:save-file',
  separationModelStatus: 'separation:status',
  downloadSeparationModel: 'separation:download',
  cancelSeparationModelDownload: 'separation:cancel-download',
  importSeparationModel: 'separation:import',
  deleteSeparationModel: 'separation:delete',
  separationModelProgress: 'separation:progress',
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
/** Source separation is slower (about real time) and needs more memory, so it is limited further. */
export const MAX_SEPARATION_SECONDS = 10 * 60;

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
  /** String chosen by the user while editing (index in the tuning's physical order); a hint for fingering. */
  string?: number;
  // How the note was played, from the pitch contours and the audio (absent in older projects).
  /** Onset strength, 0..1: low for notes that were not picked (hammer-ons, pull-offs, slides). */
  attack?: number;
  /** Bend, in semitones (0.5 steps). */
  bend?: number;
  /** The bend goes back down to the original pitch. */
  release?: boolean;
  /** Pitch glide at the start of the note, in semitones relative to it (negative: from below). */
  slideIn?: number;
  /** Pitch glide at the end of the note, in semitones (positive: upwards). */
  slideOut?: number;
  vibrato?: boolean;
}

export type TranscriptionStage = 'starting' | 'extracting' | 'separating' | 'transcribing' | 'saving';

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
  /** Isolate the instrument from the mix first (needs the separation model). */
  isolate?: boolean;
}

export interface SeparationModelStatus {
  installed: boolean;
  /** Size of the download and of the installed model, in bytes. */
  downloadBytes: number;
  sizeBytes: number;
}

export interface ProjectSettings {
  instrument: InstrumentId;
  /** One of the instrument's tunings; null means "use the detected tuning". */
  tuningId: string | null;
  /** User-chosen tempo in BPM; null means "use the detected tempo". */
  tempo: number | null;
  /** Capo fret for guitar/bass (0 = none); null means "use the detected capo". */
  capo: number | null;
  /** Time signature / feel; null means "use the detected meter". */
  meter: MeterId | null;
  /** Show chord names and diagrams above the staff. */
  chords: boolean;
  /** Write playing techniques (bends, slides, hammer-ons, vibrato). */
  techniques: boolean;
  /** Follow tempo changes in the recording (otherwise the tempo is constant). */
  tempoChanges: boolean;
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
  /** The instrument was isolated from the mix before transcribing. */
  isolated?: boolean;
}

export interface Project extends ProjectSummary {
  sourcePath: string;
  /** False when the original audio/video file was moved or deleted. */
  sourceAvailable: boolean;
  notes: NoteEvent[];
  /** True when the notes were edited by hand (the detected ones can be restored). */
  edited: boolean;
}

/** Upper bound on the notes a project can hold (a 15-minute recording yields a few thousand). */
export const MAX_NOTES = 50_000;

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
  /** Transcribes one of the bundled sample recordings (see shared/samples.ts). */
  transcribeSample(sampleId: string, request: TranscriptionRequest): Promise<IpcResult<ProjectSummary>>;
  cancelTranscription(): Promise<void>;
  /** Returns an unsubscribe function. */
  onTranscriptionProgress(listener: (progress: TranscriptionProgress) => void): () => void;
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<IpcResult<Project>>;
  updateProjectSettings(id: string, settings: ProjectSettings): Promise<IpcResult<ProjectSummary>>;
  /** Saves hand-edited notes; the notes detected by the transcription are kept for resetProjectNotes. */
  updateProjectNotes(id: string, notes: NoteEvent[]): Promise<IpcResult<ProjectSummary>>;
  /** Restores the notes detected by the transcription and returns them. */
  resetProjectNotes(id: string): Promise<IpcResult<NoteEvent[]>>;
  deleteProject(id: string): Promise<IpcResult<void>>;
  /** Shows a save dialog and writes the data. Resolves to the saved path, or null if cancelled. */
  exportFile(request: ExportRequest): Promise<IpcResult<string | null>>;
  getSeparationModel(): Promise<SeparationModelStatus>;
  /** Downloads the separation model once (about 100 MB). */
  downloadSeparationModel(): Promise<IpcResult<SeparationModelStatus>>;
  cancelSeparationModelDownload(): Promise<void>;
  /** Lets the user pick an htdemucs.onnx file. Resolves to null if the dialog is cancelled. */
  importSeparationModel(): Promise<IpcResult<SeparationModelStatus | null>>;
  deleteSeparationModel(): Promise<SeparationModelStatus>;
  /** Download progress, 0..1. Returns an unsubscribe function. */
  onSeparationModelProgress(listener: (fraction: number) => void): () => void;
}
