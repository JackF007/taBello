// App-wide preferences (per-project settings live with each project), in the user's data folder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Preferences } from '../shared/ipc';

const FILE = 'preferences.json';

export const DEFAULT_PREFERENCES: Preferences = { checkForUpdates: true, startupSound: true };
const KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[];

/** Reads the preferences, keeping the defaults for anything missing or malformed. */
export async function readPreferences(dir: string): Promise<Preferences> {
  try {
    const stored: unknown = JSON.parse(await readFile(path.join(dir, FILE), 'utf8'));
    const value = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
    return Object.fromEntries(KEYS.map((key) => [key, typeof value[key] === 'boolean' ? value[key] : DEFAULT_PREFERENCES[key]])) as unknown as Preferences;
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
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === KEYS.length && KEYS.every((key) => typeof record[key] === 'boolean');
}
