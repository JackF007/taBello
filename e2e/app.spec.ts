import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let app: ElectronApplication;
let page: Page;

/** Generates test media with the bundled FFmpeg, so no binary fixtures live in the repo. */
function ffmpeg(...args: string[]) {
  execFileSync(ffmpegPath!, ['-loglevel', 'error', '-y', ...args]);
}

test.beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'tabello-e2e-'));
  // C4 E4 G4 C5 repeated, as a video with a solid-color picture.
  const arpeggio = 'aevalsrc=0.6*sin(2*PI*(if(lt(mod(t\\,2)\\,0.5)\\,261.63\\,if(lt(mod(t\\,2)\\,1)\\,329.63\\,if(lt(mod(t\\,2)\\,1.5)\\,392\\,523.25))))*t):d=8:s=44100';
  ffmpeg('-f', 'lavfi', '-i', arpeggio, '-f', 'lavfi', '-i', 'color=c=0x5a558f:s=320x240:r=10', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, 'arpeggio.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=196:d=240', path.join(dir, 'long.wav'));
  writeFileSync(path.join(dir, 'not-audio.mp3'), 'not audio');

  // A project saved by an older version with an instrument that is no longer supported.
  const legacyDir = path.join(dir, 'user-data', 'projects', 'a'.repeat(32));
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(path.join(legacyDir, 'notes.json'), JSON.stringify([{ start: 0, duration: 1, pitch: 60, velocity: 0.8 }]));
  writeFileSync(path.join(legacyDir, 'meta.json'), JSON.stringify({
    schemaVersion: 1, id: 'a'.repeat(32), title: 'old piano project', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', sourceName: 'old.wav', sourcePath: path.join(dir, 'old.wav'), durationSeconds: 1,
    noteCount: 1, settings: { instrument: 'piano', tuningId: 'standard', tempo: null, capo: null },
  }));

  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, 'user-data')}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('reopens projects of removed instruments as guitar', async () => {
  await page.getByRole('link', { name: 'Library' }).first().click();
  await page.getByRole('link', { name: 'Open old piano project' }).click();
  await expect(page.locator('#instrument')).toContainText('Guitar');
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('link', { name: 'Library' }).first().click();
  await page.getByRole('button', { name: 'Delete old piano project' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No transcriptions yet')).toBeVisible();
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
});

test('transcribes a video into a playable, exportable score', async () => {
  await page.setInputFiles('#file-upload', path.join(dir, 'arpeggio.mp4'));
  await page.waitForURL(/#\/project\//, { timeout: 60_000 });

  await expect(page.getByRole('heading', { name: 'arpeggio' })).toBeVisible();
  await expect(page.locator('label:has-text("Key") + p')).toHaveText('C major');
  // Guitar gets tuning and capo controls; a pure arpeggio needs no capo.
  await expect(page.locator('#capo')).toContainText('Auto (none)');
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('.at-surface > *').first()).toBeAttached();

  // The original video is served with range requests, so seeking works.
  const seeked = await page.evaluate(async () => {
    const video = document.querySelector('video')!;
    if (video.readyState < 1) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    video.currentTime = 5;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    return video.currentTime;
  });
  expect(seeked).toBeCloseTo(5, 0);

  // Tuning and time signature are detected too.
  await expect(page.locator('#tuning')).toContainText('Auto (Standard');
  await expect(page.locator('#meter')).toContainText('Auto (4/4)');

  // Play along with the original recording: the score follows the video.
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => !document.querySelector('video')!.paused)).toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
  await page.getByRole('radio', { name: 'Transcription' }).click();

  // Edit a note: click an open high E (E4) in the tab, raise it a semitone, delete it, undo.
  await page.getByRole('button', { name: 'Edit notes' }).click();
  await page.locator('.at-surface').scrollIntoViewIfNeeded();
  const openE = page.locator('.at-surface svg text[fill="#B45CFF"]', { hasText: /^0$/ }).first();
  await openE.click();
  await expect(page.getByTestId('selected-note-info')).toHaveText('E4');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('selected-note-info')).toHaveText('F4');
  await expect(page.locator('#note-fret')).toHaveValue('1');
  const noteCount = async () => Number((await page.getByText(/· \d+ notes ·/).textContent())!.match(/(\d+) notes/)![1]);
  const before = await noteCount();
  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect.poll(noteCount).toBeLessThan(before);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(noteCount).toBe(before);
  await page.getByRole('button', { name: 'Restore detected notes' }).click();
  await expect(page.getByRole('button', { name: 'Restore detected notes' })).toBeHidden();
  await page.getByRole('button', { name: 'Edit notes' }).click();

  // Changing settings re-renders the score.
  await page.getByRole('button', { name: '2×' }).click();
  await page.locator('#instrument').click();
  await page.getByRole('option', { name: 'Bass' }).click();
  await expect(page.locator('#tuning')).toContainText('E A D G)');

  // Export with the native save dialog stubbed out.
  const target = path.join(dir, 'export.gp');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, target);
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Guitar Pro/ }).click();
  await expect.poll(() => existsSync(target) && statSync(target).size).toBeGreaterThan(1000);
});

test('lists and deletes projects in the library', async () => {
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.getByRole('link', { name: 'Open arpeggio' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete arpeggio' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No transcriptions yet')).toBeVisible();
  expect(readdirSync(path.join(dir, 'user-data', 'projects'))).toHaveLength(0);
});

test('writes ukulele tabs with ukulele tunings', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.getByRole('radio', { name: 'Ukulele' }).click();
  await page.setInputFiles('#file-upload', path.join(dir, 'arpeggio.mp4'));
  await page.waitForURL(/#\/project\//, { timeout: 60_000 });

  await expect(page.locator('#instrument')).toContainText('Ukulele');
  await expect(page.locator('#tuning')).toContainText('Auto (Standard, high G (G C E A))');
  await expect(page.locator('#capo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });
});

test('cancels a running transcription', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.setInputFiles('#file-upload', path.join(dir, 'long.wav'));
  await expect(page.getByText('Detecting notes').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Transcription cancelled').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose file' })).toBeVisible();
});

test('explains files that cannot be read', async () => {
  await page.setInputFiles('#file-upload', path.join(dir, 'not-audio.mp3'));
  await expect(page.getByRole('alert').filter({ hasText: 'Could not transcribe not-audio.mp3' })).toBeVisible({ timeout: 30_000 });
});
