/// <reference types="vite/client" />
declare module '@coderline/alphatab' {
  export enum LogLevel {
    None = 0,
    Debug = 1,
    Info = 2,
    Warning = 3,
    Error = 4
  }

  export enum LayoutMode {
    Page = 0,
    Horizontal = 1
  }

  export interface RenderingResourcesSettings {
    resources?: {
      fontDirectory?: string;
      soundFontDirectory?: string;
    };
  }

  export interface CoreSettings {
    file?: string;
    logLevel?: LogLevel;
    useWorkers?: boolean;
    engine?: string;
    fontDirectory?: string;
  }

  export interface DisplaySettings {
    layoutMode?: LayoutMode;
  }

  export interface PlayerSettings {
    enablePlayer?: boolean;
    soundFont?: string;
    scrollElement?: HTMLElement;
  }

  export interface Settings {
    core?: CoreSettings;
    display?: DisplaySettings;
    player?: PlayerSettings;
  }

  export class AlphaTabApi {
    constructor(container: HTMLElement, settings?: any);
    play(): void;
    pause(): void;
    destroy(): void;
    renderFinished: { on(callback: () => void): void };
    error: { on(callback: (error: Error) => void): void };
    playerStateChanged: { on(callback: (state: number) => void): void };
    tex(content: string): void;
  }
}
