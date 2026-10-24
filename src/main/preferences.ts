// App-wide preferences (per-project settings live with each project), in the user's data folder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from '../shared/ipc';

const FILE = 'preferences.json';

export const DEFAULT_PREFERENCES: Preferences = { checkForUpdates: true };

/** Reads the preferences, keeping the defaults for anything missing or malformed. */
export async function readPreferences(dir: string): Promise<Preferences> {
  try {
    const stored: unknown = JSON.parse(await readFile(path.join(dir, FILE), 'utf8'));
    const value = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
    return { checkForUpdates: typeof value.checkForUpdates === 'boolean' ? value.checkForUpdates : DEFAULT_PREFERENCES.checkForUpdates };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function writePreferences(dir: string, preferences: Preferences): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, FILE), JSON.stringify(preferences, null, 2));
}

/** Untrusted input from the renderer: only known keys with the right types. */
export function isPreferences(value: unknown): value is Preferences {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).checkForUpdates === 'boolean' && Object.keys(value).length === 1;
}
