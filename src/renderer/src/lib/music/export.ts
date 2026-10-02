import { Midi } from '@tonejs/midi';
import type { NoteEvent } from '../../../../shared/ipc';
import type { Instrument } from '../../../../shared/instruments';
import type { Arrangement, PlacedNote, TabBeat, Techniques } from './arrange';
import { alphaTexPitch, chordName, makeKey, type Key } from './theory';

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

/**
 * Names the chords of an arrangement: each newly struck beat of three notes or more that forms a
 * recognizable chord, written only when the chord changes. Names follow the shapes as written in the
 * tab (relative to the capo), as chord charts do.
 */
export function chordLabels(arrangement: Arrangement, stringCount: number, capo: number, flats: boolean): (ChordLabel | null)[][] {
  let previous: string | null = null;
  return arrangement.bars.map((beats) =>
    beats.map((beat) => {
      if (beat.notes.length < 3 || beat.notes.some((n) => n.tied)) return null;
      const name = chordName(
        beat.notes.map((n) => n.pitch - capo),
        flats,
      );
      if (!name || name === previous) return null;
      previous = name;
      const frets = Array.from({ length: stringCount }, (_, i) => beat.notes.find((n) => n.string === stringCount - 1 - i)?.fret ?? null);
      return { name, frets };
    }),
  );
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
  const marks: TempoMark[] = [];
  let shown = 0;
  let current = 0;
  let elapsed = 0;
  for (let bar = 0; bar < barTimes.length - 1; bar++) {
    const target = barTimes[bar + 1] - barTimes[0];
    const exact = (quartersPerBar * 60) / Math.max(1e-3, target - elapsed);
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
    elapsed += (quartersPerBar * 60) / current;
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
      : chordLabels(arrangement, stringCount, capo, makeFlats(key, capo));
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
    `\\ts ${meter.numerator} ${meter.denominator}`,
    `\\ks ${key.alphaTex}`,
    ...[...diagrams.values()].map((d) => `\\chord (${quote(d.name)} ${d.frets.map((f) => f ?? 'x').join(' ')})`),
    arrangement.bars
      .map((beats, bar) => {
        const mark = tempoAt.get(bar);
        const tempo = mark ? `\\tempo (${mark.bpm}${mark.visible ? '' : ' hide'}) ` : '';
        return tempo + beats.map((b, i) => beatToAlphaTex(b, stringCount, labels[bar][i])).join(' ');
      })
      .join(' |\n'),
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
