// Harder pieces for testing the engine (not bundled with the app): fast arpeggios, ragtime
// syncopation, chord melody, a funk bass line and a strummed rhythm part. Each can be rendered as a
// clean synthetic recording or "played by a person" (timing and dynamics vary, a room adds reverb
// and noise), and its score is the truth the transcription is compared with.
import { RATE, renderStrings } from '../../src/main/transcription/testing/strings';
import type { InstrumentId } from '../../src/shared/instruments';
import { clock, sequence, type Event, type Piece, type ScoredNote } from './scores';

export interface ComplexPiece {
  id: string;
  title: string;
  instrument: InstrumentId;
  /** The tempo of the score. */
  bpm: number;
  piece: Piece;
  /** Chord names as written in the score, in order (consecutive repeats once). */
  chords?: string[];
}

// --- Bach, Cello Suite No. 1, Prelude (BWV 1007), bars 1–6 on guitar: 16th-note arpeggios ---------------
function bachPrelude(): ComplexPiece {
  const time = clock(72);
  const figure = (low: number, a: number, b: number, c: number): number[] => [low, a, c, b, c, a, c, a];
  const bars: number[][] = [
    [...figure(43, 50, 57, 59), ...figure(43, 50, 57, 59)],
    [...figure(43, 52, 59, 60), ...figure(43, 52, 59, 60)],
    [...figure(43, 54, 59, 60), ...figure(43, 54, 59, 60)],
    [...figure(43, 55, 57, 59), ...figure(43, 55, 57, 59)],
    [43, 52, 59, 57, 59, 55, 54, 55, 52, 55, 54, 55, 47, 50, 49, 47],
    [...figure(49, 55, 55, 57), ...figure(49, 55, 55, 57)],
  ];
  const notes: ScoredNote[] = [];
  bars.flat().forEach((pitch, i) => {
    const beat = i / 4;
    // The open G on the 16th that starts each half bar rings under the figure (a bass voice).
    const pedal = i % 8 === 0 && (i < 64 || i >= 80);
    const beats = pedal ? 2 : 0.25;
    notes.push({ start: time(beat), duration: (time(beat + beats) - time(beat)) * 0.97, pitch, amplitude: pedal ? 0.45 : 0.5, beat, beats });
  });
  return {
    id: 'bach-prelude',
    bpm: 72,
    title: 'Bach – Prelude BWV 1007 (16th-note arpeggios, 72 BPM)',
    instrument: 'guitar',
    piece: { file: '', seconds: time(24) + 1.5, beatsPerBar: 4, pickup: 0, parts: [{ kind: 'strings', notes, pan: 0, gain: 1 }] },
  };
}

// --- Joplin, The Entertainer (1902), A strain: syncopated melody over a stride accompaniment ----------
function entertainer(): ComplexPiece {
  const time = clock(96);
  const melody: Event[] = [
    [74, 0.5], [75, 0.5],
    [76, 0.5], [84, 1], [76, 0.5], [84, 1], [76, 0.5], [84, 2.5], [72, 0.5], [74, 0.5], [75, 0.5], [76, 0.5],
    [72, 0.5], [74, 0.5], [76, 1], [71, 0.5], [74, 1], [72, 2.5], [null, 1], [74, 0.5], [75, 0.5],
    [76, 0.5], [84, 1], [76, 0.5], [84, 1], [76, 0.5], [84, 2.5], [81, 0.5], [79, 0.5], [78, 0.5], [81, 0.5],
    [84, 0.5], [88, 1], [86, 0.5], [84, 0.5], [81, 0.5], [86, 1], [84, 4],
  ];
  // Bass on beats 1 and 3, chords on 2 and 4.
  const harmony: Record<string, { bass: [number, number]; chord: number[] }> = {
    C: { bass: [48, 43], chord: [52, 55, 60] },
    G7: { bass: [43, 50], chord: [53, 59, 62] },
    F: { bass: [41, 48], chord: [53, 57, 60] },
    D7: { bass: [50, 45], chord: [54, 57, 60] },
  };
  const progression = ['C', 'C', 'G7', 'C', 'C', 'F', 'D7', 'G7', 'C'];
  const accompaniment: Event[] = progression.slice(0, 8).flatMap((name) => {
    const { bass, chord } = harmony[name];
    return [[bass[0], 1], [chord, 1], [bass[1], 1], [chord, 1]] as Event[];
  });
  accompaniment.push([[48, 52, 55, 60], 4]);
  return {
    id: 'entertainer',
    bpm: 96,
    title: 'Joplin – The Entertainer (ragtime syncopation, 96 BPM)',
    instrument: 'guitar',
    chords: ['C', 'G7', 'C', 'F', 'D7', 'G7', 'C'],
    piece: {
      file: '',
      seconds: time(37) + 1.5,
      beatsPerBar: 4,
      pickup: 1,
      parts: [
        // An octave lower than the piano, as guitar arrangements play it.
        { kind: 'strings', notes: sequence(melody.map(([p, b]) => [typeof p === 'number' ? p - 12 : p, b] as Event), time, { amplitude: 0.55 }), pan: 0, gain: 1 },
        { kind: 'strings', notes: sequence(accompaniment, time, { start: 1, amplitude: 0.35, legato: 0.6 }), pan: 0, gain: 0.8 },
      ],
    },
  };
}

// --- Amazing Grace (1779), chord melody in 3/4: every melody note on the beat harmonized ---------------
function amazingGrace(): ComplexPiece {
  const time = clock(80);
  const melody: Event[] = [
    [62, 1],
    [67, 2], [71, 0.5], [67, 0.5], [71, 2], [69, 1], [67, 2], [64, 1], [62, 2], [62, 1],
    [67, 2], [71, 0.5], [67, 0.5], [71, 2], [69, 0.5], [71, 0.5], [74, 3], [74, 2], [71, 1],
    [74, 2], [71, 0.5], [67, 0.5], [71, 2], [69, 1], [67, 2], [64, 1], [62, 2], [62, 1],
    [67, 2], [71, 0.5], [67, 0.5], [71, 2], [69, 1], [67, 3],
  ];
  const chords: Record<string, { bass: number; tones: number[] }> = {
    G: { bass: 43, tones: [7, 11, 2] },
    C: { bass: 48, tones: [0, 4, 7] },
    D: { bass: 50, tones: [2, 6, 9] },
    Em: { bass: 40, tones: [4, 7, 11] },
  };
  const bars = ['G', 'G', 'C', 'G', 'G', 'G', 'D', 'D', 'G', 'G', 'C', 'Em', 'G', 'D', 'G'];
  const notes: ScoredNote[] = [];
  let beat = 0;
  for (const [pitch, beats] of melody as [number, number][]) {
    const start = time(beat);
    const duration = (time(beat + beats) - start) * 0.95;
    notes.push({ start, duration, pitch, amplitude: 0.55, beat, beats });
    const bar = Math.floor((beat - 1) / 3);
    if (bar >= 0 && Number.isInteger(beat)) {
      const chord = chords[bars[bar]];
      // The two highest chord tones at least a minor third below the melody.
      const inner: number[] = [];
      for (let p = pitch - 3; p >= 50 && inner.length < 2; p--) if (chord.tones.includes(p % 12)) inner.push(p);
      for (const p of inner) notes.push({ start, duration, pitch: p, amplitude: 0.32, beat, beats });
      if ((beat - 1) % 3 === 0) notes.push({ start, duration: (time(beat + 3) - start) * 0.95, pitch: chord.bass, amplitude: 0.42, beat, beats: 3 });
    }
    beat += beats;
  }
  return {
    id: 'amazing-grace',
    bpm: 80,
    title: 'Amazing Grace – chord melody (3/4, 80 BPM)',
    instrument: 'guitar',
    // As the notes say: the melody's D over E minor and its B over D are part of the harmony.
    chords: ['G', 'C', 'G', 'D', 'G', 'C', 'Em7', 'G', 'D6', 'G'],
    piece: { file: '', seconds: time(beat) + 1.5, beatsPerBar: 3, pickup: 1, parts: [{ kind: 'strings', notes, pan: 0, gain: 1 }] },
  };
}

// --- Funk bass line in E (original): syncopated 16ths with octave pops, 100 BPM ------------------------
function funkBass(): ComplexPiece {
  const time = clock(100);
  const r = null;
  const groove: Event[] = [
    [28, 0.25], [r, 0.25], [40, 0.25], [28, 0.25], [r, 0.5], [38, 0.25], [40, 0.25],
    [28, 0.5], [r, 0.25], [31, 0.25], [33, 0.25], [34, 0.25], [35, 0.5],
  ];
  const turnaround: Event[] = [
    [28, 0.25], [r, 0.25], [40, 0.25], [28, 0.25], [r, 0.5], [38, 0.25], [40, 0.25],
    [43, 0.5], [42, 0.25], [40, 0.25], [38, 0.5], [35, 0.5],
  ];
  const line = [...groove, ...groove, ...groove, ...turnaround, ...groove, ...groove, ...groove, ...turnaround, [28, 2]] as Event[];
  return {
    id: 'funk-bass',
    bpm: 100,
    title: 'Funk bass line (syncopated 16ths and octaves, 100 BPM)',
    instrument: 'bass',
    piece: { file: '', seconds: time(34) + 1.5, beatsPerBar: 4, pickup: 0, parts: [{ kind: 'strings', notes: sequence(line, time, { amplitude: 0.6, legato: 0.8 }), pan: 0, gain: 1 }] },
  };
}

// --- Strummed rhythm guitar (original): Em C G D, "down, down-up, up-down-up", 110 BPM ---------------------
function strumming(): ComplexPiece {
  const time = clock(110);
  const shapes: Record<string, number[]> = {
    Em: [40, 47, 52, 55, 59, 64],
    C: [48, 52, 55, 60, 64],
    G: [43, 47, 50, 55, 59, 67],
    D: [50, 57, 62, 66],
  };
  const progression = ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D'];
  const notes: ScoredNote[] = [];
  // [beat in the bar, down?, length until the next strum]
  const pattern: [number, boolean, number][] = [[0, true, 1], [1, true, 0.5], [1.5, false, 1], [2.5, false, 0.5], [3, true, 0.5], [3.5, false, 0.5]];
  progression.forEach((name, bar) => {
    for (const [at, down, beats] of pattern) {
      const beat = bar * 4 + at;
      // Up strums catch only the top strings; a strum sweeps the strings in about 40 ms.
      const strings = down ? shapes[name] : [...shapes[name]].slice(-3).reverse();
      const spread = 0.04 / strings.length;
      strings.forEach((pitch, k) => {
        const start = time(beat) + k * spread;
        notes.push({ start, duration: time(beat + beats) - start - 0.01, pitch, amplitude: (down ? 0.35 : 0.25) * (1 - k * 0.04), beat, beats });
      });
    }
  });
  notes.push(...shapes.Em.map((pitch, k) => ({ start: time(32) + k * 0.007, duration: time(36) - time(32), pitch, amplitude: 0.35, beat: 32, beats: 4 })));
  return {
    id: 'strumming',
    bpm: 110,
    title: 'Strummed rhythm guitar (Em C G D, 110 BPM)',
    instrument: 'guitar',
    chords: ['Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Em'],
    piece: { file: '', seconds: time(36) + 1.5, beatsPerBar: 4, pickup: 0, parts: [{ kind: 'strings', notes, pan: 0, gain: 1 }] },
  };
}

export const COMPLEX_PIECES: ComplexPiece[] = [bachPrelude(), entertainer(), amazingGrace(), funkBass(), strumming()];

/** A deterministic random generator (the same "performance" every run). */
function random(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

/**
 * The notes as a person plays them: each onset (a chord together) early or late by up to ±15 ms,
 * dynamics varying by ±20%. The score (beats) stays the same.
 */
export function humanize(notes: ScoredNote[], seed = 11): ScoredNote[] {
  const next = random(seed);
  const shifts = new Map<number, number>();
  return notes.map((note) => {
    const key = Math.round((note.beat ?? note.start) * 48);
    if (!shifts.has(key)) shifts.set(key, (next() * 2 - 1) * 0.015);
    const shift = shifts.get(key)!;
    return { ...note, start: Math.max(0, note.start + shift), amplitude: (note.amplitude ?? 0.5) * (0.8 + next() * 0.4) };
  });
}

/** A small room (Schroeder reverb, 20% wet) and a noise floor at −54 dB. */
function room(dry: Float32Array, seed = 5): Float32Array {
  const out = Float32Array.from(dry);
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.round((d * RATE) / 44100));
  const wet = new Float32Array(dry.length);
  for (const delay of combs) {
    const buffer = new Float32Array(delay);
    for (let i = 0, j = 0; i < dry.length; i++, j = (j + 1) % delay) {
      const y = buffer[j];
      buffer[j] = dry[i] + y * 0.78;
      wet[i] += y / combs.length;
    }
  }
  for (const delay of [556, 441].map((d) => Math.round((d * RATE) / 44100))) {
    const buffer = new Float32Array(delay);
    for (let i = 0, j = 0; i < wet.length; i++, j = (j + 1) % delay) {
      const y = buffer[j];
      buffer[j] = wet[i] + y * 0.5;
      wet[i] = y - wet[i] * 0.5;
    }
  }
  const noise = random(seed);
  for (let i = 0; i < out.length; i++) out[i] += wet[i] * 0.2 + (noise() * 2 - 1) * 0.002;
  return out;
}

/** Renders a piece: clean, or played by a person in a room. */
export function renderComplex(piece: Piece, performed = false): Float32Array {
  const notes = piece.parts.flatMap((part) => part.notes.map((n) => ({ ...n, amplitude: (n.amplitude ?? 0.5) * part.gain })));
  const audio = renderStrings(performed ? humanize(notes) : notes, piece.seconds);
  return performed ? room(audio) : audio;
}
