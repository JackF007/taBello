// Scores of the bundled sample recordings: famous public-domain pieces (plus one original lick),
// as notes for TaBello's synthesizer. The "truth" of each part is also used by tests.
import type { SynthNote } from '../../src/main/transcription/testing/strings';

export type DrumHit = { time: number; kind: 'kick' | 'snare' | 'hat' };

export interface Part {
  kind: 'strings' | 'lead';
  notes: SynthNote[];
  /** -1 (left) … 1 (right). */
  pan: number;
  gain: number;
}

export interface Piece {
  file: string;
  seconds: number;
  parts: Part[];
  drums?: DrumHit[];
}

type Event = [pitch: number | number[] | null, beats: number];

/** Converts beats to seconds for a tempo that may change linearly from `from` to `to` BPM. */
function clock(from: number, to = from, totalBeats = 1) {
  return (beat: number) => {
    // Integral of 60 / bpm(b) db, with bpm(b) = from + (to - from) * b / totalBeats.
    if (from === to) return (beat * 60) / from;
    const slope = (to - from) / totalBeats;
    return (60 / slope) * Math.log((from + slope * beat) / from);
  };
}

/** Lays out a sequence of [pitch, beats] events from a starting beat; chords are arrays. */
function sequence(events: Event[], time: (beat: number) => number, options: { start?: number; legato?: number; amplitude?: number; strum?: number } = {}): SynthNote[] {
  const notes: SynthNote[] = [];
  let beat = options.start ?? 0;
  for (const [pitch, beats] of events) {
    if (pitch !== null) {
      const start = time(beat);
      const duration = (time(beat + beats) - start) * (options.legato ?? 0.95);
      const pitches = Array.isArray(pitch) ? pitch : [pitch];
      pitches.forEach((p, k) => notes.push({ start: start + k * (options.strum ?? 0), duration, pitch: p, amplitude: options.amplitude ?? 0.5 }));
    }
    beat += beats;
  }
  return notes;
}

// --- Greensleeves (traditional), fingerpicked melody and bass in 3/4 -------------------------------
function greensleeves(): Piece {
  const time = clock(96);
  const A2 = 45, C3 = 48, G2 = 43, E2 = 40;
  const melody: Event[] = [
    [69, 1],
    [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1], [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
    [72, 2], [69, 1], [69, 1.5], [68, 0.5], [69, 1], [71, 2], [68, 1], [64, 2], [69, 1],
    [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1], [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
    [72, 1.5], [71, 0.5], [69, 1], [68, 1.5], [66, 0.5], [68, 1], [69, 3],
  ];
  const bass: Event[] = [A2, C3, G2, E2, A2, E2, E2, A2, A2, C3, G2, E2, A2, E2, A2].map((p) => [p, 3]);
  return {
    file: 'greensleeves.ogg',
    seconds: time(1 + 15 * 3) + 1.5,
    parts: [
      { kind: 'strings', notes: sequence(melody, time, { amplitude: 0.55 }), pan: 0.1, gain: 1 },
      { kind: 'strings', notes: sequence(bass, time, { start: 1, amplitude: 0.4 }), pan: -0.1, gain: 0.8 },
    ],
  };
}

// --- Romance / Spanish Romance (anonymous): triplet arpeggios in 3/4 ---------------------------------
function romance(): Piece {
  const time = clock(66);
  const melody = [71, 71, 71, 71, 69, 67, 67, 66, 64, 64, 67, 71, 76, 76, 76, 76, 74, 72, 72, 71, 69, 69, 71, 72, 71, 71, 71];
  const notes: SynthNote[] = [];
  melody.forEach((pitch, beat) => {
    const bar = Math.floor(beat / 3);
    // E minor on open strings, then A minor (bars 7–8).
    const inner = bar === 6 || bar === 7 ? [60, 57] : [59, 55];
    const bass = bar === 6 || bar === 7 ? 45 : 40;
    [pitch, ...inner].forEach((p, k) => {
      const start = time(beat + k / 3);
      notes.push({ start, duration: time(beat + 1) - start, pitch: p, amplitude: k === 0 ? 0.55 : 0.3 });
    });
    if (beat % 3 === 0) notes.push({ start: time(beat), duration: time(beat + 3) - time(beat), pitch: bass, amplitude: 0.45 });
  });
  return { file: 'romance.ogg', seconds: time(melody.length) + 1.5, parts: [{ kind: 'strings', notes, pan: 0, gain: 1 }] };
}

// --- Minuet in G (Petzold), speeding up from 96 to 126 BPM --------------------------------------------
function minuet(): Piece {
  const first: Event[] = [
    [74, 1], [67, 0.5], [69, 0.5], [71, 0.5], [72, 0.5], [74, 1], [67, 1], [67, 1],
    [76, 1], [72, 0.5], [74, 0.5], [76, 0.5], [78, 0.5], [79, 1], [67, 1], [67, 1],
    [72, 1], [74, 0.5], [72, 0.5], [71, 0.5], [69, 0.5], [71, 1], [72, 0.5], [71, 0.5], [69, 0.5], [67, 0.5],
  ];
  const melody: Event[] = [
    ...first, [66, 1], [67, 0.5], [69, 0.5], [71, 0.5], [67, 0.5], [69, 3],
    ...first, [69, 1], [71, 0.5], [69, 0.5], [67, 0.5], [66, 0.5], [67, 3],
  ];
  const bassBars = [43, 47, 48, 47, 45, 43, 50, 38, 43, 47, 48, 47, 45, 43, 50, 43];
  const beats = bassBars.length * 3;
  const time = clock(96, 126, beats);
  return {
    file: 'minuet-in-g.ogg',
    seconds: time(beats) + 1.5,
    parts: [
      { kind: 'strings', notes: sequence(melody, time, { amplitude: 0.55 }), pan: 0.1, gain: 1 },
      { kind: 'strings', notes: sequence(bassBars.map((p) => [p, 3] as Event), time, { amplitude: 0.4 }), pan: -0.1, gain: 0.8 },
    ],
  };
}

// --- Blues lick in A (original, public domain): bends, legato, slide, vibrato -------------------------
function bluesLick(): Piece {
  const time = clock(84);
  const at = (beat: number) => time(beat);
  const span = (from: number, to: number) => time(to) - time(from);
  const lick = (offset: number): SynthNote[] => [
    // Bend C5 up a whole step.
    { start: at(offset), duration: span(offset, offset + 1) * 0.97, pitch: 72, changes: [{ at: 0.12, pitch: 74, glide: 0.15 }] },
    // C5 pulled off to A4.
    { start: at(offset + 1), duration: span(offset + 1, offset + 2) * 0.97, pitch: 72, changes: [{ at: span(offset + 1, offset + 1.5), pitch: 69 }] },
    // G4 hammered on to A4.
    { start: at(offset + 2), duration: span(offset + 2, offset + 3) * 0.97, pitch: 67, changes: [{ at: span(offset + 2, offset + 2.5), pitch: 69 }] },
    // E4 slid up to A4.
    { start: at(offset + 3), duration: span(offset + 3, offset + 4) * 0.97, pitch: 64, changes: [{ at: span(offset + 3, offset + 3.5), pitch: 69, glide: 0.08 }] },
    // A4 with vibrato.
    { start: at(offset + 4), duration: span(offset + 4, offset + 6) * 0.97, pitch: 69, vibrato: 0.3 },
    // Bend and release.
    { start: at(offset + 6), duration: span(offset + 6, offset + 8) * 0.97, pitch: 72, changes: [{ at: 0.1, pitch: 74, glide: 0.15 }, { at: span(offset + 6, offset + 7), pitch: 72, glide: 0.15 }] },
  ];
  const notes = [...lick(0), ...lick(8), { start: at(16), duration: span(16, 20), pitch: 57, amplitude: 0.5, vibrato: 0.25 }];
  return { file: 'blues-lick.ogg', seconds: time(20) + 1, parts: [{ kind: 'strings', notes, pan: 0, gain: 1 }] };
}

// --- Ode to Joy (Beethoven) on ukulele: melody with strummed chords --------------------------------------
function odeToJoy(): Piece {
  const time = clock(108);
  const phrase = (ending: Event[]): Event[] => [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], ...ending];
  const melody: Event[] = [...phrase([[64, 1.5], [62, 0.5], [62, 2]]), ...phrase([[62, 1.5], [60, 0.5], [60, 2]])];
  const C = [67, 60, 64, 72];
  const G7 = [67, 62, 65, 71];
  const chords: Event[] = [C, G7, C, G7, C, G7, C, C].map((chord) => [chord, 4] as Event);
  return {
    file: 'ode-to-joy.ogg',
    seconds: time(32) + 1.5,
    parts: [
      { kind: 'strings', notes: sequence(melody, time, { amplitude: 0.6 }), pan: 0.15, gain: 1 },
      { kind: 'strings', notes: sequence(chords, time, { amplitude: 0.18, strum: 0.015, legato: 0.5 }), pan: -0.15, gain: 0.7 },
    ],
  };
}

// --- When the Saints Go Marching In (traditional): a band ----------------------------------------------
export const SAINTS_CHORDS = ['C', 'C', 'C', 'C', 'C', 'C', 'G7', 'G7', 'C', 'C7', 'F', 'C', 'G7', 'C'] as const;
const BASS_LINES: Record<(typeof SAINTS_CHORDS)[number], number[]> = {
  C: [36, 43, 48, 43],
  C7: [36, 40, 43, 46],
  F: [41, 36, 33, 36],
  G7: [31, 38, 43, 38],
};
const GUITAR_CHORDS: Record<(typeof SAINTS_CHORDS)[number], number[]> = {
  C: [48, 52, 55, 60, 64],
  C7: [48, 52, 58, 60, 64],
  F: [41, 48, 53, 57, 60, 65],
  G7: [43, 47, 50, 53, 59, 65],
};

export function saintsBass(): SynthNote[] {
  const time = clock(116);
  return sequence(SAINTS_CHORDS.flatMap((c) => BASS_LINES[c].map((p) => [p, 1] as Event)), time, { amplitude: 0.7, legato: 0.85 });
}

function saints(): Piece {
  const time = clock(116);
  const r = null;
  const melody: Event[] = [
    [r, 1], [72, 1], [76, 1], [77, 1], [79, 4],
    [r, 1], [72, 1], [76, 1], [77, 1], [79, 4],
    [r, 1], [72, 1], [76, 1], [77, 1], [79, 1], [76, 1], [72, 1], [76, 1], [74, 4],
    [r, 1], [76, 1], [76, 1], [74, 1], [72, 2], [72, 1], [76, 1], [79, 1], [79, 1], [79, 1], [77, 1], [77, 3], [r, 1],
    [76, 1], [77, 1], [79, 1], [76, 1], [72, 2], [74, 2], [72, 4],
  ];
  const comping: Event[] = SAINTS_CHORDS.flatMap((c) => [[null, 1], [GUITAR_CHORDS[c], 1], [null, 1], [GUITAR_CHORDS[c], 1]] as Event[]);
  const beats = SAINTS_CHORDS.length * 4;
  const drums: DrumHit[] = [];
  for (let beat = 0; beat < beats; beat++) {
    drums.push({ time: time(beat), kind: beat % 2 === 0 ? 'kick' : 'snare' });
    drums.push({ time: time(beat), kind: 'hat' }, { time: time(beat + 0.5), kind: 'hat' });
  }
  return {
    file: 'saints-band.ogg',
    seconds: time(beats) + 1.5,
    parts: [
      { kind: 'lead', notes: sequence(melody, time, { amplitude: 0.5, legato: 0.9 }), pan: 0.25, gain: 0.55 },
      { kind: 'strings', notes: saintsBass(), pan: 0, gain: 0.9 },
      { kind: 'strings', notes: sequence(comping, time, { amplitude: 0.25, strum: 0.012, legato: 0.6 }), pan: -0.45, gain: 0.5 },
    ],
    drums,
  };
}

export const PIECES: Piece[] = [greensleeves(), romance(), minuet(), bluesLick(), odeToJoy(), saints()];
