// The bundled samples, through the real pipeline: what someone trying TaBello will see.
import ffmpegPath from 'ffmpeg-static';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchNotes, noteScores } from '../../benchmark/guitarset/metrics';
import { halveSampleRate, DEMUCS_SAMPLE_RATE, separateSource } from '../../src/main/separation/demucs';
import { decodeAudio, detectNotes } from '../../src/main/transcription/pipeline';
import { INSTRUMENTS } from '../../src/shared/instruments';
import { getSample } from '../../src/shared/samples';
import { arrange } from '../../src/renderer/src/lib/music/arrange';
import { detectTempoChanges } from '../../src/renderer/src/lib/music/tempo';
import { detectKey, detectMeter, estimateTempo } from '../../src/renderer/src/lib/music/theory';
import { RATE } from '../../src/main/transcription/testing/strings';
import { saintsBass } from './scores';

const require = createRequire(import.meta.url);
const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};
const samplePath = (id: string) => path.join(import.meta.dirname, '../../resources/samples', getSample(id)!.file);

async function transcribe(id: string) {
  const sample = getSample(id)!;
  const instrument = INSTRUMENTS[sample.instrument];
  const audio = await decodeAudio(ffmpegPath!, samplePath(id));
  const notes = await detectNotes(audio, { assets, minHz: instrument.minHz, maxHz: instrument.maxHz });
  const tempo = estimateTempo(notes);
  const steady = detectMeter(notes, tempo);
  const changes = detectTempoChanges(notes, tempo.bpm);
  const beats = changes.variable ? changes.beats : undefined;
  const meter = beats ? detectMeter(notes, tempo, beats) : steady;
  const arrangement = arrange(notes, {
    tuning: instrument.tunings[0].strings, frets: instrument.frets, bpm: tempo.bpm, offset: steady.offset, beats, meter: meter.meter, barPhase: meter.barPhase,
  });
  const techniques = arrangement.bars.flat().flatMap((b) => b.notes).flatMap((n) => Object.keys(n.techniques ?? {}));
  return { notes, tempo, meter, changes, key: detectKey(notes), arrangement, techniques };
}

describe('samples', { timeout: 120_000 }, () => {
  it('Greensleeves: 3/4 with a pickup, A minor, nothing but picked notes', async () => {
    const result = await transcribe('greensleeves');
    expect(result.meter).toMatchObject({ meter: '3/4', barPhase: 1 });
    expect(result.key.name).toBe('A minor');
    expect(result.techniques).toEqual([]);
  });

  it('Romance: triplets in 3/4 at 66 BPM, the melody on the beat', async () => {
    const result = await transcribe('romance');
    expect(result.tempo.bpm).toBeCloseTo(66, -0.5);
    expect(result.meter.meter).toBe('3/4-triplets');
    expect(result.key.name).toBe('E minor');
    const [firstBar] = result.arrangement.bars;
    expect(firstBar.filter((_, i) => i % 3 === 0).map((b) => Math.max(...b.notes.map((n) => n.pitch)))).toEqual([71, 71, 71]);
    expect(result.techniques).toEqual([]);
  });

  it('Minuet in G: the tempo speeds up', async () => {
    const result = await transcribe('minuet');
    expect(result.changes.variable).toBe(true);
    expect(result.meter.meter).toBe('3/4');
    expect(result.key.name).toBe('G major');
  });

  it('Blues lick: bends, hammer-ons, pull-offs, slides and vibrato', async () => {
    const { techniques } = await transcribe('blues-lick');
    for (const technique of ['bend', 'release', 'hammer', 'slide', 'vibrato']) expect(techniques).toContain(technique);
  });

  it('Ode to Joy on ukulele: C major, 4/4', async () => {
    const result = await transcribe('ode-to-joy');
    expect(result.meter.meter).toBe('4/4');
    expect(result.key.name).toBe('C major');
    expect(result.techniques).toEqual([]);
  });
});

// Needs the Demucs model: TABELLO_DEMUCS_MODEL=/path/to/htdemucs.onnx
const modelPath = process.env.TABELLO_DEMUCS_MODEL;
describe.skipIf(!modelPath || !existsSync(modelPath))('separation on the band sample', () => {
  it('isolating the bass gives a much cleaner bass transcription', { timeout: 900_000 }, async () => {
    const bass = INSTRUMENTS.bass;
    const truth = saintsBass();
    const score = (notes: { start: number; pitch: number; duration: number; velocity: number }[]) => {
      const reference = truth.map((n) => ({ start: n.start, duration: n.duration, pitch: n.pitch, velocity: 1 }));
      return noteScores(reference.length, notes.length, matchNotes(reference, notes).length);
    };
    const mixed = await detectNotes(await decodeAudio(ffmpegPath!, samplePath('saints')), { assets, minHz: bass.minHz, maxHz: bass.maxHz });

    const stereo = await decodeAudio(ffmpegPath!, samplePath('saints'), { sampleRate: DEMUCS_SAMPLE_RATE, channels: 2 });
    const left = stereo.filter((_, i) => i % 2 === 0);
    const right = stereo.filter((_, i) => i % 2 === 1);
    const ortDir = path.dirname(require.resolve('onnxruntime-web'));
    const stem = await separateSource(left, right, 'bass', { modelPath: modelPath!, wasmDir: ortDir });
    expect(RATE * 2).toBe(DEMUCS_SAMPLE_RATE);
    const isolated = await detectNotes(halveSampleRate(stem), { assets, minHz: bass.minHz, maxHz: bass.maxHz });

    const before = score(mixed);
    const after = score(isolated);
    console.log('bass from the mix', before, '→ isolated', after);
    expect(after.precision).toBeGreaterThan(before.precision + 0.2);
    expect(after.f1).toBeGreaterThan(0.8);
  });
});
