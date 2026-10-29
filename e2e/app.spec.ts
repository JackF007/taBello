import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  // The separation model is not in the repository; with TABELLO_DEMUCS_MODEL set, isolation is tested too.
  if (process.env.TABELLO_DEMUCS_MODEL) {
    mkdirSync(path.join(dir, 'user-data', 'models'), { recursive: true });
    copyFileSync(process.env.TABELLO_DEMUCS_MODEL, path.join(dir, 'user-data', 'models', 'htdemucs.onnx'));
  }

  app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(dir, 'user-data')}`, ...(process.env.CI ? ['--no-sandbox'] : [])],
    // Not the 100 MB separation model at every run: the tests install it themselves when they need it.
    // Nor a look for updates on GitHub: the tests run offline.
    env: { ...process.env, TABELLO_NO_MODEL_DOWNLOAD: '1', TABELLO_NO_UPDATE_CHECK: '1' },
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
  // A steady synthesized arpeggio: no tempo changes to follow.
  await expect(page.getByTestId('tempo-range')).toBeHidden();
  await page.getByRole('button', { name: 'Techniques', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Techniques', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Techniques', exact: true }).click();

  // Play along with the original recording: the score follows the video.
  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => !document.querySelector('video')!.paused)).toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
  await page.getByRole('radio', { name: 'Transcription' }).click();

  // Edit a note: click the first tab number, raise it a semitone, delete it, undo.
  await page.getByRole('button', { name: 'Edit notes' }).click();
  await page.locator('.at-surface').scrollIntoViewIfNeeded();
  // Tab numbers: digits colored by string (bar numbers are padded, chord diagrams are not colored).
  const stringColors = ['#2EE05A', '#FF3355', '#FFD600', '#2E9BFF', '#FF8A1F', '#B45CFF'].map((c) => `[fill="${c}"]`).join(',');
  await page.locator(`.at-surface svg text:is(${stringColors})`, { hasText: /^\d+$/ }).first().click();
  const info = page.getByTestId('selected-note-info');
  await expect(info).toHaveText(/^[A-G]♯?\d$/);
  const name = await info.textContent();
  const fret = Number(await page.locator('#note-fret').inputValue());
  await page.keyboard.press('ArrowUp');
  await expect(info).not.toHaveText(name!);
  await expect(page.locator('#note-fret')).toHaveValue(String(fret + 1));
  // The edited note stays selected in both the notation and the tablature.
  await expect(page.getByTestId('selected-note')).toHaveCount(2);
  const noteCount = async () => Number((await page.getByText(/· \d+ notes ·/).textContent())!.match(/(\d+) notes/)![1]);
  const before = await noteCount();
  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect.poll(noteCount).toBeLessThan(before);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(noteCount).toBe(before);
  await page.getByRole('button', { name: 'Restore detected notes' }).click();
  await expect(page.getByRole('button', { name: 'Restore detected notes' })).toBeHidden();
  await page.getByRole('button', { name: 'Edit notes' }).click();

  // Changing settings re-renders the score; the guitar's notes are written for the ukulele at once.
  await page.getByRole('button', { name: '2×' }).click();
  await page.locator('#instrument').click();
  await page.getByRole('option', { name: 'Ukulele' }).click();
  await expect(page.locator('#tuning')).toContainText('(G C E A)');

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

test('transcribes a bundled sample', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.getByRole('button', { name: 'Try Greensleeves' }).click();
  await page.waitForURL(/#\/project\//, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Greensleeves' })).toBeVisible();
  // The menu music gives way to the song.
  await expect(page.locator('html')).toHaveAttribute('data-music', 'stopped');
  await expect(page.locator('#meter')).toContainText('Auto (3/4');
  await expect(page.locator('label:has-text("Key") + p')).toHaveText('A minor');
  // The sample plays as the original recording.
  await expect(page.locator('audio')).toBeAttached();
  await expect(page.getByRole('radio', { name: 'Original' })).toBeVisible();

  // A capo moves the song up with the same shapes; the recording cannot follow it.
  await page.getByRole('button', { name: 'Transpose up' }).click();
  await page.getByRole('button', { name: 'Transpose up' }).click();
  await expect(page.getByTestId('transpose')).toHaveText('+2');
  await expect(page.locator('label:has-text("Key") + p')).toHaveText('B minor');
  // (A toast is a status too, and stays in the page once closed: look for the capo by its text.)
  await expect(page.getByRole('status').filter({ hasText: 'Capo on the' })).toContainText('Capo on the 2nd fret');
  await expect(page.getByTestId('transpose-note')).toContainText('2 semitones higher');
  await expect(page.getByRole('radio', { name: 'Original' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('transpose')).toHaveText('0');

  // The melody alone: the tab is written again without the bass.
  await page.locator('#part').click();
  await page.getByRole('option', { name: 'Melody / lead' }).click();
  await expect(page.locator('#part')).toContainText('Melody / lead');
  await expect(page.locator('.at-surface')).toBeVisible();
  await page.locator('#part').click();
  await page.getByRole('option', { name: 'Everything' }).click();
});

test('transcribes a band sample for the instrument chosen, and its bass on demand', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.getByRole('radio', { name: 'Guitar' }).click();
  await page.getByRole('button', { name: 'Try When the Saints Go Marching In' }).click();
  await page.waitForURL(/#\/project\//, { timeout: 120_000 });
  await expect(page.locator('#instrument')).toContainText('Guitar');
  const guitarUrl = page.url();

  // The bass plays another part: the recording is heard again, into a new project.
  await page.locator('#instrument').click();
  await page.getByRole('option', { name: /Bass · transcribe/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Transcribe the bass?');
  await dialog.getByRole('button', { name: 'Transcribe the bass' }).click();
  await expect.poll(() => page.url(), { timeout: 120_000 }).not.toBe(guitarUrl);
  await expect(page.locator('#instrument')).toContainText('Bass');
  await expect(page.locator('#tuning')).toContainText('E A D G)');
  // The guitar tab is still in the library.
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.getByRole('link', { name: 'Open When the Saints Go Marching In' })).toHaveCount(2);
});

test('isolates the bass of the band sample', async () => {
  test.skip(!process.env.TABELLO_DEMUCS_MODEL, 'needs TABELLO_DEMUCS_MODEL');
  test.setTimeout(600_000);
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await page.getByRole('radio', { name: 'Bass' }).click();
  await page.getByRole('button', { name: 'Try When the Saints Go Marching In' }).click();
  await expect(page.getByText('Isolating instrument').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForURL(/#\/project\//, { timeout: 600_000 });
  await expect(page.locator('#instrument')).toContainText('Bass');
  // Isolated: the kick drum no longer looks like notes below a 4-string bass.
  await expect(page.locator('#tuning')).toContainText('Auto (Standard (E A D G))');
});

test('offers to download the separation model', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  const remove = page.getByRole('button', { name: /Remove model/ });
  if (await remove.isVisible()) {
    await remove.click();
    await expect(remove).toBeHidden();
  }
  await page.locator('#isolate').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Download the separation model');
  await expect(dialog).toContainText('personal and research use');
  await expect(dialog.getByRole('button', { name: 'Download' })).toBeVisible();
  // Closed with its button: Escape goes to whichever layer is on top (a toast still showing, a menu
  // closing), which made this test fail now and then.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#isolate')).toHaveAttribute('aria-checked', 'false');
});

test('offers a way to report problems and to turn the update check off', async () => {
  await page.getByRole('link', { name: 'Transcribe', exact: true }).click();
  await expect(page.locator('footer')).toContainText('© 2026 Giacomo Ferlaino (JackF007)');
  await expect(page.getByRole('link', { name: 'Report a problem' })).toHaveAttribute('href', /github\.com\/JackF007\/taBello\/issues\/new\/choose/);
  await expect(page.getByRole('button', { name: 'Show the log' })).toBeVisible();
  const updates = page.getByRole('button', { name: /Check for updates/ });
  await expect(updates).toHaveText('Check for updates: on');
  await updates.click();
  await expect(updates).toHaveText('Check for updates: off');
  await updates.click();
  await expect(updates).toHaveText('Check for updates: on');
  // The menu music plays here, and stops at once when turned off.
  const music = page.getByRole('button', { name: /^Music/ });
  await expect(music).toHaveText('Music: on');
  await expect(page.locator('html')).toHaveAttribute('data-music', 'playing');
  await music.click();
  await expect(music).toHaveText('Music: off');
  await expect(page.locator('html')).toHaveAttribute('data-music', 'stopped');
  // The other preference is kept.
  await expect(updates).toHaveText('Check for updates: on');
  await music.click();
  await expect(page.locator('html')).toHaveAttribute('data-music', 'playing');
});
