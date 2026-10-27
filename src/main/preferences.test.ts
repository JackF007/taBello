import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { log, startLog } from './log';
import { DEFAULT_PREFERENCES, isPreferences, readPreferences, writePreferences } from './preferences';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tabello-prefs-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('preferences', () => {
  it('reads defaults when missing or malformed, and keeps what was written', async () => {
    expect(await readPreferences(path.join(dir, 'none'))).toEqual(DEFAULT_PREFERENCES);
    writeFileSync(path.join(dir, 'preferences.json'), '{ not json');
    expect(await readPreferences(dir)).toEqual(DEFAULT_PREFERENCES);
    await writePreferences(dir, { checkForUpdates: false, music: true });
    expect(await readPreferences(dir)).toEqual({ checkForUpdates: false, music: true });
    // A preference added later keeps its default in an older file.
    writeFileSync(path.join(dir, 'preferences.json'), '{"checkForUpdates": false}');
    expect(await readPreferences(dir)).toEqual({ checkForUpdates: false, music: true });
  });

  it('accepts only known preferences from the window', () => {
    expect(isPreferences({ checkForUpdates: false, music: false })).toBe(true);
    expect(isPreferences({ checkForUpdates: false })).toBe(false);
    expect(isPreferences({ checkForUpdates: 'no', music: true })).toBe(false);
    expect(isPreferences({ checkForUpdates: true, music: true, extra: 1 })).toBe(false);
    expect(isPreferences(null)).toBe(false);
  });
});

describe('log', () => {
  it('writes errors to a file and starts a new one past its size limit', () => {
    const file = startLog(path.join(dir, 'logs'), 'TaBello test');
    log('error', 'Transcription failed: boom');
    expect(readFileSync(file, 'utf8')).toMatch(/INFO TaBello test\n.*ERROR Transcription failed: boom\n$/);
    for (let i = 0; i < 1200; i++) log('info', 'x'.repeat(500));
    expect(existsSync(file.replace(/\.log$/, '.old.log'))).toBe(true);
    expect(readFileSync(file, 'utf8').length).toBeLessThan(600 * 1024);
  });
});
