// Renders the sample recordings in resources/samples (see scripts/samples/scores.ts):
//   npm run samples
// The output is deterministic, so regenerating gives the same files.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { RATE, renderStrings } from '../src/main/transcription/testing/strings';
import { PIECES, type DrumHit, type Part } from './samples/scores';
import type { SynthNote } from '../src/main/transcription/testing/strings';

const OUT_DIR = path.join(import.meta.dirname, '..', 'resources', 'samples');

/** A voice-like lead: soft attack, bright harmonics, gentle vibrato. */
function renderLead(notes: SynthNote[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (const note of notes) {
    const start = Math.round(note.start * RATE);
    const length = Math.round(note.duration * RATE);
    let phase = 0;
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / RATE;
      const pitch = note.pitch + 0.15 * Math.sin(2 * Math.PI * 5 * t) * Math.min(1, t / 0.3);
      phase += (2 * Math.PI * 440 * 2 ** ((pitch - 69) / 12)) / RATE;
      const envelope = Math.min(1, t / 0.06) * Math.min(1, (length - i) / (0.05 * RATE));
      let sample = 0;
      for (let k = 1; k <= 8; k++) sample += Math.sin(phase * k) / (k * k * 0.6 + 0.4);
      out[start + i] += (note.amplitude ?? 0.5) * envelope * sample;
    }
  }
  return out;
}

function renderDrums(hits: DrumHit[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  let seed = 11;
  const noise = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) * 2 - 1;
  for (const { time, kind } of hits) {
    const start = Math.round(time * RATE);
    const length = Math.round((kind === 'hat' ? 0.05 : kind === 'snare' ? 0.18 : 0.3) * RATE);
    let phase = 0;
    let previous = 0;
    for (let i = 0; i < length && start + i < out.length; i++) {
      const t = i / RATE;
      let sample: number;
      if (kind === 'kick') {
        phase += (2 * Math.PI * (50 + 90 * Math.exp(-t * 30))) / RATE;
        sample = Math.sin(phase) * Math.exp(-t * 12);
      } else if (kind === 'snare') {
        phase += (2 * Math.PI * 190) / RATE;
        sample = (0.6 * noise() + 0.4 * Math.sin(phase)) * Math.exp(-t * 20) * 0.7;
      } else {
        // High-passed noise.
        const n = noise();
        sample = (n - previous) * Math.exp(-t * 60) * 0.25;
        previous = n;
      }
      out[start + i] += sample;
    }
  }
  return out;
}

function renderPart(part: Part, seconds: number): Float32Array {
  return part.kind === 'lead' ? renderLead(part.notes, seconds) : renderStrings(part.notes, seconds);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const piece of PIECES) {
  const frames = Math.ceil(piece.seconds * RATE);
  const stereo = new Float32Array(frames * 2);
  const add = (signal: Float32Array, pan: number, gain: number) => {
    const peak = signal.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
    // Constant-power panning.
    const angle = ((pan + 1) * Math.PI) / 4;
    const [left, right] = [Math.cos(angle), Math.sin(angle)];
    for (let i = 0; i < frames; i++) {
      const v = ((signal[i] ?? 0) / peak) * gain;
      stereo[2 * i] += v * left;
      stereo[2 * i + 1] += v * right;
    }
  };
  for (const part of piece.parts) add(renderPart(part, piece.seconds), part.pan, part.gain);
  if (piece.drums) add(renderDrums(piece.drums, piece.seconds), 0, 0.55);
  const peak = stereo.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  for (let i = 0; i < stereo.length; i++) stereo[i] = (stereo[i] / peak) * 0.89;

  const file = path.join(OUT_DIR, piece.file);
  execFileSync(
    ffmpegPath!,
    ['-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0',
      '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', '-map_metadata', '-1', '-fflags', '+bitexact', file],
    { input: Buffer.from(stereo.buffer) },
  );
  console.log(`${piece.file}: ${piece.seconds.toFixed(1)} s`);
}
