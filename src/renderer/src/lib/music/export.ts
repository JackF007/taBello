import { Midi } from '@tonejs/midi';
import type { NoteEvent } from '../../../../shared/ipc';
import type { Instrument } from '../../../../shared/instruments';
import type { Arrangement, TabBeat } from './arrange';
import { alphaTexPitch, type Key } from './theory';

export interface ScoreHeader {
  title: string;
  bpm: number;
  key: Key;
  instrument: Instrument;
  /** Open-string MIDI pitches, lowest string first. */
  tuning: number[];
}

function quote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function beatToAlphaTex(beat: TabBeat, stringCount: number): string {
  const suffix = `.${beat.value}${beat.dotted ? '{d}' : ''}`;
  if (beat.notes.length === 0) return `r${suffix}`;
  // alphaTex numbers strings from the highest-pitched one (1) down, and writes notes as fret.string.
  const notes = beat.notes.map((n) => `${n.tied ? '-' : n.fret}.${stringCount - n.string}`);
  return (notes.length === 1 ? notes[0] : `(${notes.join(' ')})`) + suffix;
}

/** Renders an arrangement as alphaTex: standard notation plus tablature, one track. */
export function toAlphaTex(arrangement: Arrangement, header: ScoreHeader): string {
  const stringCount = header.tuning.length;
  const tuning = [...header.tuning].reverse().map(alphaTexPitch).join(' ');
  const lines = [
    `\\title ${quote(header.title)}`,
    `\\tempo ${Math.round(header.bpm)}`,
    '.',
    `\\track ${quote(header.instrument.name)}`,
    '\\staff {score tabs}',
    `\\instrument ${header.instrument.alphaTexInstrument}`,
    `\\tuning ${tuning}`,
    ...(header.instrument.id === 'bass' ? ['\\clef F4'] : []),
    '\\ts 4 4',
    `\\ks ${header.key.alphaTex}`,
    arrangement.bars.map((beats) => beats.map((b) => beatToAlphaTex(b, stringCount)).join(' ')).join(' |\n'),
  ];
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
