// Contract between the main process and the renderer.
// Main registers a handler for each channel, preload exposes them as `window.tabello`.

export const IpcChannels = {
  getAppInfo: 'app:get-info',
  openMediaFile: 'dialog:open-media-file',
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

export interface MediaFile {
  path: string;
  name: string;
  sizeBytes: number;
}

/** Extensions offered in the open dialog. FFmpeg can decode far more, this list only drives the picker. */
export const MEDIA_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'aif', 'wma',
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v',
] as const;

export interface TabelloApi {
  getAppInfo(): Promise<AppInfo>;
  /** Shows the native open dialog. Resolves to null when the user cancels. */
  openMediaFile(): Promise<MediaFile | null>;
}
