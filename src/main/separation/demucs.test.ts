import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RATE, renderStrings } from '../transcription/testing/strings';
import { DEMUCS_SAMPLE_RATE, halveSampleRate, separateSource } from './demucs';

const require = createRequire(import.meta.url);
// The Node entry point lives in dist/, next to the WebAssembly files.
const wasmDir = path.dirname(require.resolve('onnxruntime-web'));
// The model is not in the repository (see model.ts); point TABELLO_DEMUCS_MODEL at htdemucs.onnx to run.
const modelPath = process.env.TABELLO_DEMUCS_MODEL;

const correlation = (a: Float32Array, b: Float32Array) => {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb || 1);
};

/** 44.1 kHz copy of a 22.05 kHz signal (sample-and-hold is enough for a test mix). */
const upsample = (x: Float32Array) => Float32Array.from({ length: x.length * 2 }, (_, i) => x[i >> 1]);

describe('halveSampleRate', () => {
  it('keeps low frequencies and removes those above the new Nyquist frequency', () => {
    const tone = (hz: number) => Float32Array.from({ length: 44100 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 44100));
    const rms = (x: Float32Array) => Math.sqrt(x.slice(100, -100).reduce((s, v) => s + v * v, 0) / (x.length - 200));
    expect(rms(halveSampleRate(tone(440)))).toBeCloseTo(Math.SQRT1_2, 1);
    expect(rms(halveSampleRate(tone(15000)))).toBeLessThan(0.02);
  });
});

describe.skipIf(!modelPath || !existsSync(modelPath))('separateSource (needs the Demucs model)', () => {
  it('isolates the bass line of a mix', { timeout: 600_000 }, async () => {
    const seconds = 10;
    const bass = renderStrings(
      Array.from({ length: 20 }, (_, i) => ({ start: i * 0.5, duration: 0.45, pitch: [33, 36, 38, 40][i % 4], amplitude: 0.6 })),
      seconds,
    );
    const guitar = renderStrings(
      Array.from({ length: 10 }, (_, i) => [57, 60, 64, 67].map((pitch, k) => ({ start: i + k * 0.01, duration: 0.9, pitch, amplitude: 0.3 }))).flat(),
      seconds,
    );
    expect(RATE * 2).toBe(DEMUCS_SAMPLE_RATE);
    const mix = upsample(bass.map((b, i) => 0.5 * b + 0.5 * guitar[i]));
    const stem = await separateSource(mix, mix, 'bass', { modelPath: modelPath!, wasmDir });
    const isolated = halveSampleRate(stem);
    expect(correlation(isolated, bass)).toBeGreaterThan(correlation(isolated, guitar) + 0.3);
  });
});
