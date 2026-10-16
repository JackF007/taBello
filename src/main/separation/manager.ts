// Keeps the separation model ready: TaBello downloads it by itself, in the background, the first
// time it starts (and again at the next start if that failed), so "Isolate" simply works. Users who
// remove the model or stop the download are not overruled: it then comes back only when they ask.
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SeparationModelStatus } from '../../shared/ipc';
import { deleteModel, downloadModel, importModel, isModelInstalled, MODEL_SOURCE, ModelError, type DownloadOptions } from './model';

/** Present when the user removed the model or stopped its download: no automatic download then. */
const DECLINED_FILE = 'no-automatic-download';

export interface ModelManagerOptions {
  dir: string;
  /** Called on every change (progress included), to tell the windows. */
  onChange: (status: SeparationModelStatus) => void;
  /** Electron's net.fetch in the app; plain fetch in tests. */
  fetch?: DownloadOptions['fetch'];
  /** Tests: another file to download. */
  source?: Pick<DownloadOptions, 'url' | 'expected'>;
}

export class SeparationModelManager {
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private progress: number | null = null;
  private error: string | null = null;
  private lastNotified = -1;

  constructor(private readonly options: ModelManagerOptions) {}

  async status(): Promise<SeparationModelStatus> {
    return {
      installed: await this.installed(),
      downloading: this.running !== null,
      progress: this.progress,
      error: this.error,
      downloadBytes: MODEL_SOURCE.downloadBytes,
      sizeBytes: MODEL_SOURCE.bytes,
    };
  }

  /** At startup: downloads the model unless it is installed or the user said no. */
  async ensure(): Promise<void> {
    if ((await this.installed()) || (await this.declined())) return;
    await this.download().catch(() => undefined);
  }

  /** Downloads the model (or waits for the download already running). */
  async download(): Promise<void> {
    if (this.running) return this.running;
    const controller = new AbortController();
    this.controller = controller;
    this.progress = 0;
    this.error = null;
    this.running = (async () => {
      try {
        await rm(path.join(this.options.dir, DECLINED_FILE), { force: true });
        await downloadModel({
          dir: this.options.dir,
          fetch: this.options.fetch,
          ...this.options.source,
          signal: controller.signal,
          onProgress: (fraction) => {
            this.progress = fraction;
            // Every whole percent is enough for a progress bar.
            if (Math.floor(fraction * 100) !== this.lastNotified) {
              this.lastNotified = Math.floor(fraction * 100);
              void this.notify();
            }
          },
        });
      } catch (error) {
        if (error instanceof ModelError && error.code === 'cancelled') await this.decline();
        else this.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        this.running = null;
        this.controller = null;
        this.progress = null;
        this.lastNotified = -1;
        await this.notify();
      }
    })();
    await this.notify();
    return this.running;
  }

  /** Stops the download; it starts again only when the user asks. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Frees the disk space; the model comes back only when the user asks. */
  async remove(): Promise<SeparationModelStatus> {
    this.cancel();
    await this.running?.catch(() => undefined);
    await deleteModel(this.options.dir);
    await this.decline();
    await this.notify();
    return this.status();
  }

  /** Installs a copy of the model the user already has. */
  async import(file: string): Promise<SeparationModelStatus> {
    await importModel(this.options.dir, file, this.options.source?.expected);
    this.error = null;
    await this.notify();
    return this.status();
  }

  private installed(): Promise<boolean> {
    return isModelInstalled(this.options.dir, this.options.source?.expected?.bytes);
  }

  private async declined(): Promise<boolean> {
    return access(path.join(this.options.dir, DECLINED_FILE)).then(
      () => true,
      () => false,
    );
  }

  private async decline(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
    await writeFile(path.join(this.options.dir, DECLINED_FILE), '');
  }

  private async notify(): Promise<void> {
    this.options.onChange(await this.status());
  }
}
