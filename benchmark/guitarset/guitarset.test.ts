import ffmpegPath from 'ffmpeg-static';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../../src/shared/instruments';
import { arrange } from '../../src/renderer/src/lib/music/arrange';
import { parseJams, type ReferenceNote } from './jams';
import { matchNotes, noteScores, stringAccuracy } from './metrics';
import { benchmarkTrack } from './run';

const note = (start: number, pitch: number, string = 0): ReferenceNote => ({ start, duration: 0.4, pitch, velocity: 1, string });

describe('parseJams', () => {
  it('reads notes per string, in both JAMS data layouts', () => {
    const jams = {
      annotations: [
        { namespace: 'tempo', data: [{ time: 0, duration: 10, value: 96, confidence: 1 }] },
        {
          namespace: 'note_midi',
          annotation_metadata: { data_source: '0' },
          data: [{ time: 0.5, duration: 0.4, value: 40.1, confidence: null }],
        },
        {
          namespace: 'note_midi',
          annotation_metadata: { data_source: '5' },
          data: { time: [0.1, 1.2], duration: [0.3, 0.2], value: [63.8, 67], confidence: [null, null] },
        },
        { namespace: 'pitch_contour', annotation_metadata: { data_source: '0' }, data: [] },
      ],
    };
    const { notes, tempo } = parseJams(jams);
    expect(tempo).toBe(96);
    expect(notes.map((n) => [n.start, n.pitch, n.string])).toEqual([[0.1, 64, 5], [0.5, 40, 0], [1.2, 67, 5]]);
  });
});

describe('metrics', () => {
  it('matches notes one-to-one by pitch and onset', () => {
    const reference = [note(0, 60), note(0.5, 64), note(1, 67)];
    const estimate = [note(0.02, 60), note(0.03, 60), note(0.5, 65), note(1.04, 67)];
    const matches = matchNotes(reference, estimate);
    expect(matches).toEqual([[0, 0], [2, 3]]);
    const scores = noteScores(reference.length, estimate.length, matches.length);
    expect(scores.precision).toBe(0.5);
    expect(scores.recall).toBeCloseTo(2 / 3);
    expect(scores.f1).toBeCloseTo(4 / 7);
  });

  it('measures how many notes are on the right string', () => {
    // A4 is the open 5th string, or the 5th fret of the 6th string.
    const reference = [note(0, 45, 1), note(0.5, 45, 0)];
    const guitar = INSTRUMENTS.guitar;
    const arrangement = arrange(reference.map(({ string: _s, ...n }) => n), {
      tuning: guitar.tunings[0].strings, frets: guitar.frets, bpm: 120, offset: 0,
    });
    expect(stringAccuracy(reference, arrangement, [[0, 0], [1, 1]])).toBe(0.5);
  });
});

describe('benchmarkTrack', () => {
  /** Karplus–Strong plucked strings at 22.05 kHz, written as 16-bit WAV. */
  function pluckedWav(notes: ReferenceNote[], seconds: number): Buffer {
    const rate = 22050;
    const out = new Float32Array(seconds * rate);
    let seed = 3;
    const noise = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 2 - 1;
    for (const n of notes) {
      const period = Math.round(rate / (440 * 2 ** ((n.pitch - 69) / 12)));
      const buffer = Float32Array.from({ length: period }, noise);
      const start = Math.round(n.start * rate);
      for (let i = 0; i < n.duration * rate && start + i < out.length; i++) {
        const j = i % period;
        const sample = buffer[j];
        buffer[j] = 0.996 * 0.5 * (sample + buffer[(j + 1) % period]);
        out[start + i] += sample * 0.4;
      }
    }
    const peak = out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    const wav = Buffer.alloc(44 + out.length * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + out.length * 2, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24);
    wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(out.length * 2, 40);
    out.forEach((x, i) => wav.writeInt16LE(Math.round((x / peak) * 0.8 * 32767), 44 + i * 2));
    return wav;
  }

  it('scores a synthesized GuitarSet-style track', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tabello-guitarset-'));
    try {
      // A melody on the G and B strings, as annotated in GuitarSet (data_source = string, 0 = low E).
      const melody = [[55, 3], [57, 3], [59, 4], [60, 4], [62, 4], [60, 4], [59, 4], [57, 3]].map(([pitch, string], i) => note(0.5 + i * 0.5, pitch, string));
      const jams = {
        annotations: [0, 1, 2, 3, 4, 5].map((string) => ({
          namespace: 'note_midi',
          annotation_metadata: { data_source: String(string) },
          data: melody.filter((n) => n.string === string).map((n) => ({ time: n.start, duration: n.duration, value: n.pitch, confidence: null })),
        })),
      };
      const jamsPath = path.join(dir, 'track.jams');
      const audioPath = path.join(dir, 'track_mic.wav');
      await writeFile(jamsPath, JSON.stringify(jams));
      await writeFile(audioPath, pluckedWav(melody, 5));

      const require = createRequire(import.meta.url);
      const assets = {
        wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
        modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
      };
      const result = await benchmarkTrack({ jamsPath, audioPath, ffmpegPath: ffmpegPath!, assets });
      expect(result.referenceNotes).toBe(8);
      expect(result.f1).toBeGreaterThan(0.8);
      expect(result.fingeringAccuracy).toBeGreaterThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
