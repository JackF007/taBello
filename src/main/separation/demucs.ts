// Source separation with Hybrid Transformer Demucs (htdemucs, Meta) running on ONNX Runtime's
// WebAssembly backend. Adapted from demucs-js by Kevin Gibbons (MIT): the model takes 7.8 s stereo
// chunks at 44.1 kHz plus their spectrogram, and returns per-source spectrogram masks and waveforms.
// Only the requested source is reconstructed, mixed down to mono.
import * as ort from 'onnxruntime-web';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ispec, magnitude, spec, type ComplexTensor, type Tensor } from './demucs-js/dsp.js';

export const DEMUCS_SAMPLE_RATE = 44100;
/** The model's sources, in output order. */
export const DEMUCS_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;
export type DemucsSource = (typeof DEMUCS_SOURCES)[number];

const SEGMENT = Math.floor(7.8 * DEMUCS_SAMPLE_RATE);

export interface SeparateOptions {
  /** Path of htdemucs.onnx. */
  modelPath: string;
  /** Folder with ONNX Runtime's `ort-wasm-simd-threaded.{mjs,wasm}`. */
  wasmDir: string;
  /** Overlap between chunks (0–0.5): more is smoother and slower. */
  overlap?: number;
  /** WebAssembly threads (default: ONNX Runtime's choice). */
  threads?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

let configured = false;

function configureRuntime(wasmDir: string, threads = 0): void {
  if (configured) return;
  const url = (file: string) => pathToFileURL(path.join(wasmDir, file)).href;
  ort.env.wasm.wasmPaths = { mjs: url('ort-wasm-simd-threaded.mjs'), wasm: url('ort-wasm-simd-threaded.wasm') };
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = 'error';
  configured = true;
}

/** Chunk [offset, offset + length) of a planar [2, total] signal, centred in `target` samples. */
function paddedChunk(left: Float32Array, right: Float32Array, offset: number, length: number, target: number): Tensor {
  const total = left.length;
  const start = offset - Math.floor((target - length) / 2);
  const data = new Float32Array(2 * target);
  for (let i = Math.max(0, -start); i < target && start + i < total; i++) {
    data[i] = left[start + i];
    data[target + i] = right[start + i];
  }
  return { data, shape: [1, 2, target] };
}

/** The masks of one source, as complex spectrogram [1, 1, 2, freq, time]. */
function sourceMask(outX: Tensor, source: number): ComplexTensor {
  const [, , channels, freq, time] = outX.shape;
  const half = channels / 2;
  const plane = freq * time;
  const shape = [1, 1, half, freq, time];
  const real = new Float32Array(half * plane);
  const imag = new Float32Array(half * plane);
  const base = source * channels * plane;
  for (let c = 0; c < half; c++) {
    real.set(outX.data.subarray(base + 2 * c * plane, base + (2 * c + 1) * plane), c * plane);
    imag.set(outX.data.subarray(base + (2 * c + 1) * plane, base + (2 * c + 2) * plane), c * plane);
  }
  return { real: { data: real, shape }, imag: { data: imag, shape } };
}

/**
 * Separates one source from a stereo 44.1 kHz recording and returns it as mono 44.1 kHz.
 * Takes roughly 1–2 × the recording's duration on a recent CPU.
 */
export async function separateSource(left: Float32Array, right: Float32Array, source: DemucsSource, options: SeparateOptions): Promise<Float32Array> {
  configureRuntime(options.wasmDir, options.threads);
  const session = await ort.InferenceSession.create(options.modelPath, { executionProviders: ['wasm'] });
  try {
    const [mixName, specName] = session.inputNames;
    const [freqName, timeName] = session.outputNames;
    const sourceIndex = DEMUCS_SOURCES.indexOf(source);
    const length = left.length;
    const stride = Math.floor((1 - (options.overlap ?? 0.25)) * SEGMENT);

    // Triangular weights cross-fade overlapping chunks.
    const weight = new Float32Array(SEGMENT);
    for (let i = 0; i < SEGMENT; i++) weight[i] = Math.min(i + 1, SEGMENT - i);
    const peak = weight.reduce((max, w) => Math.max(max, w), 0);
    for (let i = 0; i < SEGMENT; i++) weight[i] /= peak;

    const out = new Float32Array(length);
    const weights = new Float32Array(length);
    const total = Math.ceil(length / stride);
    for (let chunk = 0, offset = 0; offset < length; chunk++, offset += stride) {
      if (options.signal?.aborted) throw new Error('aborted');
      const chunkLength = Math.min(SEGMENT, length - offset);
      const mix = paddedChunk(left, right, offset, chunkLength, SEGMENT);
      const z = spec(mix);
      const magspec = magnitude(z);
      const results = await session.run({
        [mixName]: new ort.Tensor('float32', mix.data as Float32Array, mix.shape as number[]),
        [specName]: new ort.Tensor('float32', magspec.data as Float32Array, magspec.shape as number[]),
      });
      const outX = results[freqName];
      const outXt = results[timeName];
      // Spectrogram branch (inverse STFT of the masked spectrum) + waveform branch, for one source.
      const fromSpec = ispec(sourceMask({ data: outX.data as Float32Array, shape: outX.dims }, sourceIndex), SEGMENT);
      const wave = outXt.data as Float32Array;
      const waveBase = sourceIndex * 2 * SEGMENT;
      const trim = Math.floor((SEGMENT - chunkLength) / 2);
      for (let t = 0; t < chunkLength; t++) {
        const i = trim + t;
        const sample = (wave[waveBase + i] + wave[waveBase + SEGMENT + i] + fromSpec.data[i] + fromSpec.data[SEGMENT + i]) / 2;
        out[offset + t] += weight[t] * sample;
        weights[offset + t] += weight[t];
      }
      options.onProgress?.(Math.min(1, (chunk + 1) / total));
    }
    for (let i = 0; i < length; i++) if (weights[i] > 0) out[i] /= weights[i];
    return out;
  } finally {
    await session.release();
  }
}

/**
 * Halves the sample rate (44.1 → 22.05 kHz) with a windowed-sinc low-pass filter, for Basic Pitch.
 */
export function halveSampleRate(input: Float32Array): Float32Array {
  const taps = 31;
  const half = (taps - 1) / 2;
  // Cut-off at 90% of the new Nyquist frequency (≈ 9.9 kHz), in cycles per input sample; Blackman window.
  const cutoff = 0.45 * 0.5;
  const kernel = Array.from({ length: taps }, (_, i) => {
    const n = i - half;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    return sinc * blackman;
  });
  const sum = kernel.reduce((s, v) => s + v, 0);
  const out = new Float32Array(Math.floor(input.length / 2));
  for (let o = 0; o < out.length; o++) {
    const center = 2 * o;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const j = center + k - half;
      if (j >= 0 && j < input.length) acc += input[j] * kernel[k];
    }
    out[o] = acc / sum;
  }
  return out;
}
