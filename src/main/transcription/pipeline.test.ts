import ffmpegPath from 'ffmpeg-static';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../../shared/instruments';
import { decodeAudio, detectNotes, mergeRetriggeredNotes, PipelineError, removeHarmonics, SAMPLE_RATE } from './pipeline';

const require = createRequire(import.meta.url);
// When running from source, the assets are read straight from node_modules.
const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};

// C4 E4 G4 C5, half a second each, synthesized by FFmpeg itself.
const ARPEGGIO = [60, 64, 67, 72];
const arpeggioSource =
  'aevalsrc=sin(2*PI*(if(lt(t\\,0.5)\\,261.63\\,if(lt(t\\,1)\\,329.63\\,if(lt(t\\,1.5)\\,392\\,523.25))))*t):d=2:s=44100';

let dir: string;
let wavPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tabello-test-'));
  wavPath = path.join(dir, 'arpeggio.wav');
  const { execFileSync } = await import('node:child_process');
  execFileSync(ffmpegPath!, ['-loglevel', 'error', '-f', 'lavfi', '-i', arpeggioSource, wavPath]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('decodeAudio', () => {
  it('decodes to mono 22.05 kHz and reports progress', async () => {
    const progress: number[] = [];
    const audio = await decodeAudio(ffmpegPath!, wavPath, { onProgress: (f) => progress.push(f) });
    expect(audio.length / SAMPLE_RATE).toBeCloseTo(2, 1);
    expect(progress.at(-1)).toBe(1);
  });

  it('rejects files without audio', async () => {
    const textFile = path.join(dir, 'not-audio.txt');
    await writeFile(textFile, 'hello');
    await expect(decodeAudio(ffmpegPath!, textFile)).rejects.toBeInstanceOf(PipelineError);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const pending = decodeAudio(ffmpegPath!, wavPath, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('detectNotes', () => {
  it('transcribes a synthesized arpeggio', async () => {
    const audio = await decodeAudio(ffmpegPath!, wavPath);
    const { minHz, maxHz } = INSTRUMENTS.guitar;
    const notes = await detectNotes(audio, { assets, minHz, maxHz });

    expect(notes.map((n) => n.pitch)).toEqual(ARPEGGIO);
    notes.forEach((note, i) => expect(note.start).toBeCloseTo(i * 0.5, 1));
  });
});

describe('removeHarmonics', () => {
  const note = (start: number, pitch: number, velocity: number) => ({ start, duration: 0.3, pitch, velocity });

  it('drops quiet overtones of a simultaneous note but keeps real intervals', () => {
    const notes = [note(0, 50, 0.9), note(0.01, 62, 0.3), note(0, 57, 0.8), note(0, 74, 0.2), note(1, 62, 0.3)];
    expect(removeHarmonics(notes).map((n) => n.pitch)).toEqual([50, 57, 62]);
  });

  it('keeps loud octaves (e.g. a played power chord)', () => {
    const notes = [note(0, 40, 0.8), note(0, 52, 0.7)];
    expect(removeHarmonics(notes)).toHaveLength(2);
  });
});

describe('mergeRetriggeredNotes', () => {
  const note = (start: number, duration: number, pitch: number, velocity: number) => ({ start, duration, pitch, velocity });

  it('merges a weaker onset that continues a ringing note', () => {
    expect(mergeRetriggeredNotes([note(0.5, 0.3, 57, 0.86), note(0.8, 0.2, 57, 0.74)])).toEqual([note(0.5, 0.5, 57, 0.86)]);
  });

  it('keeps real repeated notes: as loud, or separated by a gap', () => {
    expect(mergeRetriggeredNotes([note(0, 0.3, 60, 0.9), note(0.3, 0.3, 60, 0.84)])).toHaveLength(2);
    expect(mergeRetriggeredNotes([note(0, 0.3, 60, 0.9), note(0.45, 0.3, 60, 0.5)])).toHaveLength(2);
  });
});

describe('transcription accuracy', () => {
  /** Karplus–Strong plucked string: a cheap but realistic-enough stand-in for a guitar. */
  function renderPluckedStrings(events: { t: number; midi: number; dur: number; amp: number }[], seconds: number): Float32Array {
    const out = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
    let seed = 1;
    const noise = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 2 - 1;
    for (const { t, midi, dur, amp } of events) {
      const period = Math.round(SAMPLE_RATE / (440 * 2 ** ((midi - 69) / 12)));
      const buffer = Float32Array.from({ length: period }, noise);
      const start = Math.round(t * SAMPLE_RATE);
      for (let i = 0; i < dur * SAMPLE_RATE && start + i < out.length; i++) {
        const j = i % period;
        const sample = buffer[j];
        buffer[j] = 0.996 * 0.5 * (sample + buffer[(j + 1) % period]);
        out[start + i] += sample * amp;
      }
    }
    const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    return out.map((x) => (x / peak) * 0.8);
  }

  it('finds most notes of a riff and strummed chords with few false positives', async () => {
    const beat = 0.6;
    const truth: { t: number; midi: number; dur: number; amp: number }[] = [];
    const riff = [57, 60, 64, 69, 64, 60, 57, 60, 55, 59, 62, 67, 62, 59, 55, 59];
    let t = 0.5;
    for (let k = 0; k < 2; k++) {
      for (const midi of riff) {
        truth.push({ t, midi, dur: beat * 0.8, amp: 0.5 });
        t += beat / 2;
      }
    }
    for (const chord of [[40, 47, 52, 55, 59, 64], [48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [50, 57, 62, 66]]) {
      chord.forEach((midi, k) => truth.push({ t: t + k * 0.012, midi, dur: beat * 4, amp: 0.3 }));
      t += beat * 4;
    }
    const { minHz, maxHz } = INSTRUMENTS.guitar;
    const notes = await detectNotes(renderPluckedStrings(truth, t + 1), { assets, minHz, maxHz, sensitivity: 'normal' });

    const matched = new Set<number>();
    for (const n of notes) {
      const i = truth.findIndex((g, j) => !matched.has(j) && g.midi === n.pitch && Math.abs(g.t - n.start) < 0.06);
      if (i >= 0) matched.add(i);
    }
    const precision = matched.size / notes.length;
    const recall = matched.size / truth.length;
    // Measured: precision 0.83, recall 0.85. Raw Basic Pitch output with its default thresholds: 0.48 / 0.89.
    expect(recall).toBeGreaterThanOrEqual(0.8);
    expect(precision).toBeGreaterThanOrEqual(0.75);
  });
});
