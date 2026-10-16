import { Midi } from '@tonejs/midi';
import type { NoteEvent } from '../../../../shared/ipc';
import type { Instrument } from '../../../../shared/instruments';
import { meterTicks, type Arrangement, type PlacedNote, type TabBeat, type Techniques } from './arrange';
import { alphaTexPitch, chordIntervals, formatChord, harmony, makeKey, type Harmony, type Key } from './theory';
import { chordVoicing } from './voicing';

export interface ScoreHeader {
  title: string;
  bpm: number;
  key: Key;
  instrument: Instrument;
  /** Open-string MIDI pitches in the tuning's physical order. */
  tuning: number[];
  /** Capo fret, 0 for none. */
  capo?: number;
  /** Write chord names above the staff, with their diagrams (default true). */
  chords?: boolean;
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

interface ChordLabel {
  name: string;
  /** Diagram frets from the 1st (highest) string down, null for a string not played. */
  frets: (number | null)[];
}

/** alphaTex note effects for a note's playing techniques, e.g. "{h}" or "{b (0 4) v}". */
function noteEffects(note: PlacedNote): string {
  const t: Techniques = note.techniques ?? {};
  const effects: string[] = [];
  // Bend points are in quarter tones; a release returns to the original pitch.
  if (t.bend) effects.push(`b (0 ${Math.round(t.bend * 2)}${t.release ? ' 0' : ''})`);
  if (t.hammer) effects.push('h');
  if (t.slide) effects.push(t.slide === 'legato' ? 'sl' : 'ss');
  if (t.slideIn) effects.push(t.slideIn === 'below' ? 'sib' : 'sia');
  if (t.slideOut) effects.push(t.slideOut === 'up' ? 'sou' : 'sod');
  if (t.vibrato) effects.push('v');
  return effects.length > 0 ? `{${effects.join(' ')}}` : '';
}

function beatToAlphaTex(beat: TabBeat, stringCount: number, chord: ChordLabel | null): string {
  const effects = [
    ...(beat.dotted ? ['d'] : []),
    ...(beat.tuplet ? ['tu 3'] : []),
    ...(chord ? [`ch ${quote(chord.name)}`] : []),
  ];
  const suffix = `.${beat.value}${effects.length > 0 ? `{${effects.join(' ')}}` : ''}`;
  if (beat.notes.length === 0) return `r${suffix}`;
  // alphaTex writes notes as fret.string, numbering strings from the 1st (the last in our tuning order);
  // "-" as the fret continues a tie.
  const notes = beat.notes.map((n) => `${n.tied ? '-' : n.fret}.${stringCount - n.string}${noteEffects(n)}`);
  return (notes.length === 1 ? notes[0] : `(${notes.join(' ')})`) + suffix;
}

const beatTicks = (beat: TabBeat) => (48 / beat.value) * (beat.dotted ? 1.5 : 1) * (beat.tuplet ? 2 / 3 : 1);

/** A chord tone added to a triad, by interval above the root, and the chord type it makes. */
const EXTENSIONS: Record<string, Record<number, string>> = {
  '': { 2: 'add9', 9: '6', 10: '7', 11: 'maj7' },
  m: { 2: 'madd9', 9: 'm6', 10: 'm7' },
};

/**
 * Names the chords of an arrangement, bar by bar (or half bar when the harmony changes there), from
 * every note that sounds — so arpeggios and fingerpicked parts get chord names too, not only strums.
 * A name is written where its chord starts and only when it changes. Names follow the shapes as
 * played (relative to the capo), as chord charts do; the diagram shows the strings the chord uses.
 *
 * Like a musician, it reads the harmony in context. An arpeggio often leaves out a chord tone that
 * the hand holds anyway (the C of a C/G picked as G–E–G, the third of an Am7 picked as A–E–G): a
 * stretch that a chord heard whole elsewhere on the same bass explains, with at most one added tone
 * (6th, 7th or 9th), takes that chord's name. And a chord over the bass of the chord next to it is
 * read as that chord with an added tone (F6 before F, Cadd9/G before C/G), not as an inversion of
 * another one (Dm/F, Em/G).
 */
export function chordLabels(
  arrangement: Arrangement,
  /** Open strings without capo (the shapes), lowest first, and the number of frets. */
  tuning: number[],
  frets: number,
  capo: number,
  flats: boolean,
  withBass = true,
): (ChordLabel | null)[][] {
  const ticks = meterTicks(arrangement.meter);
  const pitchClass = (pitch: number) => (((pitch - capo) % 12) + 12) % 12;

  interface Stretch {
    found: Harmony | null;
    bass: number;
    /** Pitch classes clearly heard: sounding (held over from before, too), and played here. */
    sounding: number[];
    heard: number[];
    /** Index of the beat where it starts, and the notes of its beats. */
    at: number;
    beats: PlacedNote[][];
  }

  const analyse = (barIndex: number, from: number, to: number): Stretch | null => {
    const beats = arrangement.bars[barIndex];
    const starts: number[] = [];
    beats.reduce((tick, beat) => (starts.push(tick), tick + beatTicks(beat)), 0);
    // The bass voice of the same bar sounds too (fingerstyle).
    const bassBeats = arrangement.bass?.[barIndex] ?? [];
    const bassStarts: number[] = [];
    bassBeats.reduce((tick, beat) => (bassStarts.push(tick), tick + beatTicks(beat)), 0);

    const inside = beats.map((beat, i) => ({ beat, i, start: starts[i] })).filter(({ start }) => start >= from && start < to);
    if (inside.length === 0) return null;
    const all = [...inside, ...bassBeats.map((beat, i) => ({ beat, i: -1, start: bassStarts[i] })).filter(({ start }) => start >= from && start < to)];
    const sounding = all.flatMap(({ beat }) => beat.notes.map((note) => ({ note, weight: beatTicks(beat) })));
    // Harmony needs more than one line: notes together, or an arpeggio spanning an octave.
    // Notes sounding together, counting the bass voice.
    const together = Math.max(
      0,
      ...inside.map(({ beat, start }) => beat.notes.length + (bassBeats.some((b, k) => b.notes.length > 0 && bassStarts[k] <= start && start < bassStarts[k] + beatTicks(b)) ? 1 : 0)),
    );
    const pitches = sounding.map(({ note }) => note.pitch);
    if (sounding.length === 0 || (together < 2 && (pitches.length < 4 || Math.max(...pitches) - Math.min(...pitches) < 12))) return null;
    // Each note counts for its written length, except the bass line: a bass note holds the harmony
    // until the next one (the bass rings on a guitar while the melody moves above it).
    const lowest = Math.min(...pitches);
    const bassAt = (o: (typeof all)[number]) => {
      const low = Math.min(...o.beat.notes.map((n) => n.pitch));
      return low <= lowest + 7 ? low : null;
    };
    const bassOnsets = all.filter((o) => o.beat.notes.length > 0 && bassAt(o) !== null).map((o) => o.start);
    const weights = new Array<number>(12).fill(0);
    const chordal = new Array<number>(12).fill(0);
    // Played here, not held over from the chord before (a note tied into the bar is not its harmony).
    const struck = new Array<number>(12).fill(0);
    for (const o of all) {
      const bassPitch = bassAt(o);
      for (const note of o.beat.notes) {
        const length = note.pitch === bassPitch ? Math.min(to, ...bassOnsets.filter((b) => b > o.start)) - o.start : beatTicks(o.beat);
        const pc = pitchClass(note.pitch);
        weights[pc] += length;
        if (o.beat.notes.length >= 3) chordal[pc] += length;
        if (!note.tied) struck[pc] += length;
      }
    }
    // The bass of the chord is the one on its first beat: an alternating bass (C, then G under a C
    // chord) does not make an inversion.
    const firstBeat = all.filter(({ start }) => start < all.reduce((min, a) => Math.min(min, a.start), Infinity) + ticks.beat);
    const bassPitch = Math.min(...firstBeat.flatMap(({ beat }) => beat.notes.map((n) => n.pitch)).concat(firstBeat.length ? [] : pitches));
    const bass = pitchClass(bassPitch);
    const total = weights.reduce((a, b) => a + b, 0);
    return {
      found: harmony(weights, bass, withBass, chordal),
      bass,
      sounding: weights.flatMap((w, pc) => (w >= total * 0.08 ? [pc] : [])),
      heard: struck.flatMap((w, pc) => (w >= total * 0.08 ? [pc] : [])),
      at: inside[0].i,
      beats: inside.map(({ beat }) => beat.notes),
    };
  };

  const tonesOf = (chord: Harmony) => chord.intervals.map((i) => (chord.root + i) % 12);
  /** Every tone of its chord heard (or every tone but the fifth, which chords often leave out). */
  const complete = (stretch: Stretch, withoutFifth = false) =>
    !!stretch.found && stretch.found.intervals.every((i) => (withoutFifth && i === 7) || stretch.sounding.includes((stretch.found!.root + i) % 12));

  // Every stretch of the piece: the bar, and its halves (4/4 and longer).
  const half = arrangement.meter.beatsPerBar >= 4 ? (arrangement.meter.beatsPerBar / 2) * ticks.beat : null;
  const stretches = arrangement.bars.map((_, bar) => ({
    whole: analyse(bar, 0, ticks.bar),
    halves: half === null ? null : ([analyse(bar, 0, half), analyse(bar, half, ticks.bar)] as const),
  }));

  // Triads heard whole, on each bass (their root, third or fifth), and how often.
  const heardWhole = new Map<number, Map<string, { chord: Harmony; count: number }>>();
  for (const { whole, halves } of stretches) {
    for (const stretch of [whole, ...(halves ?? [])]) {
      if (!stretch?.found || !['', 'm'].includes(stretch.found.suffix) || !complete(stretch) || !tonesOf(stretch.found).includes(stretch.bass)) continue;
      const byName = heardWhole.get(stretch.bass) ?? new Map<string, { chord: Harmony; count: number }>();
      const name = formatChord(stretch.found, flats);
      byName.set(name, { chord: stretch.found, count: (byName.get(name)?.count ?? 0) + 1 });
      heardWhole.set(stretch.bass, byName);
    }
  }
  /** `chord` with the heard notes beyond it as one added tone, if that makes a known chord type. */
  const extend = (chord: Harmony, heard: number[]): Harmony | null => {
    const tones = tonesOf(chord);
    const extra = heard.filter((pc) => !tones.includes(pc));
    if (extra.length === 0) return chord;
    const suffix = extra.length === 1 ? EXTENSIONS[chord.suffix]?.[(extra[0] - chord.root + 12) % 12] : undefined;
    return suffix ? { ...chord, suffix, intervals: chordIntervals(suffix)! } : null;
  };
  /** The harmony of a stretch, read in context; `neighbours` are the chords right before and after it. */
  const read = (stretch: Stretch, neighbours: (Harmony | null)[]): Harmony | null => {
    const found = stretch.found;
    const rootPosition = !!found && (found.bass === null || found.bass === found.root);
    if (found && rootPosition && complete(stretch)) return found;
    // A chord on its root without its fifth is that chord (a melody passing over it adds no tone).
    if (found && rootPosition && complete(stretch, true)) return found;
    // Chords on this bass: those next to it first, then those heard whole elsewhere, most often first.
    const nearby = neighbours.filter((n): n is Harmony => !!n && (n.bass ?? n.root) === stretch.bass && ['', 'm'].includes(n.suffix));
    const elsewhere = [...(heardWhole.get(stretch.bass)?.values() ?? [])].sort((a, b) => b.count - a.count).map((k) => k.chord);
    // An inversion heard whole stays, unless the chord next to it on the same bass explains it; a chord
    // on its root keeps its root (the context only tells its quality).
    const candidates = rootPosition ? [...nearby, ...elsewhere].filter((c) => c.root === found!.root) : found && complete(stretch) ? nearby : [...nearby, ...elsewhere];
    for (const candidate of candidates) {
      const reading = extend(candidate, stretch.heard);
      if (reading) return reading;
    }
    return found;
  };

  let previous: string | null = null;
  // The last full chord on each root: a bare fifth (A5) later in the piece takes its quality (Am),
  // as a musician reading the harmony in context would.
  const qualities = new Map<number, string>();
  const inContext = (chord: Harmony): Harmony => {
    if (chord.suffix === '5' && qualities.has(chord.root)) {
      const suffix = qualities.get(chord.root)!;
      return { ...chord, suffix, intervals: chordIntervals(suffix)! };
    }
    if (chord.suffix === '' || chord.suffix === 'm') qualities.set(chord.root, chord.suffix);
    return chord;
  };
  const shapes = new Map<string, (number | null)[]>();
  const label = (stretch: Stretch, chord: Harmony) => {
    const name = formatChord(chord, flats);
    const tones = tonesOf(chord);
    // The diagram: the shape actually played when the chord is strummed (three strings or more,
    // all chord tones, within the hand's reach); otherwise the standard shape for this tuning.
    const strum = stretch.beats.find((notes) => {
      const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
      return notes.length >= 3 && notes.every((n) => tones.includes(pitchClass(n.pitch))) && (fretted.length === 0 || Math.max(...fretted) - Math.min(...fretted) <= 4);
    });
    let shape = strum ? tuning.map((_, string) => strum.find((n) => n.string === string)?.fret ?? null) : shapes.get(name);
    if (!shape) {
      shape = chordVoicing({ root: chord.root, intervals: chord.intervals, bass: withBass ? (chord.bass ?? chord.root) : -1, tuning, frets }) ?? tuning.map(() => null);
      shapes.set(name, shape);
    }
    // alphaTex lists frets from the 1st (highest) string down.
    return { name, root: chord.root, tones, heard: stretch.sounding, frets: [...shape].reverse(), at: stretch.at };
  };

  // A chord next to a stretch is context only when it was heard whole.
  const plain = (stretch: Stretch | null | undefined) => (stretch && complete(stretch) ? stretch.found : null);
  return arrangement.bars.map((beats, barIndex) => {
    const labels: (ChordLabel | null)[] = beats.map(() => null);
    const { whole, halves } = stretches[barIndex];
    const before = plain(stretches[barIndex - 1]?.halves?.[1] ?? stretches[barIndex - 1]?.whole);
    const after = plain(stretches[barIndex + 1]?.halves?.[0] ?? stretches[barIndex + 1]?.whole);
    const named = (stretch: Stretch | null, neighbours: (Harmony | null)[]) => {
      const chord = stretch && read(stretch, neighbours);
      return chord && stretch ? label(stretch, inContext(chord)) : null;
    };
    const wholeLabel = named(whole, [before, after]);
    let segments = wholeLabel ? [wholeLabel] : [];
    // Two chords in one bar (4/4): when both halves are clear and on different roots (passing tones
    // and a moving bass under one chord are not a chord change).
    if (halves) {
      const first = named(halves[0], [before, plain(halves[1])]);
      const second = named(halves[1], [plain(halves[0]), after]);
      // The same notes heard under another name (Em, then G6 for its G–B–E upper strings) are no change.
      // So is a chord inside the other (Bdim's B–D–F within G7).
      const within = (a: NonNullable<typeof first>, b: NonNullable<typeof first>) =>
        a.heard.every((pc) => b.tones.includes(pc)) || a.tones.every((pc) => b.tones.includes(pc));
      if (first && second && first.root !== second.root && !within(second, first) && !within(first, second)) segments = [first, second];
    }
    for (const segment of segments) {
      if (segment.name === previous) continue;
      previous = segment.name;
      labels[segment.at] = { name: segment.name, frets: segment.frets };
    }
    return labels;
  });
}

export interface TempoMark {
  bar: number;
  /** Quarter notes per minute. */
  bpm: number;
  /** Shown in the score (rounded); hidden marks only keep playback in time with the recording. */
  visible: boolean;
}

/**
 * Tempo marks that make each bar last exactly as long as in the recording, so playback (and the
 * play-along cursor) stays in time. Shown tempos are whole numbers and only change when the tempo
 * moves by 4% or more; hidden fractional marks absorb the rounding.
 */
export function tempoMarks(arrangement: Arrangement): TempoMark[] {
  const { barTimes, meter } = arrangement;
  const quartersPerBar = meter.beatsPerBar * meter.quartersPerBeat;
  // A pickup bar is shorter.
  const quartersIn = (bar: number) => (bar === 0 ? quartersPerBar * (1 - arrangement.pickup / meterTicks(meter).bar) : quartersPerBar);
  const marks: TempoMark[] = [];
  let shown = 0;
  let current = 0;
  let elapsed = 0;
  for (let bar = 0; bar < barTimes.length - 1; bar++) {
    const target = barTimes[bar + 1] - barTimes[0];
    const exact = (quartersIn(bar) * 60) / Math.max(1e-3, target - elapsed);
    let bpm = Math.min(999, Math.max(10, exact));
    let visible = false;
    if (bar === 0 || Math.abs(Math.round(bpm) - shown) / shown >= 0.04) {
      bpm = Math.round(bpm);
      shown = bpm;
      visible = true;
    } else {
      bpm = Math.round(bpm * 100) / 100;
    }
    if (visible || Math.abs(bpm - current) >= 0.01) {
      marks.push({ bar, bpm, visible });
      current = bpm;
    }
    elapsed += (quartersIn(bar) * 60) / current;
  }
  return marks;
}

/** Renders an arrangement as alphaTex: standard notation plus tablature, one track. */
export function toAlphaTex(arrangement: Arrangement, header: ScoreHeader): string {
  const { instrument, key, capo = 0 } = header;
  const { meter } = arrangement;
  const stringCount = header.tuning.length;
  const labels =
    header.chords === false
      ? arrangement.bars.map((beats) => beats.map(() => null))
      : chordLabels(arrangement, header.tuning, instrument.frets, capo, makeFlats(key, capo), instrument.id !== 'ukulele');
  // One diagram per chord name: the first voicing used.
  const diagrams = new Map<string, ChordLabel>();
  for (const label of labels.flat()) if (label && !diagrams.has(label.name)) diagrams.set(label.name, label);

  const [initial, ...changes] = tempoMarks(arrangement);
  const tempoAt = new Map(changes.map((mark) => [mark.bar, mark]));
  const lines = [
    `\\title ${quote(header.title)}`,
    // alphaTab counts the tempo in quarter notes.
    `\\tempo ${initial?.bpm ?? Math.round(header.bpm * meter.quartersPerBeat)}`,
    '.',
    `\\track ${quote(instrument.name)}`,
    '\\staff {score tabs}',
    `\\instrument ${instrument.alphaTexInstrument}`,
    `\\tuning ${[...header.tuning].reverse().map(alphaTexPitch).join(' ')}`,
    ...(capo ? [`\\capo ${capo}`] : []),
    ...(instrument.id === 'bass' ? ['\\clef F4'] : []),
    // Guitar and bass are written an octave above how they sound (alphaTab's default for them);
    // ukulele music is written at pitch.
    ...(instrument.id === 'ukulele' ? ['\\displaytranspose 0'] : []),
    `\\ts ${meter.numerator} ${meter.denominator}`,
    `\\ks ${key.alphaTex}`,
    ...[...diagrams.values()].map((d) => `\\chord (${quote(d.name)} ${d.frets.map((f) => f ?? 'x').join(' ')})`),
    // With a bass voice, each voice is written in full after a \\voice marker.
    ...(arrangement.bass ? ['\\voice'] : []),
    arrangement.bars
      .map((beats, bar) => {
        const mark = tempoAt.get(bar);
        const tempo = mark ? `\\tempo (${mark.bpm}${mark.visible ? '' : ' hide'}) ` : '';
        const anacrusis = bar === 0 && arrangement.pickup > 0 ? '\\ac ' : '';
        return anacrusis + tempo + beats.map((b, i) => beatToAlphaTex(b, stringCount, labels[bar][i])).join(' ');
      })
      .join(' |\n'),
    ...(arrangement.bass
      ? ['\\voice', arrangement.bass.map((beats) => beats.map((b) => beatToAlphaTex(b, stringCount, null)).join(' ')).join(' |\n')]
      : []),
  ];
  return lines.join('\n');
}

/** Whether chord names should use flats: those of the key the shapes are played in (below the capo). */
function makeFlats(key: Key, capo: number): boolean {
  return capo === 0 ? key.flats : makeKey((key.tonic - capo + 12) % 12, key.mode).flats;
}

/**
 * Standard MIDI file with the notes as detected (unquantized), for use in a DAW. With an
 * arrangement, its tempo marks are written too, so the DAW's bars line up with the music.
 */
export function toMidi(notes: NoteEvent[], header: Pick<ScoreHeader, 'title' | 'bpm' | 'instrument'>, arrangement?: Arrangement): Uint8Array {
  const midi = new Midi();
  midi.header.name = header.title;
  if (arrangement) {
    // Before bar 1 the first tempo applies; each mark then starts exactly where its bar does.
    const ppq = midi.header.ppq;
    const marks = tempoMarks(arrangement);
    const quartersPerBar = arrangement.meter.beatsPerBar * arrangement.meter.quartersPerBeat;
    const firstBar = (Math.max(0, arrangement.startTime) * marks[0].bpm) / 60;
    midi.header.tempos = [
      { ticks: 0, bpm: marks[0].bpm },
      ...marks.slice(1).map((mark) => ({ ticks: Math.round((firstBar + mark.bar * quartersPerBar) * ppq), bpm: mark.bpm })),
    ];
    midi.header.timeSignatures = [{ ticks: 0, timeSignature: [arrangement.meter.numerator, arrangement.meter.denominator] }];
    midi.header.update();
  } else {
    midi.header.setTempo(header.bpm);
  }
  const track = midi.addTrack();
  track.name = header.instrument.name;
  track.instrument.number = header.instrument.midiProgram;
  for (const note of notes) {
    track.addNote({
      midi: note.pitch,
      time: note.start,
      duration: note.duration,
      velocity: Math.min(1, Math.max(0.1, note.velocity)),
    });
  }
  return midi.toArray();
}
