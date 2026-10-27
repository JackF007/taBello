// Renders TaBello's startup sound, an original two-second motif played by the same plucked-string
// synthesizer as the sample tracks: a quick pentatonic run up, then an open A(add9) chord strummed
// and left to ring. Run `npm run startup-sound`; the output is deterministic.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { RATE, renderStrings, type SynthNote } from '../src/main/transcription/testing/strings';

const OUT = path.join(import.meta.dirname, '..', 'src', 'renderer', 'public', 'sounds', 'startup.ogg');
const SECONDS = 2.6;

// A3 C4 D4 E4 G4 A4: up the A minor pentatonic, one string after another.
const run: SynthNote[] = [57, 60, 62, 64, 67, 69].map((pitch, i) => ({ start: 0.05 + i * 0.075, duration: 0.3, pitch, amplitude: 0.35 + i * 0.04 }));
// A(add9), open: A2 E3 B3 C#4 E4 A4, strummed down in 18 ms steps.
const chord: SynthNote[] = [45, 52, 59, 61, 64, 69].map((pitch, i) => ({ start: 0.55 + i * 0.018, duration: 1.9, pitch, amplitude: 0.55, vibrato: i === 5 ? 0.08 : 0 }));

mkdirSync(path.dirname(OUT), { recursive: true });
const mono = renderStrings([...run, ...chord], SECONDS);
const frames = mono.length;
const stereo = new Float32Array(frames * 2);
const peak = mono.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
for (let i = 0; i < frames; i++) {
  // A gentle fade-out over the last half second.
  const fade = Math.min(1, (frames - i) / (0.5 * RATE));
  const v = (mono[i] / peak) * 0.8 * fade;
  stereo[2 * i] = v;
  stereo[2 * i + 1] = v;
}
execFileSync(
  ffmpegPath!,
  ['-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0',
    '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', '-map_metadata', '-1', '-fflags', '+bitexact', OUT],
  { input: Buffer.from(stereo.buffer) },
);
console.log(`${path.relative(process.cwd(), OUT)}: ${SECONDS} s`);
