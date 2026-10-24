// A small log of what went wrong, kept on the user's computer so that it can be attached to a bug
// report. It holds error messages only (no recordings, no notes) and never grows past two files.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;
let file: string | null = null;

/** Starts logging into `dir` (the app's logs folder) and returns the log file's path. */
export function startLog(dir: string, header: string): string {
  mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'tabello.log');
  log('info', header);
  return file;
}

export function logFile(): string | null {
  return file;
}

export function log(level: 'info' | 'error', message: string): void {
  if (!file) return;
  try {
    // Past the limit, the log becomes tabello.old.log and a new one starts.
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, file.replace(/\.log$/, '.old.log'));
    appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${message.replace(/\s+$/, '')}\n`);
  } catch {
    // Logging must never break the app.
  }
}

export function logError(context: string, error: unknown): void {
  log('error', `${context}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
}
