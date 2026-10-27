// Renders TaBello's menu music: an original, gently fingerpicked loop for nylon guitar, bass and a
// steel-string melody, played by alphaTab with the app's own soundfont, as the scores are. The notes
// ringing past the end are folded back onto the start, so the file loops without a seam.
// Run `npm run menu-music`; the output is deterministic.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as alphaTab from '@coderline/alphatab';
import ffmpegPath from 'ffmpeg-static';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'public', 'sounds', 'menu-music.ogg');
const SOUNDFONT = path.join(ROOT, 'src', 'renderer', 'public', 'soundfont', 'generaluser-gs-tabello.sf2');
const RATE = 48000;
const BPM = 80;
const BARS = 16;
/** Empty bars after the loop, to catch the notes still ringing. */
const TAIL_BARS = 2;

type Pick = [fret: number, string: number];

// One bar of eighth notes per chord, fingerpicked: bass, then up and down the treble strings.
const PATTERNS: Record<string, Pick[]> = {
  Am7: [[0, 5], [0, 3], [1, 2], [0, 1], [1, 2], [0, 3], [2, 4], [0, 3]],
  Fmaj7: [[1, 6], [2, 3], [1, 2], [0, 1], [1, 2], [2, 3], [3, 4], [2, 3]],
  C: [[3, 5], [0, 3], [1, 2], [0, 1], [1, 2], [0, 3], [2, 4], [0, 3]],
  'G/B': [[2, 5], [0, 3], [0, 2], [3, 1], [0, 2], [0, 3], [0, 4], [0, 3]],
  Dm7: [[0, 4], [2, 3], [1, 2], [1, 1], [1, 2], [2, 3], [0, 5], [2, 3]],
  // Esus4 resolving to E7, which leads back to the A minor of the first bar.
  E7: [[0, 6], [2, 3], [0, 2], [0, 1], [0, 6], [1, 3], [3, 2], [0, 1]],
};
const PROGRESSION = ['Am7', 'Fmaj7', 'C', 'G/B', 'Am7', 'Fmaj7', 'Dm7', 'E7'];

// Finger bass (strings G D A E): the root, the fifth, the root again.
const BASS: Record<string, string> = {
  Am7: '0.3.2 2.2.4 0.3.4',
  Fmaj7: '1.4.2 3.3.4 1.4.4',
  C: '3.3.2 0.1.4 3.3.4',
  'G/B': '2.3.2 0.2.4 2.3.4',
  Dm7: '0.2.2 0.3.4 0.2.4',
  E7: '0.4.2 2.3.4 0.4.4',
};

// The tune, on the first string, enters the second time round.
const MELODY = [
  '5.1.4 8.1.8 7.1.8 5.1.2',
  '3.1.4 5.1.4 0.1.2',
  '8.1.4{d} 7.1.8 5.1.4 3.1.4',
  '7.1.2 r.4 3.1.8 5.1.8',
  '8.1.4 10.1.4 12.1.4 10.1.4',
  '8.1.2 5.1.4 8.1.4',
  '10.1.4 8.1.4 5.1.4 3.1.4',
  '4.1.2 7.1.2',
];

const chords = [...PROGRESSION, ...PROGRESSION];
const rests = (n: number) => Array.from({ length: n }, () => 'r.1');
const tex = [
  `\\title "TaBello menu" \\tempo ${BPM}`,
  '.',
  '\\track "Nylon" \\staff {tabs} \\instrument acousticguitarnylon',
  [
    // Let ring: each string sounds on under the next ones, as when fingerpicking.
    ...chords.map((c) => PATTERNS[c].map(([fret, string], i) => `${fret}.${string}{lr}${i === 0 ? '.8' : ''}`).join(' ')),
    ...rests(TAIL_BARS),
  ].join(' |\n'),
  '\\track "Bass" \\staff {tabs} \\instrument electricbassfinger \\tuning G2 D2 A1 E1',
  [...chords.map((c) => BASS[c]), ...rests(TAIL_BARS)].join(' |\n'),
  '\\track "Melody" \\staff {tabs} \\instrument acousticguitarsteel',
  [...rests(PROGRESSION.length), ...MELODY, ...rests(TAIL_BARS)].join(' |\n'),
].join('\n');

const settings = new alphaTab.Settings();
const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex, settings);
// Accompaniment softer than the tune.
const [nylon, bass, melody] = score.tracks;
nylon.playbackInfo.volume = 9;
bass.playbackInfo.volume = 11;
melody.playbackInfo.volume = 16;
const midi = new alphaTab.midi.MidiFile();
new alphaTab.midi.MidiFileGenerator(score, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(midi)).generate();

// Offline rendering only: the synthesizer's output is never started.
const silent = {
  sampleRate: RATE,
  ready: { on() {} },
  samplesPlayed: { on() {} },
  sampleRequest: { on() {} },
  open() {},
  play() {},
  pause() {},
  destroy() {},
  activate() {},
  addSamples() {},
  resetSamples() {},
  enumerateOutputDevices: async () => [],
  setOutputDevice: async () => {},
  getOutputDevice: async () => null,
} as unknown as alphaTab.synth.ISynthOutput;
const options = new alphaTab.synth.AudioExportOptions();
options.sampleRate = RATE;
options.soundFonts = [new Uint8Array(readFileSync(SOUNDFONT))];
const exporter = new alphaTab.synth.AlphaSynth(silent, 500).exportAudio(options, midi, [], new Map());
const chunks: Float32Array[] = [];
for (let chunk = exporter.render(500); chunk; chunk = exporter.render(500)) chunks.push(chunk.samples);
const rendered = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
chunks.reduce((offset, c) => (rendered.set(c, offset), offset + c.length), 0);

// Stereo frames of the loop, then what rang past its end added onto its start.
const loopFrames = Math.round((BARS * 4 * 60 * RATE) / BPM);
const loop = rendered.slice(0, loopFrames * 2);
for (let i = loopFrames * 2; i < rendered.length; i++) loop[i - loopFrames * 2] += rendered[i];
const peak = loop.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
for (let i = 0; i < loop.length; i++) loop[i] = (loop[i] / peak) * 0.8;

mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync(
  ffmpegPath!,
  ['-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0',
    '-c:a', 'libopus', '-b:a', '96k', '-map_metadata', '-1', '-fflags', '+bitexact', OUT],
  { input: Buffer.from(loop.buffer) },
);
console.log(`${path.relative(process.cwd(), OUT)}: ${loopFrames / RATE} s loop`);
