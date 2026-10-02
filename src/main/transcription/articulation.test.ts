import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeArticulation, followRidge, mergeBends, pluckStrength, transientEnvelope } from './articulation';
import { detectNotes } from './pipeline';
import { renderStrings, type SynthNote } from './testing/strings';

const require = createRequire(import.meta.url);
const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};

/** Contour frames with one ridge following `pitchOf(frame)` (fractional MIDI pitch). */
function contours(frames: number, pitchOf: (frame: number) => number | null): Uint8Array[] {
  return Array.from({ length: frames }, (_, f) => {
    const row = new Uint8Array(264);
    const pitch = pitchOf(f);
    if (pitch !== null) row[Math.round(3 * (pitch - 21))] = 230;
    return row;
  });
}
const noOnsets = Array.from({ length: 200 }, () => new Array(88).fill(0));
const silence = new Float32Array(200 * 128);

describe('articulation from contours', () => {
  const note = { startFrame: 10, durationFrames: 80, pitchMidi: 64 };

  it('measures a bend and its release', () => {
    // Up a whole step from frame 30 to 40, back down from 70 to 80.
    const bend = (f: number) => 64 + 2 * Math.min(1, Math.max(0, (f - 30) / 10)) - 2 * Math.min(1, Math.max(0, (f - 70) / 10));
    const result = analyzeArticulation(note, 0, { onsets: noOnsets, contours: contours(200, bend), transients: silence });
    expect(result).toMatchObject({ bend: 2, release: true });
  });

  it('tells a slide into the note from a bend', () => {
    // Two semitones below for the first 3 frames only.
    const scoop = (f: number) => (f < 13 ? 62 + (f - 10) * 0.7 : 64);
    const result = analyzeArticulation(note, 0, { onsets: noOnsets, contours: contours(200, scoop), transients: silence });
    expect(result.bend).toBeUndefined();
    expect(result.slideIn).toBeLessThan(-1);
  });

  it('detects vibrato', () => {
    const wobble = (f: number) => 64 + 0.4 * Math.sin((2 * Math.PI * 5.5 * f) / 86.13);
    const result = analyzeArticulation(note, 0, { onsets: noOnsets, contours: contours(200, wobble), transients: silence });
    expect(result.vibrato).toBe(true);
    expect(result.bend).toBeUndefined();
  });

  it('follows a glide past the end of the note, but not a jump', () => {
    const glide = contours(200, (f) => (f < 90 ? 64 : f < 105 ? 64 + (f - 90) / 3 : 69));
    expect(followRidge(glide, note, 1)).toBeCloseTo(5, 0);
    const jump = contours(200, (f) => (f < 90 ? 64 : 69));
    expect(followRidge(jump, note, 1)).toBe(0);
  });

  it('recognizes a pluck in the audio', () => {
    const audio = new Float32Array(22050);
    for (let i = 11025; i < 11200; i++) audio[i] = Math.sin(i * 1.3) * 0.5;
    const envelope = transientEnvelope(audio);
    expect(pluckStrength(envelope, 0.5)).toBe(1);
    expect(pluckStrength(envelope, 0.2)).toBe(0);
  });
});

describe('mergeBends', () => {
  const note = (start: number, duration: number, pitch: number, extra = {}) => ({ start, duration, pitch, velocity: 0.8, ...extra });

  it('joins a picked note and its bent pitch, with the release', () => {
    const merged = mergeBends([
      note(0, 0.3, 64, { attack: 0.9, slideOut: 1.7 }),
      note(0.4, 0.5, 66, { attack: 0.1, slideOut: -1.8 }),
      note(0.95, 0.4, 64, { attack: 0.05 }),
    ]);
    expect(merged).toEqual([note(0, 1.35, 64, { attack: 0.9, bend: 2, release: true })]);
  });

  it('keeps picked notes and jumps without a glide', () => {
    const picked = [note(0, 0.3, 64, { attack: 0.9, slideOut: 2 }), note(0.3, 0.3, 66, { attack: 0.9 })];
    expect(mergeBends(picked)).toHaveLength(2);
    const hammer = [note(0, 0.3, 64, { attack: 0.9 }), note(0.3, 0.3, 66, { attack: 0 })];
    expect(mergeBends(hammer)).toHaveLength(2);
  });
});

describe('techniques in synthesized recordings', () => {
  const detect = async (notes: SynthNote[], seconds = 3) =>
    detectNotes(renderStrings(notes, seconds), { assets, minHz: 70, maxHz: 1400 });

  it('marks picked notes with a strong attack and legato notes with none', async () => {
    const picked = await detect([{ start: 0.3, duration: 0.5, pitch: 60 }, { start: 0.8, duration: 0.6, pitch: 62 }]);
    expect(picked.map((n) => n.pitch)).toEqual([60, 62]);
    expect(Math.min(...picked.map((n) => n.attack!))).toBeGreaterThan(0.6);

    const hammer = await detect([{ start: 0.3, duration: 1, pitch: 60, changes: [{ at: 0.4, pitch: 62 }] }]);
    expect(hammer.map((n) => n.pitch)).toEqual([60, 62]);
    expect(hammer[1].attack).toBeLessThan(0.3);
  });

  it('detects bends, releases and vibrato', async () => {
    const [bend] = await detect([{ start: 0.3, duration: 1.5, pitch: 64, changes: [{ at: 0.25, pitch: 66, glide: 0.2 }] }]);
    expect(bend).toMatchObject({ pitch: 64, bend: 2 });
    const [release] = await detect([
      { start: 0.3, duration: 1.6, pitch: 64, changes: [{ at: 0.2, pitch: 66, glide: 0.2 }, { at: 0.9, pitch: 64, glide: 0.2 }] },
    ]);
    expect(release).toMatchObject({ pitch: 64, bend: 2, release: true });
    const vibrato = await detect([{ start: 0.3, duration: 1.5, pitch: 64, vibrato: 0.35 }]);
    expect(vibrato).toHaveLength(1);
    expect(vibrato[0].vibrato).toBe(true);
  });
});

describe('techniques from audio to tab', () => {
  it('writes a hammer-on and a bend in a synthesized lick', async () => {
    const { arrange } = await import('../../renderer/src/lib/music/arrange');
    const { INSTRUMENTS } = await import('../../shared/instruments');
    const guitar = INSTRUMENTS.guitar;
    // At 120 BPM: picked D4, E4, G4; A4 hammered from G4; picked B4 bent a whole step.
    const notes = await detectNotes(
      renderStrings(
        [
          { start: 0.5, duration: 0.5, pitch: 62 },
          { start: 1, duration: 0.5, pitch: 64 },
          { start: 1.5, duration: 1, pitch: 67, changes: [{ at: 0.5, pitch: 69 }] },
          { start: 2.5, duration: 1.5, pitch: 71, changes: [{ at: 0.25, pitch: 73, glide: 0.2 }] },
        ],
        4.5,
      ),
      { assets, minHz: guitar.minHz, maxHz: guitar.maxHz },
    );
    const arrangement = arrange(notes, { tuning: guitar.tunings[0].strings, frets: guitar.frets, bpm: 120, offset: 0.5 });
    const placed = arrangement.bars.flat().flatMap((b) => b.notes.filter((n) => !n.tied));
    expect(placed.map((n) => n.pitch)).toEqual([62, 64, 67, 69, 71]);
    expect(placed[2].techniques?.hammer).toBe(true);
    expect(placed[2].string).toBe(placed[3].string);
    expect(placed[4].techniques?.bend).toBe(2);
    expect(placed.slice(0, 2).every((n) => !n.techniques)).toBe(true);
  });
});
