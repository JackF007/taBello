// Fingering benchmark: passages written the way a guitar teacher would tab them. The exact notes go
// in (no audio), so this measures only where TaBello puts them: the string and fret of every note.
import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../../../../shared/ipc';
import { arrange } from './arrange';

const STANDARD = [40, 45, 50, 55, 59, 64];
const BPM = 100;
const EIGHTH = 60 / BPM / 2;

/**
 * A passage in tab: steps of "string:fret" (strings numbered as guitarists do, 6 = low E), several
 * per step for notes struck together, each step lasting `eighths`; "b" after a note bends it a tone,
 * "v" adds vibrato. When teachers would write a step in more than one way, the ways are separated by
 * "|" and any of them is right. `ring` lets every note sound until the end of its bar (arpeggios,
 * "let ring"); otherwise a note lasts until the next step.
 */
interface Passage {
  name: string;
  steps: [string, number?][];
  ring?: boolean;
  /** Share of notes that must be placed exactly as written. */
  minimum: number;
}

type Place = { string: number; fret: number };

function parse(passage: Passage) {
  const notes: NoteEvent[] = [];
  // For each step: its notes' indices and the accepted ways to play it.
  const steps: { indices: number[]; ways: Place[][] }[] = [];
  let time = 0.5;
  const barEighths = 8;
  let eighths = 0;
  for (const [step, length = 1] of passage.steps) {
    const barEnd = 0.5 + (Math.floor(eighths / barEighths) + 1) * barEighths * EIGHTH;
    const ways = step.split('|').map((way) =>
      way.split(' ').filter(Boolean).map((token) => {
        const [s, f] = token.replace(/[bv]$/, '').split(':').map(Number);
        return { string: 6 - s, fret: f, technique: token.at(-1) };
      }),
    );
    const indices: number[] = [];
    for (const { string, fret, technique } of ways[0]) {
      indices.push(notes.length);
      notes.push({
        start: time,
        duration: passage.ring ? barEnd - time - 0.02 : length * EIGHTH * 0.95,
        pitch: STANDARD[string] + fret,
        velocity: 0.7,
        ...(technique === 'b' ? { bend: 2 } : technique === 'v' ? { vibrato: true } : {}),
      });
    }
    steps.push({ indices, ways: ways.map((way) => way.map(({ string, fret }) => ({ string, fret }))) });
    time += length * EIGHTH;
    eighths += length;
  }
  return { notes, steps };
}

/** Share of notes placed on the written string and fret. */
function score(passage: Passage) {
  const { notes, steps } = parse(passage);
  const arrangement = arrange(notes, { tuning: STANDARD, frets: 22, bpm: BPM, offset: 0.5, voices: false });
  const placed = new Map<number, { string: number; fret: number }>();
  for (const voice of [arrangement.bars, ...(arrangement.bass ? [arrangement.bass] : [])])
    for (const bar of voice) for (const beat of bar) for (const note of beat.notes) if (!note.tied) for (const k of note.sources) placed.set(k, note);
  const wrong: string[] = [];
  let right = 0;
  const tab = (p: Place | undefined) => (p ? `${6 - p.string}:${p.fret}` : '-');
  for (const { indices, ways } of steps) {
    // Each note is matched by pitch to its place in a way of playing the step.
    const matches = (way: Place[]) => indices.every((k) => way.some((w) => w.string === placed.get(k)?.string && w.fret === placed.get(k)?.fret));
    if (ways.some(matches)) right += indices.length;
    else wrong.push(`${ways[0].map(tab).join('+')}→${indices.map((k) => tab(placed.get(k))).join('+')}`);
  }
  return { accuracy: right / notes.length, wrong };
}

const bars = (...steps: string[]): [string][] => steps.map((s) => [s]);

export const PASSAGES: Passage[] = [
  {
    name: 'A minor arpeggio, let ring',
    steps: bars('5:0', '4:2', '3:2', '1:0', '5:0', '4:2', '3:2', '2:1'),
    ring: true,
    minimum: 1,
  },
  {
    name: 'descending bass arpeggio (C/G, D/F#, F, E)',
    steps: bars(
      '6:3', '4:2', '3:0', '2:3', '6:3', '4:2', '3:0', '2:1',
      '6:2', '4:0', '3:2', '2:3', '6:2', '4:0', '3:2', '2:1',
      '6:1', '4:3', '3:2', '2:1', '6:0', '4:2', '3:1', '2:0',
    ),
    ring: true,
    minimum: 1,
  },
  {
    name: 'open chords, strummed',
    steps: [
      ['6:3 5:2 4:0 3:0 2:0 1:3', 4], ['5:3 4:2 3:0 2:1 1:0', 4], ['4:0 3:2 2:3 1:2', 4], ['6:0 5:2 4:2 3:0 2:0 1:0', 4],
      ['5:0 4:2 3:2 2:1 1:0', 4], ['6:0 5:2 4:2 3:1 2:0 1:0', 4], ['5:0 4:2 3:2 2:2 1:0', 4], ['4:0 3:2 2:3 1:1', 4],
    ],
    minimum: 1,
  },
  {
    name: 'barre chords (F, Bm, B flat, G at the 3rd fret)',
    steps: [['6:1 5:3 4:3 3:2 2:1 1:1', 4], ['5:2 4:4 3:4 2:3 1:2', 4], ['5:1 4:3 3:3 2:3 1:1', 4], ['6:3 5:5 4:5 3:4 2:3 1:3', 4]],
    minimum: 1,
  },
  {
    name: 'Dmadd9/A, the shape at the 7th fret with open strings',
    steps: [['5:0 4:7 3:7 2:6 1:0', 2], ['5:0 4:7 3:7 2:6 1:0', 2], ['5:0 4:7 3:7 2:6 1:0', 2], ['5:0 4:7 3:7 2:6 1:0', 2]],
    minimum: 1,
  },
  {
    // Bends and vibrato make it a lead line: guitarists play it in the box at the 5th fret.
    name: 'A minor pentatonic lick with bends and vibrato',
    steps: bars('3:7b', '2:5', '2:8', '1:5', '2:8', '2:5', '3:7', '3:5', '4:7', '3:5', '3:7b', '3:5', '4:7', '4:5', '5:7', '6:5v'),
    minimum: 1,
  },
  {
    name: 'melody in the open position (Ode to Joy)',
    steps: bars('1:0', '1:0', '1:1', '1:3', '1:3', '1:1', '1:0', '2:3', '2:1', '2:1', '2:3', '1:0', '1:0', '2:3', '2:3', '2:3'),
    minimum: 1,
  },
  {
    name: 'E minor riff on the low strings',
    steps: bars('6:0', '6:3', '5:0', '5:2', '4:0', '4:2', '5:2', '5:0', '6:3', '6:0', '6:3', '5:0', '5:2', '5:0', '6:3', '6:0'),
    minimum: 1,
  },
  {
    // Root and fifth on adjacent strings, open or fretted; never a muted string in between.
    name: 'power chords (A5, G5, C5, D5)',
    steps: [
      ['6:5 5:7|5:0 4:2', 2], ['6:3 5:5', 2], ['6:8 5:10|5:3 4:5', 2], ['5:5 4:7|4:0 3:2', 2], ['6:5 5:7|5:0 4:2', 2], ['6:3 5:5', 2],
    ],
    minimum: 1,
  },
  {
    // E minor: the first box is at the 12th fret (the open position has no room for bends).
    name: 'E minor pentatonic lick at the 12th fret',
    steps: bars('3:14b', '2:12', '2:15', '1:12', '1:15', '1:12', '2:15', '2:12', '3:14', '3:12', '4:14', '4:12', '5:14', '5:12', '6:15', '6:12v'),
    minimum: 1,
  },
  {
    // The same notes as the open A minor shape (only the open strings' sound tells them apart): either
    // is right, but not a mix of the two.
    name: 'A minor arpeggio, barre at the 5th fret or open',
    steps: bars(
      '5:0|6:5', '4:2|5:7', '3:2|4:7', '2:1|3:5', '1:0|2:5', '1:5', '1:0|2:5', '2:1|3:5',
      '5:0|6:5', '4:2|5:7', '3:2|4:7', '2:1|3:5', '1:0|2:5', '1:5', '1:0|2:5', '2:1|3:5',
    ),
    ring: true,
    minimum: 1,
  },
  {
    name: 'D major accompaniment with open strings (D, G/D, A/D)',
    steps: bars('4:0', '3:2', '2:3', '1:2', '4:0', '3:0', '2:3', '1:3', '4:0', '3:2', '2:2', '1:0', '4:0', '3:2', '2:3', '1:2'),
    ring: true,
    minimum: 1,
  },
  {
    name: 'Travis picking in C (alternating bass)',
    steps: bars('5:3 1:0', '3:0', '4:2', '2:1', '6:3', '3:0', '4:2', '2:1', '5:3 1:0', '3:0', '4:2', '2:1', '6:3', '3:0', '4:2', '2:1'),
    ring: true,
    minimum: 1,
  },
];

describe('fingering like a guitar teacher', () => {
  it.each(PASSAGES.map((p) => [p.name, p] as const))('%s', (_, passage) => {
    const { accuracy, wrong } = score(passage);
    if (wrong.length) console.log(`${passage.name}: ${Math.round(accuracy * 100)}% — ${wrong.join(' ')}`);
    expect(accuracy).toBeGreaterThanOrEqual(passage.minimum);
  });
});
