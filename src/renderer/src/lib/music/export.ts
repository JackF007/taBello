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

/**
 * Names the chords of an arrangement, bar by bar (or half bar when the harmony changes there), from
 * every note that sounds — so arpeggios and fingerpicked parts get chord names too, not only strums.
 * A name is written where its chord starts and only when it changes. Names follow the shapes as
 * played (relative to the capo), as chord charts do; the diagram shows the strings the chord uses.
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
  return arrangement.bars.map((beats, barIndex) => {
    const labels: (ChordLabel | null)[] = beats.map(() => null);
    const starts: number[] = [];
    beats.reduce((tick, beat) => (starts.push(tick), tick + beatTicks(beat)), 0);

    // The bass voice of the same bar sounds too (fingerstyle).
    const bassBeats = arrangement.bass?.[barIndex] ?? [];
    const bassStarts: number[] = [];
    bassBeats.reduce((tick, beat) => (bassStarts.push(tick), tick + beatTicks(beat)), 0);

    const analyse = (from: number, to: number) => {
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
      const weights = new Array<number>(12).fill(0);
      const chordal = new Array<number>(12).fill(0);
      for (const { beat } of all) {
        for (const note of beat.notes) {
          const pc = (((note.pitch - capo) % 12) + 12) % 12;
          weights[pc] += beatTicks(beat);
          if (beat.notes.length >= 3) chordal[pc] += beatTicks(beat);
        }
      }
      const bass = (((Math.min(...pitches) - capo) % 12) + 12) % 12;
      const found = harmony(weights, bass, withBass, chordal);
      if (!found) return null;
      const chord = inContext(found);
      const name = formatChord(chord, flats);
      const tones = chord.intervals.map((i) => (chord.root + i) % 12);
      // The diagram: the shape actually played when the chord is strummed (three strings or more,
      // all chord tones, within the hand's reach); otherwise the standard shape for this tuning.
      const strum = inside
        .map(({ beat }) => beat.notes)
        .find((notes) => {
          const fretted = notes.filter((n) => n.fret > 0).map((n) => n.fret);
          return notes.length >= 3 && notes.every((n) => tones.includes((((n.pitch - capo) % 12) + 12) % 12)) && (fretted.length === 0 || Math.max(...fretted) - Math.min(...fretted) <= 4);
        });
      let shape = strum ? tuning.map((_, string) => strum.find((n) => n.string === string)?.fret ?? null) : shapes.get(name);
      if (!shape) {
        shape = chordVoicing({ root: chord.root, intervals: chord.intervals, bass: withBass ? (chord.bass ?? chord.root) : -1, tuning, frets }) ?? tuning.map(() => null);
        shapes.set(name, shape);
      }
      // alphaTex lists frets from the 1st (highest) string down.
      const diagram = [...shape].reverse();
      return { name, frets: diagram, at: inside[0].i };
    };

    const whole = analyse(0, ticks.bar);
    let segments = whole ? [whole] : [];
    // Two chords in one bar (4/4): when both halves are clear and different.
    if (arrangement.meter.beatsPerBar >= 4) {
      const half = (arrangement.meter.beatsPerBar / 2) * ticks.beat;
      const first = analyse(0, half);
      const second = analyse(half, ticks.bar);
      if (first && second && first.name !== second.name) segments = [first, second];
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
