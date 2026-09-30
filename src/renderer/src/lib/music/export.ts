import { Midi } from '@tonejs/midi';
import type { NoteEvent } from '../../../../shared/ipc';
import type { Instrument } from '../../../../shared/instruments';
import type { Arrangement, PlacedNote, TabBeat } from './arrange';
import { alphaTexPitch, type Key } from './theory';

export interface ScoreHeader {
  title: string;
  bpm: number;
  key: Key;
  instrument: Instrument;
  /** Open-string MIDI pitches, lowest string first (fretted instruments). */
  tuning: number[];
  /** Capo fret, 0 for none (fretted instruments). */
  capo?: number;
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function noteToAlphaTex(note: PlacedNote, stringCount: number): string {
  if (note.fret !== undefined && note.string !== undefined) {
    // Tablature: fret.string, strings numbered from the highest-pitched one (1); "-" continues a tie.
    return `${note.tied ? '-' : note.fret}.${stringCount - note.string}`;
  }
  // Notation only: the pitch itself; {t} continues a tie.
  return `${alphaTexPitch(note.pitch)}${note.tied ? '{t}' : ''}`;
}

function beatToAlphaTex(beat: TabBeat, stringCount: number): string {
  const suffix = `.${beat.value}${beat.dotted ? '{d}' : ''}`;
  if (beat.notes.length === 0) return `r${suffix}`;
  const notes = beat.notes.map((n) => noteToAlphaTex(n, stringCount));
  return (notes.length === 1 ? notes[0] : `(${notes.join(' ')})`) + suffix;
}

function barsToAlphaTex(bars: TabBeat[][], stringCount: number): string {
  return bars.map((beats) => beats.map((b) => beatToAlphaTex(b, stringCount)).join(' ')).join(' |\n');
}

/** Renders an arrangement as alphaTex: one track, written the way the instrument is usually read. */
export function toAlphaTex(arrangement: Arrangement, header: ScoreHeader): string {
  const { instrument, key } = header;
  const lines = [`\\title ${quote(header.title)}`, `\\tempo ${Math.round(header.bpm)}`, '.', `\\track ${quote(instrument.name)}`];

  if (instrument.notation === 'tab') {
    const stringCount = header.tuning.length;
    lines.push(
      '\\staff {score tabs}',
      `\\instrument ${instrument.alphaTexInstrument}`,
      `\\tuning ${[...header.tuning].reverse().map(alphaTexPitch).join(' ')}`,
      ...(header.capo ? [`\\capo ${header.capo}`] : []),
      ...(instrument.id === 'bass' ? ['\\clef F4'] : []),
      '\\ts 4 4',
      `\\ks ${key.alphaTex}`,
      barsToAlphaTex(arrangement.staves[0], stringCount),
    );
  } else {
    lines.push(`\\instrument ${instrument.alphaTexInstrument}`);
    const clefs = instrument.notation === 'grand' ? ['G2', 'F4'] : ['G2'];
    arrangement.staves.forEach((bars, i) => {
      lines.push('\\staff {score}', `\\clef ${clefs[i]}`, '\\ts 4 4', `\\ks ${key.alphaTex}`, barsToAlphaTex(bars, 0));
    });
  }
  return lines.join('\n');
}

/** Standard MIDI file with the notes as detected (unquantized), for use in a DAW. */
export function toMidi(notes: NoteEvent[], header: Pick<ScoreHeader, 'title' | 'bpm' | 'instrument'>): Uint8Array {
  const midi = new Midi();
  midi.header.name = header.title;
  midi.header.setTempo(header.bpm);
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
