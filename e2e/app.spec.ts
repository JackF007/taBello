import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, 'user-data')}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
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

  // Changing settings re-renders the score.
  await page.getByRole('button', { name: '2×' }).click();
  await page.locator('#instrument').click();
  await page.getByRole('option', { name: 'Bass' }).click();
  await expect(page.locator('#tuning')).toContainText('E A D G');

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

test('writes piano parts on a grand staff', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.getByRole('radio', { name: 'Piano' }).click();
  await page.setInputFiles('#file-upload', path.join(dir, 'arpeggio.mp4'));
  await page.waitForURL(/#\/project\//, { timeout: 60_000 });

  await expect(page.locator('#instrument')).toContainText('Piano');
  // No strings, so no tuning or capo.
  await expect(page.locator('#tuning')).toHaveCount(0);
  await expect(page.locator('#capo')).toHaveCount(0);
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
