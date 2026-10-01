// Audio → notes. Runs inside the transcription utility process (see worker.ts),
// but has no Electron dependency so it can be exercised directly from tests.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import type { ErrorCode, NoteEvent, Sensitivity } from '../../shared/ipc';
import { MAX_DURATION_SECONDS } from '../../shared/ipc';
import { analyzeArticulation, mergeBends, packContour, transientEnvelope } from './articulation';

/** Basic Pitch expects mono audio at this rate. */
export const SAMPLE_RATE = 22050;

// Note-detection thresholds. "high" is Basic Pitch's default; the stricter ones trade a few quiet
// notes for far fewer spurious re-onsets of ringing notes (measured on synthetic plucked strings).
const THRESHOLDS: Record<Sensitivity, { onset: number; frame: number }> = {
  low: { onset: 0.7, frame: 0.45 },
  normal: { onset: 0.6, frame: 0.4 },
  high: { onset: 0.5, frame: 0.3 },
};
// 11 frames ≈ 128 ms minimum note length.
const MIN_NOTE_FRAMES = 11;

export class PipelineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface DecodeOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  /** Output format: mono at 22.05 kHz (Basic Pitch) unless set; channels come interleaved. */
  sampleRate?: number;
  channels?: number;
  /** Longest accepted input. */
  maxSeconds?: number;
}

function parseTimestamp(value: string): number {
  const [h, m, s] = value.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Decodes the first audio stream of any FFmpeg-readable file to 32-bit float PCM (mono 22.05 kHz by default). */
export function decodeAudio(ffmpegPath: string, inputPath: string, options: DecodeOptions = {}): Promise<Float32Array> {
  const rate = options.sampleRate ?? SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const maxSeconds = options.maxSeconds ?? MAX_DURATION_SECONDS;
  const tooLong = () => new PipelineError('too-long', `Files longer than ${maxSeconds / 60} minutes are not supported${options.maxSeconds ? ' with this option' : ' yet'}.`);
  const args = [
    '-hide_banner', '-nostdin',
    '-i', inputPath,
    '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-ac', String(channels), '-ar', String(rate),
    // Hard cap, in case the container reports no duration.
    '-t', String(maxSeconds + 1),
    '-f', 'f32le', 'pipe:1',
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args, { signal: options.signal, windowsHide: true });
    const chunks: Buffer[] = [];
    let stderrTail = '';
    let durationSeconds: number | null = null;
    let failure: PipelineError | null = null;

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (text: string) => {
      stderrTail = (stderrTail + text).slice(-4000);

      if (durationSeconds === null) {
        const match = /Duration: (\d+:\d+:\d+(?:\.\d+)?)/.exec(stderrTail);
        if (match) {
          durationSeconds = parseTimestamp(match[1]);
          if (durationSeconds > maxSeconds) {
            failure = tooLong();
            ffmpeg.kill();
          }
        }
      }
      const times = [...text.matchAll(/time=(\d+:\d+:\d+(?:\.\d+)?)/g)];
      if (durationSeconds && times.length > 0) {
        const elapsed = parseTimestamp(times[times.length - 1][1]);
        options.onProgress?.(Math.min(1, elapsed / durationSeconds));
      }
    });

    ffmpeg.on('error', (error) => {
      if (error.name === 'AbortError') reject(new PipelineError('cancelled', 'Transcription cancelled.'));
      else reject(new PipelineError('failed', `Could not start FFmpeg: ${error.message}`));
    });

    ffmpeg.on('close', (code) => {
      if (failure) return reject(failure);
      if (options.signal?.aborted) return reject(new PipelineError('cancelled', 'Transcription cancelled.'));
      if (code !== 0) {
        if (/matches no streams|does not contain any stream/i.test(stderrTail)) {
          return reject(new PipelineError('no-audio', 'This file does not contain an audio track.'));
        }
        const reason = stderrTail.trim().split('\n').pop() ?? `exit code ${code}`;
        return reject(new PipelineError('failed', `FFmpeg could not read this file: ${reason}`));
      }

      const bytes = Buffer.concat(chunks);
      // Copy into a fresh, aligned buffer: Buffer.concat may return a pooled, unaligned slice.
      const samples = new Float32Array(Math.floor(bytes.byteLength / 4));
      new Uint8Array(samples.buffer).set(bytes.subarray(0, samples.byteLength));
      if (samples.length === 0) return reject(new PipelineError('no-audio', 'This file does not contain any audio.'));
      if (samples.length / channels / rate > maxSeconds) return reject(tooLong());
      options.onProgress?.(1);
      resolve(samples);
    });
  });
}

/** Where the WebAssembly binaries and the Basic Pitch model live on disk. */
export interface ModelAssets {
  /** Folder containing the tfjs-backend-wasm `.wasm` files. */
  wasmDir: string;
  /** Folder containing Basic Pitch's `model.json` and weights. */
  modelDir: string;
}

let tfReady: Promise<void> | null = null;

/** Initializes TensorFlow.js with the WebAssembly backend (no native binaries needed). */
function initTensorFlow(wasmDir: string): Promise<void> {
  tfReady ??= (async () => {
    setWasmPaths(wasmDir + path.sep);
    if (!(await tf.setBackend('wasm'))) throw new PipelineError('failed', 'Could not initialize the WebAssembly backend.');
    await tf.ready();
  })();
  return tfReady;
}

/** Loads the Basic Pitch model straight from disk. */
async function loadModel(modelDir: string) {
  const manifest = JSON.parse(await readFile(path.join(modelDir, 'model.json'), 'utf8'));
  const [weightsGroup] = manifest.weightsManifest;
  const weights = await readFile(path.join(modelDir, weightsGroup.paths[0]));
  return loadGraphModel(
    tf.io.fromMemory({
      modelTopology: manifest.modelTopology,
      format: manifest.format,
      generatedBy: manifest.generatedBy,
      convertedBy: manifest.convertedBy,
      userDefinedMetadata: manifest.userDefinedMetadata,
      weightSpecs: weightsGroup.weights,
      weightData: weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength),
    }),
  );
}

export interface DetectNotesOptions {
  assets: ModelAssets;
  minHz: number;
  maxHz: number;
  sensitivity?: Sensitivity;
  onProgress?: (fraction: number) => void;
}

/**
 * Merges "re-triggered" notes back into the note they continue. When a new note starts, Basic Pitch
 * often reports a fresh onset for notes that are still ringing; those phantom onsets start exactly
 * where the previous same-pitch note ends and are clearly weaker, whereas a real re-pick is about as loud.
 */
export function mergeRetriggeredNotes(notes: NoteEvent[]): NoteEvent[] {
  const merged: NoteEvent[] = [];
  const lastByPitch = new Map<number, NoteEvent>();
  for (const note of [...notes].sort((a, b) => a.start - b.start)) {
    const previous = lastByPitch.get(note.pitch);
    const gap = previous ? note.start - (previous.start + previous.duration) : Infinity;
    // A same-pitch note without any attack shortly after is the ringing note detected again.
    const contiguous = Math.abs(gap) < 0.05 || (note.attack !== undefined && note.attack < 0.2 && gap > -0.05 && gap < 0.15);
    // Weaker in loudness, or without a new attack (when the attack is known).
    const weaker =
      previous !== undefined &&
      (note.velocity < previous.velocity * 0.9 ||
        (note.attack !== undefined && previous.attack !== undefined && note.attack < 0.3 && note.attack < previous.attack * 0.5));
    if (previous && contiguous && weaker) {
      previous.duration = Number((note.start + note.duration - previous.start).toFixed(4));
      continue;
    }
    const copy = { ...note };
    merged.push(copy);
    lastByPitch.set(note.pitch, copy);
  }
  return merged;
}

// Intervals (in semitones) at which a string's overtones are often mistaken for extra notes.
const HARMONIC_INTERVALS = new Set([12, 19, 24]);

/**
 * Drops notes that are most likely overtones of a louder note starting at the same time:
 * an octave, octave + fifth or two octaves above it, and much quieter.
 */
export function removeHarmonics(notes: NoteEvent[]): NoteEvent[] {
  return notes.filter(
    (note) =>
      !notes.some(
        (base) =>
          base !== note &&
          Math.abs(base.start - note.start) < 0.05 &&
          HARMONIC_INTERVALS.has(note.pitch - base.pitch) &&
          note.velocity < base.velocity * 0.6,
      ),
  );
}

/** Runs polyphonic pitch detection on mono 22.05 kHz audio. */
export async function detectNotes(audio: Float32Array, options: DetectNotesOptions): Promise<NoteEvent[]> {
  await initTensorFlow(options.assets.wasmDir);
  // Basic Pitch is typed against the umbrella `@tensorflow/tfjs` package; the GraphModel is the same class.
  const basicPitch = new BasicPitch(loadModel(options.assets.modelDir) as unknown as ConstructorParameters<typeof BasicPitch>[0]);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  // Pitch contours (3 bins per semitone) reveal bends, slides and vibrato; bytes are precise enough.
  const contours: Uint8Array[] = [];
  await basicPitch.evaluateModel(
    audio,
    (f, o, c) => {
      for (const row of f) frames.push(row);
      for (const row of o) onsets.push(row);
      for (const row of c) contours.push(packContour(row));
    },
    (fraction) => options.onProgress?.(fraction),
  );

  const { onset, frame } = THRESHOLDS[options.sensitivity ?? 'normal'];
  const events = outputToNotesPoly(frames, onsets, onset, frame, MIN_NOTE_FRAMES, true, options.maxHz, options.minHz);
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  const context = { onsets, contours, transients: transientEnvelope(audio) };
  const notes = noteFramesToTime(events)
    .map((note, i) => ({
      start: round(note.startTimeSeconds, 4),
      duration: round(note.durationSeconds, 4),
      pitch: note.pitchMidi,
      velocity: round(note.amplitude, 3),
      ...analyzeArticulation(events[i], note.startTimeSeconds, context),
    }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return mergeBends(mergeRetriggeredNotes(removeHarmonics(notes)));
}
