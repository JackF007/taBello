// Turns detected notes (real time) into a playable tablature arrangement:
// quantize to a rhythmic grid → group into chords → pick strings/frets → split into bars.
import type { NoteEvent } from '../../../../shared/ipc';
import type { Tuning } from '../../../../shared/instruments';
import { METERS, type Meter, type MeterId } from '../../../../shared/meters';
import { anchorBeat, beatGrid, constantGrid } from './tempo';
import { detectKey } from './theory';

/** Durations are counted in ticks: 12 per quarter note, so both 16th notes (3) and triplets (4) are whole numbers. */
export const TICKS_PER_QUARTER = 12;

/** Playing techniques written on a tab note. */
export interface Techniques {
  /** Hammer-on or pull-off to the next note on this string. */
  hammer?: boolean;
  /** Slide to the next note on this string: legato (not picked again) or shift (picked again). */
  slide?: 'legato' | 'shift';
  slideIn?: 'below' | 'above';
  slideOut?: 'up' | 'down';
  /** Bend in semitones. */
  bend?: number;
  release?: boolean;
  vibrato?: boolean;
}

export interface PlacedNote {
  /** String index in the tuning's physical order (see Tuning.strings). */
  string: number;
  /** Fret, relative to the capo. */
  fret: number;
  pitch: number;
  /** Continuation of the same note from the previous beat (a tie). */
  tied: boolean;
  /** Indices of the detected notes (in the input array) this note was made from. */
  sources: number[];
  techniques?: Techniques;
}

export type NoteValue = 1 | 2 | 4 | 8 | 16;

export interface TabBeat {
  /** Empty for a rest. */
  notes: PlacedNote[];
  value: NoteValue;
  dotted: boolean;
  /** Part of a triplet (three of these fill the time of two). */
  tuplet: boolean;
}

export interface Arrangement {
  /** The bars of the (first) voice: everything, or the upper part when there is a bass voice. */
  bars: TabBeat[][];
  /**
   * A second voice for fingerstyle parts: bass notes that ring on under a moving melody, written with
   * their own lengths (stems down in notation), as classical guitar music is. Same number of bars.
   */
  bass?: TabBeat[][];
  meter: Meter;
  /** Ticks missing from bar 1 when it is a pickup (anacrusis); 0 when bar 1 is complete. */
  pickup: number;
  /** Notes that could not be placed (e.g. more simultaneous notes than strings). */
  droppedNotes: number;
  /** Total fingering difficulty; lower is easier. Used to detect a capo or tuning. */
  cost: number;
  /** Time in the recording, in seconds, where bar 1 starts. */
  startTime: number;
  /** Time in the recording where each bar starts, plus where the last one ends. */
  barTimes: number[];
  /** Average length of one tick in seconds. */
  tickSeconds: number;
}

export interface ArrangeOptions {
  /** Open-string MIDI pitches without capo, in the tuning's physical order. */
  tuning: number[];
  frets: number;
  /** Beats per minute, counting the meter's beat (a dotted quarter in 6/8). */
  bpm: number;
  /** Time in seconds of a beat; aligns the grid with the music. */
  offset: number;
  /** Beat times following the recording's tempo changes; when set, bpm and offset are not used. */
  beats?: number[];
  /** Capo fret (0 = none). Frets in the result are relative to it. */
  capo?: number;
  meter?: MeterId;
  /** Which beat (0-based, counted from the beat at or before the first note) is a downbeat. */
  barPhase?: number;
  /** Write playing techniques (bends, slides, hammer-ons…) detected in the notes (default true). */
  techniques?: boolean;
  /** Write sustained basses of fingerstyle parts in a voice of their own (default true; 6+ strings). */
  voices?: boolean;
}

interface ChordPitch {
  pitch: number;
  velocity: number;
  sources: number[];
  /** Where this pitch stops sounding (it may ring past the chord's other notes). */
  endSlot: number;
  /** String requested by the user for this note, if any. */
  hint?: number;
  /** Bent, slid or shaken (vibrato): the note needs a fretting finger, not an open string. */
  fretted?: boolean;
}

interface Chord {
  slot: number;
  endSlot: number;
  pitches: ChordPitch[];
}

interface Fingering {
  notes: PlacedNote[];
  cost: number;
  /** Lowest fretted position, or null when only open strings are played (the hand can move freely). */
  position: number | null;
  /** A quiet note of the chord left out (most likely an overtone heard as a note). */
  dropped?: number;
}

// Written durations, longest first. Triplet values only appear in meters with a triplet feel.
const DURATIONS: { ticks: number; value: NoteValue; dotted: boolean; tuplet: boolean }[] = [
  { ticks: 48, value: 1, dotted: false, tuplet: false },
  { ticks: 36, value: 2, dotted: true, tuplet: false },
  { ticks: 24, value: 2, dotted: false, tuplet: false },
  { ticks: 18, value: 4, dotted: true, tuplet: false },
  { ticks: 12, value: 4, dotted: false, tuplet: false },
  { ticks: 9, value: 8, dotted: true, tuplet: false },
  { ticks: 8, value: 4, dotted: false, tuplet: true },
  { ticks: 6, value: 8, dotted: false, tuplet: false },
  { ticks: 4, value: 8, dotted: false, tuplet: true },
  { ticks: 3, value: 16, dotted: false, tuplet: false },
];

const MAX_CANDIDATES = 12;
/** Fingering cost charged for each note that had to be left out. */
const DROPPED_NOTE_COST = 5;
// A string left out in the middle of a chord (muted by a finger).
const SKIPPED_STRING_COST = 1.5;
// Lead lines: notes either side that set the context, and the cost of an open string there.
const LEAD_CONTEXT = 6;
const OPEN_STRING_IN_LEAD_COST = 1.5;
// Cost per fret of playing higher on the neck (chords and simple melodies sit low).
const LOW_NECK_PREFERENCE = 0.15;
// Cost per fret above the 12th (chords and accompaniment rarely go there).
const HIGH_NECK_COST = 0.5;
// Lead lines: preference (per note) for the first box of the key.
const FIRST_BOX_PREFERENCE = 0.4;
// The fretting hand: reaching a fret beyond its four, and moving it (plus per fret moved).
const STRETCH_COST = 0.3;
const SHIFT_COST = 0.6;
const SHIFT_FRET_COST = 0.25;
// A note quieter than this share of the chord's loudest may be left out, at this cost.
const QUIET_NOTE = 0.8;
const OPTIONAL_NOTE_COST = 8;

export function meterTicks(meter: Meter) {
  const beat = TICKS_PER_QUARTER * meter.quartersPerBeat;
  return { beat, slot: beat / meter.slotsPerBeat, bar: beat * meter.beatsPerBar };
}

/** Moves a pitch by octaves into the instrument's playable range. */
function foldIntoRange(pitch: number, lowest: number, highest: number): number {
  while (pitch < lowest) pitch += 12;
  while (pitch > highest) pitch -= 12;
  return pitch;
}

interface Grid {
  chords: Chord[];
  /** Recording time at which a bar (0 = the first) starts. */
  barTime: (bar: number) => number;
}

/**
 * A bend or vibrato is made by a finger on a fret: impossible on an open string. (Slides too, but a
 * detected glide is less certain: it does not decide the fingering.)
 */
const needsFinger = (note: NoteEvent) => !!(note.bend || note.vibrato);

function quantize(notes: NoteEvent[], options: ArrangeOptions, meter: Meter, lowest: number, highest: number): Grid {
  const grid = options.beats && options.beats.length >= 2 ? beatGrid(options.beats) : constantGrid(options.bpm, options.offset);
  const slotsPerBar = meter.slotsPerBeat * meter.beatsPerBar;
  // Beat 0 is the beat at or just before the first note.
  const origin = anchorBeat(grid, Math.min(...notes.map((n) => n.start)));
  const slotOf = (t: number) => Math.round((grid.toBeat(t) - origin) * meter.slotsPerBeat);
  // Bars start on the chosen downbeat; a pickup before it gets a bar of its own.
  const phaseSlots = ((options.barPhase ?? 0) % meter.beatsPerBar) * meter.slotsPerBeat;
  const barOrigin = phaseSlots === 0 ? 0 : phaseSlots - slotsPerBar;

  const bySlot = new Map<number, Chord>();
  notes.forEach((note, index) => {
    const slot = Math.max(0, slotOf(note.start)) - barOrigin;
    const endSlot = Math.max(slot + 1, slotOf(note.start + note.duration) - barOrigin);
    const pitch = foldIntoRange(note.pitch, lowest, highest);
    const chord = bySlot.get(slot) ?? { slot, endSlot, pitches: [] };
    chord.endSlot = Math.max(chord.endSlot, endSlot);
    const existing = chord.pitches.find((p) => p.pitch === pitch);
    if (existing) {
      existing.velocity = Math.max(existing.velocity, note.velocity);
      existing.sources.push(index);
      existing.hint ??= note.string;
      existing.endSlot = Math.max(existing.endSlot, endSlot);
      existing.fretted ||= needsFinger(note);
    } else {
      chord.pitches.push({ pitch, velocity: note.velocity, sources: [index], hint: note.string, endSlot, fretted: needsFinger(note) });
    }
    bySlot.set(slot, chord);
  });

  // Start at the first bar that contains a note.
  const chords = [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  const shift = Math.floor(chords[0].slot / slotsPerBar) * slotsPerBar;
  const firstBar = origin + (barOrigin + shift) / meter.slotsPerBeat;
  return {
    chords: chords.map((c) => ({
      ...c,
      slot: c.slot - shift,
      endSlot: c.endSlot - shift,
      pitches: c.pitches.map((p) => ({ ...p, endSlot: p.endSlot - shift })),
    })),
    barTime: (bar) => grid.toTime(firstBar + bar * meter.beatsPerBar),
  };
}

/** All ways to play a set of pitches on distinct strings, cheapest first. */
function fingerings(pitches: ChordPitch[], tuning: number[], frets: number): Fingering[] {
  const results: PlacedNote[][] = [];
  const sorted = [...pitches].sort((a, b) => b.pitch - a.pitch);
  const assign = (i: number, used: Set<number>, acc: PlacedNote[]) => {
    if (results.length >= 500) return;
    if (i === sorted.length) {
      results.push([...acc]);
      return;
    }
    const { pitch, hint, sources, fretted } = sorted[i];
    // A string chosen by the user wins whenever that string can play the note.
    const hinted = hint !== undefined && hint < tuning.length && pitch - tuning[hint] >= 0 && pitch - tuning[hint] <= frets;
    for (let string = 0; string < tuning.length; string++) {
      if (hinted && string !== hint) continue;
      const fret = pitch - tuning[string];
      if (used.has(string) || fret < 0 || fret > frets || (fret === 0 && fretted)) continue;
      used.add(string);
      acc.push({ string, fret, pitch, tied: false, sources });
      assign(i + 1, used, acc);
      acc.pop();
      used.delete(string);
    }
  };
  assign(0, new Set(), []);

  return results
    .map((notes) => {
      const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
      const position = fretted.length > 0 ? Math.min(...fretted) : null;
      const span = fretted.length > 0 ? Math.max(...fretted) - Math.min(...fretted) : 0;
      const averageFret = notes.reduce((s, n) => s + n.fret, 0) / notes.length;
      const highestFret = Math.max(...notes.map((n) => n.fret));
      // Strings skipped inside a chord must be muted by the fingers: chord shapes use adjacent strings.
      // (Not between a bass and a melody note far above it: a pinch in fingerpicking skips strings.)
      const byString = [...notes].sort((a, b) => a.string - b.string);
      const skipped = byString
        .slice(1)
        .reduce((sum, n, i) => sum + (Math.abs(n.pitch - byString[i].pitch) <= 7 ? n.string - byString[i].string - 1 : 0), 0);
      // Stretches beyond 4 frets are barely playable; otherwise prefer compact shapes low on the neck,
      // and avoid the top of the neck unless nothing else works.
      const cost =
        (span > 4 ? 10 + span * 2 : span * 0.5) + averageFret * LOW_NECK_PREFERENCE + Math.max(0, highestFret - 12) * HIGH_NECK_COST + skipped * SKIPPED_STRING_COST;
      return { notes: notes.sort((a, b) => a.string - b.string), cost, position };
    })
    .sort((a, b) => a.cost - b.cost)
    .slice(0, MAX_CANDIDATES);
}

/**
 * Fingering candidates for a chord, dropping its quietest notes until it becomes playable. A quiet
 * note can also be left out at a price, as a guitarist would rather than leap up the neck for it:
 * the Viterbi search takes that option only when keeping the note would mean an absurd position.
 */
function chordCandidates(chord: Chord, tuning: number[], frets: number): { candidates: Fingering[]; dropped: number } {
  const pitches = [...chord.pitches].sort((a, b) => b.velocity - a.velocity).slice(0, tuning.length);
  let dropped = chord.pitches.length - pitches.length;
  while (pitches.length > 0) {
    let candidates = fingerings(pitches, tuning, frets);
    // A note heard as bent or shaken that only an open string can play: the open string after all.
    if (candidates.length === 0 && pitches.some((p) => p.fretted)) candidates = fingerings(pitches.map((p) => ({ ...p, fretted: false })), tuning, frets);
    if (candidates.length > 0) {
      const quietest = pitches[pitches.length - 1];
      if (pitches.length >= 2 && quietest.velocity < pitches[0].velocity * QUIET_NOTE) {
        const without = fingerings(pitches.slice(0, -1), tuning, frets).map((f) => ({ ...f, cost: f.cost + OPTIONAL_NOTE_COST, dropped: 1 }));
        candidates.push(...without);
      }
      return { candidates, dropped };
    }
    pitches.pop();
    dropped++;
  }
  return { candidates: [], dropped };
}

/**
 * Chooses one fingering per chord minimizing shape cost plus hand movement between chords,
 * with a Viterbi pass over the whole piece (O(chords × candidates²)).
 */
function chooseFingerings(candidateLists: Fingering[][], legatoInto: boolean[] = []): { chosen: Fingering[]; cost: number } {
  if (candidateLists.length === 0) return { chosen: [], cost: 0 };
  // The fretting hand sits in a position: the index finger on a fret and one finger per fret above
  // it, four frets in all. Where exactly is open until the notes tell: after a note on the 3rd fret
  // the index can be anywhere from the 1st to the 3rd. So the hand is a range of index frets, which
  // narrows as notes are played. A note that fits costs nothing; one a fret beyond is a stretch; one
  // outside moves the hand the nearest way, which costs a little more the farther it goes. Open
  // strings leave the hand where it is, and give it time to move: shifts across them cost half.
  type Hand = [number, number] | null;
  const reach = (from: Hand, to: Fingering, acrossOpen: boolean): { cost: number; hand: Hand } => {
    const frets = to.notes.filter((n) => n.fret > 0).map((n) => n.fret);
    if (frets.length === 0) return { cost: 0, hand: from };
    const low = Math.min(...frets);
    const high = Math.max(...frets);
    // Index positions that cover these notes (a span beyond four frets: index on the lowest).
    const needed: [number, number] = high - low > 3 ? [low, low] : [Math.max(1, high - 3), low];
    if (from === null) return { cost: 0, hand: needed };
    const overlap: [number, number] = [Math.max(from[0], needed[0]), Math.min(from[1], needed[1])];
    if (overlap[0] <= overlap[1]) return { cost: high - low > 3 ? STRETCH_COST : 0, hand: overlap };
    // A fret beyond the hand's reach: stretch rather than move.
    const gap = needed[0] > from[1] ? needed[0] - from[1] : from[0] - needed[1];
    if (gap === 1) return { cost: STRETCH_COST, hand: from };
    const cost = (SHIFT_COST + gap * SHIFT_FRET_COST) * (acrossOpen ? 0.5 : 1);
    return { cost, hand: needed };
  };

  const costs: number[][] = [];
  const back: number[][] = [];
  // Where the hand is after each candidate (the last fretted position on the best path to it), and
  // whether only open strings were played since.
  const hand: Hand[][] = [];
  const open: boolean[][] = [];
  candidateLists.forEach((candidates, i) => {
    costs.push([]);
    back.push([]);
    hand.push([]);
    open.push([]);
    candidates.forEach((candidate, j) => {
      if (i === 0) {
        costs[i][j] = candidate.cost;
        back[i][j] = -1;
        hand[i][j] = reach(null, candidate, false).hand;
        open[i][j] = candidate.position === null;
        return;
      }
      let best = Infinity;
      let bestK = 0;
      candidateLists[i - 1].forEach((_, k) => {
        // Hammer-ons, pull-offs and slides stay on one string: a note that was not picked cannot
        // sound on another string, so this outweighs a position shift.
        const previous = candidateLists[i - 1][k];
        const stringChange =
          legatoInto[i] && previous.notes.length === 1 && candidate.notes.length === 1 && previous.notes[0].string !== candidate.notes[0].string
            ? 8
            : 0;
        const total = costs[i - 1][k] + reach(hand[i - 1][k], candidate, open[i - 1][k]).cost + stringChange;
        if (total < best) [best, bestK] = [total, k];
      });
      costs[i][j] = best + candidate.cost;
      back[i][j] = bestK;
      hand[i][j] = reach(hand[i - 1][bestK], candidate, open[i - 1][bestK]).hand;
      open[i][j] = candidate.position === null;
    });
  });

  const last = costs[costs.length - 1];
  const cost = Math.min(...last);
  const chosen: Fingering[] = [];
  let j = last.indexOf(cost);
  for (let i = candidateLists.length - 1; i >= 0; i--) {
    chosen[i] = candidateLists[i][j];
    j = back[i][j];
  }
  return { chosen, cost };
}

/**
 * Splits a span of ticks into written beats. Notes starting on a beat may last whole beats; anything
 * else stays within its beat, so rhythms are written beat by beat as musicians read them.
 */
function splitIntoBeats(start: number, length: number, notes: PlacedNote[], meter: Meter, out: Map<number, TabBeat[]>): void {
  const ticks = meterTicks(meter);
  const allowed = DURATIONS.filter((d) => (meter.tuplets ? d.tuplet || d.ticks % ticks.beat === 0 : !d.tuplet && d.ticks % ticks.slot === 0));
  let cursor = start;
  let first = true;
  while (cursor < start + length) {
    const bar = Math.floor(cursor / ticks.bar);
    const end = Math.min(start + length, (bar + 1) * ticks.bar);
    const beatStart = cursor % ticks.beat === 0;
    const nextBeat = (Math.floor(cursor / ticks.beat) + 1) * ticks.beat;
    const duration = allowed.find((d) =>
      beatStart
        ? d.ticks <= end - cursor && (d.ticks % ticks.beat === 0 || d.ticks < ticks.beat)
        : d.ticks <= Math.min(end, nextBeat) - cursor,
    )!;
    const last = cursor + duration.ticks >= start + length;
    const beatNotes = notes.map((n) => ({ ...n, tied: !first, techniques: piece(n.techniques, first, last) }));
    const beats = out.get(bar) ?? [];
    beats.push({ notes: beatNotes, value: duration.value, dotted: duration.dotted, tuplet: duration.tuplet });
    out.set(bar, beats);
    cursor += duration.ticks;
    first = false;
  }
}

/**
 * Techniques of one piece of a note tied across beats: how it starts (bend, slide in) is written on
 * the first piece (with vibrato), how it leaves (hammer-on, slide) on the last one.
 */
function piece(techniques: Techniques | undefined, first: boolean, last: boolean): Techniques | undefined {
  if (!techniques || (first && last)) return techniques;
  const { hammer, slide, slideOut, bend, release, slideIn, vibrato } = techniques;
  const result: Techniques = {
    ...(first ? { bend, release, slideIn, vibrato } : {}),
    ...(last ? { hammer, slide, slideOut } : {}),
  };
  for (const key of Object.keys(result) as (keyof Techniques)[]) if (result[key] === undefined) delete result[key];
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Widest interval (in semitones/frets) played legato: hammer-ons, pull-offs and slides. */
const MAX_LEGATO_INTERVAL = 7;
/** Seconds of music around a note that set what a picked note sounds like there. */
const ATTACK_CONTEXT = 10;

/**
 * Attack (0..1) below which a note was not picked but hammered, pulled off or slid to, at each of
 * the given times. Relative to the passage around it — a song can go from soft fingerpicking to a
 * solo picked hard — and when few notes there show a pick click at all (fingerstyle, heavy
 * compression), the cue is unreliable and nothing is considered legato.
 */
function legatoThresholds(notes: NoteEvent[], times: number[]): number[] {
  const picked = notes.filter((n) => n.attack !== undefined).sort((a, b) => a.start - b.start);
  const starts = picked.map((n) => n.start);
  const firstAtOrAfter = (t: number) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return times.map((t) => {
    const attacks = picked.slice(firstAtOrAfter(t - ATTACK_CONTEXT), firstAtOrAfter(t + ATTACK_CONTEXT)).map((n) => n.attack!).sort((a, b) => a - b);
    if (attacks.length === 0) return -1;
    const typical = attacks[attacks.length >> 1];
    return typical < 0.4 ? -1 : Math.min(0.35, typical * 0.5);
  });
}

interface SourceArticulation {
  attack?: number;
  bend?: number;
  release?: boolean;
  slideIn?: number;
  slideOut?: number;
  vibrato?: boolean;
}

/** Articulation of a tab note, combined from the detected notes it was made from. */
function articulationOf(notes: NoteEvent[], sources: number[]): SourceArticulation {
  const from = sources.map((i) => notes[i]);
  const strongest = (key: 'slideIn' | 'slideOut') =>
    from.map((n) => n[key]).filter((v): v is number => v !== undefined).sort((a, b) => Math.abs(b) - Math.abs(a))[0];
  const attacks = from.map((n) => n.attack).filter((v): v is number => v !== undefined);
  const bends = from.map((n) => n.bend ?? 0);
  return {
    attack: attacks.length > 0 ? Math.max(...attacks) : undefined,
    bend: Math.max(...bends) > 0 ? Math.max(...bends) : undefined,
    release: from.some((n) => n.release),
    slideIn: strongest('slideIn'),
    slideOut: strongest('slideOut'),
    vibrato: from.some((n) => n.vibrato),
  };
}

/**
 * Decides the techniques of each tab note from how its notes were played and from its neighbours:
 * a note that was not picked, right after another on the same string, is a hammer-on/pull-off or,
 * when the pitch glided or the distance is too wide for the fingers, a slide.
 */
function assignTechniques(notes: NoteEvent[], playable: { chord: Chord }[], chosen: Fingering[], legatoAttack: number[]): void {
  const articulations = chosen.map((fingering) => fingering.notes.map((n) => articulationOf(notes, n.sources)));
  const set = (i: number, k: number, techniques: Techniques) => {
    const note = chosen[i].notes[k];
    note.techniques = { ...note.techniques, ...techniques };
  };
  // Fingerings are shared candidate objects; copy the chosen notes before writing on them.
  chosen.forEach((fingering, i) => (chosen[i] = { ...fingering, notes: fingering.notes.map((n) => ({ ...n })) }));

  const reachedBySlide = new Set<number>();
  chosen.forEach((fingering, i) => {
    // In strummed chords, strings beating against each other make the pitch wobble: bends and
    // vibrato are only read on single notes and double stops.
    if (fingering.notes.length > 2) return;
    fingering.notes.forEach((_, k) => {
      const a = articulations[i][k];
      if (a.bend) set(i, k, { bend: a.bend, ...(a.release ? { release: true } : {}) });
      if (a.vibrato) set(i, k, { vibrato: true });
    });

    const next = chosen[i + 1];
    if (!next || fingering.notes.length !== 1 || next.notes.length !== 1) return;
    const [from] = fingering.notes;
    const [to] = next.notes;
    const contiguous = playable[i].chord.endSlot >= playable[i + 1].chord.slot - 1;
    if (!contiguous || from.string !== to.string || from.fret === to.fret || Math.abs(to.fret - from.fret) > MAX_LEGATO_INTERVAL) return;
    const a = articulations[i][0];
    const b = articulations[i + 1][0];
    const direction = Math.sign(to.fret - from.fret);
    const glides = (a.slideOut ?? 0) * direction >= 0.5 || (b.slideIn ?? 0) * direction <= -0.5;
    // Only notes without a new pick attack are connected: when a note is picked again, a glide in the
    // contours is more often the ringing previous note than a shift slide.
    // A slide shows as a glide; without one, only a reach the fingers can hammer or pull (4 frets)
    // is believable — a wider unpicked jump is more likely a softly picked note.
    if (b.attack !== undefined && b.attack < legatoAttack[i + 1]) {
      if (glides) {
        set(i, 0, { slide: 'legato' });
        reachedBySlide.add(i + 1);
      } else if (Math.abs(to.fret - from.fret) <= 4) {
        set(i, 0, { hammer: true });
      }
    }
  });

  // Slides into or out of a note from nowhere in particular. A glide towards a touching neighbour
  // (and not past it) is the pitch track moving to that note, not a slide.
  const landsOn = (i: number, j: number, glide: number) => {
    const neighbour = chosen[j];
    if (!neighbour || !playable[j]) return false;
    const [first, second] = i < j ? [i, j] : [j, i];
    const touching = playable[first].chord.endSlot >= playable[second].chord.slot - 1;
    const pitch = chosen[i].notes[0].pitch;
    return touching && neighbour.notes.some((n) => {
      const interval = n.pitch - pitch;
      return Math.sign(interval) === Math.sign(glide) && Math.abs(glide) <= Math.abs(interval) + 0.75;
    });
  };
  chosen.forEach((fingering, i) => {
    if (fingering.notes.length !== 1) return;
    const note = fingering.notes[0];
    const a = articulations[i][0];
    const out = a.slideOut ?? 0;
    const into = a.slideIn ?? 0;
    if (!note.techniques?.slide && !a.bend && Math.abs(out) >= 1.5 && !landsOn(i, i + 1, out)) set(i, 0, { slideOut: out > 0 ? 'up' : 'down' });
    if (!reachedBySlide.has(i) && !a.bend && Math.abs(into) >= 1.5 && !landsOn(i, i - 1, into)) set(i, 0, { slideIn: into < 0 ? 'below' : 'above' });
  });
}

interface VoiceEvent {
  slot: number;
  endSlot: number;
  notes: PlacedNote[];
  /** End slot of each note (same order as notes). */
  ends: number[];
}

/**
 * Writes events one after the other: each lasts until it ends or the next one starts. Detected note
 * ends are imprecise and plucked strings ring on, so a gap shorter than a beat is not a rest: the
 * event is held across it; the last one rings to the end of its bar when that is less than a beat away.
 * Bass notes ring much longer than they are detected: in a bass voice they are held up to a bar.
 */
function layOutVoice(events: VoiceEvent[], meter: Meter, holdSlots = meter.slotsPerBeat): { beatsByBar: Map<number, TabBeat[]>; end: number } {
  const ticks = meterTicks(meter);
  const slotsPerBar = ticks.bar / ticks.slot;
  const beatsByBar = new Map<number, TabBeat[]>();
  let cursor = 0;
  events.forEach((event, i) => {
    const start = event.slot * ticks.slot;
    if (start > cursor) splitIntoBeats(cursor, start - cursor, [], meter, beatsByBar);
    const next = events[i + 1]?.slot ?? Math.ceil((event.endSlot + 1e-9) / slotsPerBar) * slotsPerBar;
    const endSlot = next - event.endSlot < holdSlots ? next : event.endSlot;
    const end = Math.min(endSlot, next) * ticks.slot;
    splitIntoBeats(start, end - start, event.notes, meter, beatsByBar);
    cursor = end;
  });
  return { beatsByBar, end: cursor };
}

/**
 * Fingerstyle texture: bass notes on the low strings that keep ringing while the melody moves on.
 * When at least three bass notes (and 30% of them) outlast the next note by a beat or more, the
 * basses go to a voice of their own; otherwise (strummed chords, single lines) there is one voice.
 */
function splitBassVoice(events: VoiceEvent[], meter: Meter): [VoiceEvent[], VoiceEvent[]] | null {
  const bassIndex = events.map(({ notes }) => {
    const lowest = notes.reduce((a, b) => (b.pitch < a.pitch ? b : a), notes[0]);
    if (!lowest || lowest.string > 2) return -1;
    const others = notes.filter((n) => n !== lowest);
    const separate = others.length === 0 ? lowest.string <= 1 : Math.min(...others.map((n) => n.pitch)) - lowest.pitch >= 5;
    return separate ? notes.indexOf(lowest) : -1;
  });
  const basses = events.map((_, i) => i).filter((i) => bassIndex[i] >= 0);
  const sustained = basses.filter((i) => events[i + 1] && events[i].ends[bassIndex[i]] - events[i + 1].slot >= meter.slotsPerBeat);
  const hasMelody = events.some((event, i) => event.notes.length > (bassIndex[i] >= 0 ? 1 : 0));
  if (!hasMelody || sustained.length < 3 || sustained.length < basses.length * 0.3) return null;

  const upper: VoiceEvent[] = [];
  const bass: VoiceEvent[] = [];
  events.forEach((event, i) => {
    const b = bassIndex[i];
    if (b >= 0) bass.push({ slot: event.slot, endSlot: event.ends[b], notes: [event.notes[b]], ends: [event.ends[b]] });
    const notes = event.notes.filter((_, k) => k !== b);
    const ends = event.ends.filter((_, k) => k !== b);
    if (notes.length > 0) upper.push({ slot: event.slot, endSlot: Math.max(...ends), notes, ends });
  });
  return [upper, bass];
}

export function arrange(notes: NoteEvent[], options: ArrangeOptions): Arrangement {
  const meter = METERS[options.meter ?? '4/4'];
  const ticks = meterTicks(meter);
  const wholeBar = (): TabBeat[] => {
    const out = new Map<number, TabBeat[]>();
    splitIntoBeats(0, ticks.bar, [], meter, out);
    return out.get(0)!;
  };
  const tickSeconds = 60 / options.bpm / ticks.beat;
  if (notes.length === 0) {
    return { bars: [wholeBar()], meter, pickup: 0, droppedNotes: 0, cost: 0, startTime: 0, barTimes: [0, ticks.bar * tickSeconds], tickSeconds };
  }

  const capo = options.capo ?? 0;
  const tuning = options.tuning.map((pitch) => pitch + capo);
  const frets = options.frets - capo;
  // Not tuning[0] / tuning.at(-1): re-entrant tunings (ukulele) are not in pitch order.
  const grid = quantize(notes, options, meter, Math.min(...tuning), Math.max(...tuning) + frets);

  let droppedNotes = 0;
  const playable: { chord: Chord; candidates: Fingering[] }[] = [];
  for (const chord of grid.chords) {
    const { candidates, dropped } = chordCandidates(chord, tuning, frets);
    droppedNotes += dropped;
    if (candidates.length > 0) playable.push({ chord, candidates });
  }
  // A lead line (single notes with bends or vibrato nearby) is played in a box, fingers on the frets:
  // open strings there cost more, as they cannot be bent, shaken or muted like the notes around them.
  // Most lead lines sit in the "first box": the hand on the key's tonic on the low string (A minor:
  // the 5th fret), one finger per fret.
  let box: number | null = null;
  const boxOf = () => {
    if (box === null) {
      const key = detectKey(notes);
      const tonic = key.mode === 'major' ? (key.tonic + 9) % 12 : key.tonic; // the relative minor's
      box = ((tonic - tuning[0]) % 12 + 12) % 12;
      if (box < 3) box += 12;
    }
    return box;
  };
  playable.forEach((entry, i) => {
    const around = playable.slice(Math.max(0, i - LEAD_CONTEXT), i + LEAD_CONTEXT + 1);
    const single = around.filter((p) => p.chord.pitches.length === 1).length >= around.length * 0.8;
    // No bass under it (a fingerstyle melody with its bass is not a lead line).
    const bassless = around.filter((p) => p.chord.pitches.some((pitch) => pitch.pitch < tuning[0] + 7)).length <= 1;
    const lead = single && bassless && around.some((p) => p.chord.pitches.some((pitch) => pitch.fretted));
    if (!lead) return;
    // And lead players choose a position for the scale, not for being low on the neck.
    entry.candidates = entry.candidates.map((c) => {
      const averageFret = c.notes.reduce((sum, n) => sum + n.fret, 0) / c.notes.length;
      const inBox = c.notes.filter((n) => n.fret >= boxOf() - 1 && n.fret <= boxOf() + 3).length;
      // Soloing up to the 17th fret is ordinary.
      const high = Math.max(0, Math.min(17, Math.max(...c.notes.map((n) => n.fret))) - 12) * HIGH_NECK_COST;
      return {
        ...c,
        cost:
          c.cost + c.notes.filter((n) => n.fret === 0).length * OPEN_STRING_IN_LEAD_COST - averageFret * LOW_NECK_PREFERENCE - inBox * FIRST_BOX_PREFERENCE - high,
      };
    });
  });
  const techniques = options.techniques !== false;
  const legatoAttack = legatoThresholds(
    notes,
    playable.map(({ chord }) => Math.min(...chord.pitches.flatMap((p) => p.sources.map((k) => notes[k].start)))),
  );
  // A single note right after another, without a new attack or glided into, is on the same string.
  const legatoInto = playable.map(({ chord }, i) => {
    const previous = playable[i - 1]?.chord;
    if (!techniques || !previous || chord.pitches.length !== 1 || previous.pitches.length !== 1) return false;
    if (previous.endSlot < chord.slot - 1) return false;
    // On one string the new note silences the previous one: a note still ringing well after the
    // next starts (a bass under an arpeggio) was on another string, however softly it was picked.
    if (previous.pitches[0].endSlot > chord.slot + 1) return false;
    const a = articulationOf(notes, previous.pitches[0].sources);
    const b = articulationOf(notes, chord.pitches[0].sources);
    const interval = chord.pitches[0].pitch - previous.pitches[0].pitch;
    // Beyond a fifth, the fretting hand cannot connect the notes without picking.
    if (interval === 0 || Math.abs(interval) > MAX_LEGATO_INTERVAL) return false;
    const direction = Math.sign(interval);
    const glides = (a.slideOut ?? 0) * direction >= 0.5 || (b.slideIn ?? 0) * direction <= -0.5;
    return glides || (b.attack !== undefined && b.attack < legatoAttack[i]);
  });
  const { chosen, cost } = chooseFingerings(
    playable.map((p) => p.candidates),
    legatoInto,
  );
  droppedNotes += chosen.reduce((sum, f) => sum + (f.dropped ?? 0), 0);
  if (techniques) assignTechniques(notes, playable, chosen, legatoAttack);

  // The notes as events in time, with where each pitch stops sounding.
  const events: VoiceEvent[] = playable.map(({ chord }, i) => ({
    slot: chord.slot,
    endSlot: chord.endSlot,
    notes: chosen[i].notes,
    ends: chosen[i].notes.map((note) => chord.pitches.find((p) => p.pitch === note.pitch)?.endSlot ?? chord.endSlot),
  }));
  const voices = options.voices !== false && options.tuning.length >= 6 ? splitBassVoice(events, meter) : null;
  const laidOut = voices
    ? [layOutVoice(voices[0], meter), layOutVoice(voices[1], meter, meter.slotsPerBeat * meter.beatsPerBar)]
    : [layOutVoice(events, meter)];
  const totalTicks = Math.max(ticks.bar, ...laidOut.map(({ end }) => Math.ceil(end / ticks.bar) * ticks.bar));
  const [bars, bass] = laidOut.map(({ beatsByBar, end }) => {
    // Pad the last bar with rests.
    if (totalTicks > end) splitIntoBeats(end, totalTicks - end, [], meter, beatsByBar);
    return Array.from({ length: totalTicks / ticks.bar }, (_, i) => beatsByBar.get(i) ?? wholeBar());
  });
  // A pickup: when every voice starts bar 1 with a beat or more of rests, bar 1 becomes an
  // anacrusis holding only the pickup notes, as scores write it.
  const voicesBars = bass ? [bars, bass] : [bars];
  const beatTicks = (beat: TabBeat) => (48 / beat.value) * (beat.dotted ? 1.5 : 1) * (beat.tuplet ? 2 / 3 : 1);
  const leadingRest = (beats: TabBeat[]) => {
    let lead = 0;
    for (const beat of beats) {
      if (beat.notes.length > 0) break;
      lead += beatTicks(beat);
    }
    return lead;
  };
  const leads = voicesBars.map((voice) => leadingRest(voice[0]));
  const pickup = bars.length > 1 && Math.min(...leads) >= ticks.beat && Math.min(...leads) < ticks.bar ? Math.min(...leads) : 0;
  if (pickup > 0) {
    voicesBars.forEach((voice, v) => {
      let dropped = 0;
      const rest = voice[0].filter((beat) => {
        if (dropped >= leads[v] || beat.notes.length > 0) return true;
        dropped += beatTicks(beat);
        return false;
      });
      // Rests this voice still needs after the pickup point.
      const out = new Map<number, TabBeat[]>();
      if (leads[v] > pickup) splitIntoBeats(pickup, leads[v] - pickup, [], meter, out);
      voice[0] = [...(out.get(0) ?? []), ...rest];
    });
  }

  const barTimes = Array.from({ length: bars.length + 1 }, (_, i) => grid.barTime(i));
  // The score starts at the first written beat.
  barTimes[0] += (pickup / ticks.bar) * (grid.barTime(1) - grid.barTime(0));
  return {
    bars,
    ...(bass ? { bass } : {}),
    meter,
    pickup,
    droppedNotes,
    cost: cost + droppedNotes * DROPPED_NOTE_COST,
    startTime: barTimes[0],
    barTimes,
    tickSeconds: (barTimes[bars.length] - barTimes[0]) / (totalTicks - pickup),
  };
}

/** Share of onsets (notes starting within 50 ms of each other) that are chords of three notes or more. */
function chordShare(notes: NoteEvent[]): number {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const groups: number[] = [];
  let groupStart = -Infinity;
  for (const note of sorted) {
    if (note.start - groupStart < 0.05) groups[groups.length - 1]++;
    else {
      groups.push(1);
      groupStart = note.start;
    }
  }
  return groups.filter((size) => size >= 3).length / groups.length;
}

type FingeringOptions = Omit<ArrangeOptions, 'capo' | 'meter' | 'barPhase'>;

/**
 * Suggests a capo position. A capo is used to play open chord shapes in another key, so it is only
 * considered for chordal parts that reach down to the capoed low strings, and only where (almost) no
 * note is lower than the capoed lowest string. Among those positions it picks the one whose
 * fingerings are clearly easier.
 */
export function detectCapo(notes: NoteEvent[], options: FingeringOptions, maxCapo: number): number {
  // Melodies and riffs: open strings high up the neck would look "easier", but that is not a capo.
  if (notes.length === 0 || chordShare(notes) < 0.3) return 0;
  const [lowestString, secondLowestString] = [...options.tuning].sort((a, b) => a - b);
  const lowestNote = Math.min(...notes.map((n) => n.pitch));
  const baseline = arrange(notes, { ...options, capo: 0 }).cost;
  let best = { capo: 0, cost: baseline };
  for (let capo = 1; capo <= maxCapo; capo++) {
    const tooLow = notes.filter((n) => n.pitch < lowestString + capo);
    // A few stray low notes (noise, harmonics) are tolerated; more, or a clear bass note (picked and
    // ringing), means no capo this high.
    if (tooLow.length > notes.length * 0.02 || tooLow.some((n) => n.duration >= 0.2 && n.velocity >= 0.4 && Math.max(n.onset ?? 1, n.attack ?? 1) >= 0.5)) break;
    // Open-shape chords with a capo have their bass on the capoed low strings.
    if (lowestNote > secondLowestString + capo) continue;
    const { cost } = arrange(notes, { ...options, capo });
    if (cost < best.cost) best = { capo, cost };
  }
  // Only suggest a capo when it makes the part clearly easier.
  return best.cost < baseline * 0.8 ? best.capo : 0;
}

// Keys whose chords are open shapes in standard tuning.
const OPEN_MAJOR_KEYS = [0, 2, 4, 7, 9]; // C D E G A
const OPEN_MINOR_KEYS = [2, 4, 9]; // Dm Em Am

/**
 * Picks the most likely tuning among the instrument's common ones (the first is the default).
 * A tuning is ruled out when more than 2% of the notes are below its lowest string — that is how a
 * drop D, a 5-string bass or a low-G ukulele shows up. When the default tuning can play every note,
 * only a whole retuning (every string lowered alike, as half a step down) is considered, and only
 * when it turns an awkward key into open shapes (E♭ played as E) and makes the part clearly easier:
 * open strings elsewhere make many parts a little easier without anyone retuning for them.
 */
export function detectTuning(notes: NoteEvent[], tunings: Tuning[], options: Omit<FingeringOptions, 'tuning'>): Tuning {
  const candidates = tunings.filter((t) => t.autoDetect !== false);
  const [standard] = candidates;
  if (notes.length === 0) return standard;

  const evaluate = (tuning: Tuning) => {
    const lowest = Math.min(...tuning.strings);
    const tooLow = notes.filter((n) => n.pitch < lowest).length / notes.length;
    return { tuning, playable: tooLow <= 0.02, cost: arrange(notes, { ...options, tuning: tuning.strings }).cost };
  };
  const results = candidates.map(evaluate);
  const baseline = results[0];
  const playable = results.filter((r) => r.playable).sort((a, b) => a.cost - b.cost);
  if (!baseline.playable) return playable[0]?.tuning ?? standard;

  const key = detectKey(notes);
  const open = (tonic: number) => ((key.mode === 'major' ? OPEN_MAJOR_KEYS : OPEN_MINOR_KEYS).includes(((tonic % 12) + 12) % 12));
  const shiftOf = (tuning: Tuning) => {
    const shift = tuning.strings[0] - standard.strings[0];
    return tuning.strings.length === standard.strings.length && tuning.strings.every((p, i) => p - standard.strings[i] === shift) ? shift : null;
  };
  const retuned = playable.filter((r) => {
    const shift = shiftOf(r.tuning);
    return r === baseline || (shift !== null && shift !== 0 && !open(key.tonic) && open(key.tonic - shift));
  });
  const best = retuned[0];
  return best.cost < baseline.cost * 0.8 ? best.tuning : standard;
}
