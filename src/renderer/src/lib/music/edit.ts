// Hand edits of the tab. The tab is always computed from the project's notes, so an edit changes the
// detected notes behind a tab note (its sources) and the tab is arranged again.
import type { NoteEvent } from '../../../../shared/ipc';
import type { Arrangement, PlacedNote } from './arrange';

/** Where a note is in the tab: bar and beat indices, and string (in the tuning's physical order). */
export interface NoteLocation {
  bar: number;
  beat: number;
  string: number;
  /** 1 for the bass voice of a fingerstyle arrangement; 0 (or absent) otherwise. */
  voice?: number;
}

export type NoteEdit =
  | { type: 'delete' }
  | { type: 'fret'; fret: number }
  /** Another string: with the same fret (a new note, as typed in a tab) or the same pitch (a new fingering). */
  | { type: 'string'; string: number; keep: 'fret' | 'pitch' }
  | { type: 'pitch'; delta: number }
  /** Dragged in the score: up or down in semitones, and earlier or later in the recording. */
  | { type: 'move'; semitones: number; seconds: number };

export interface EditContext {
  /** Open strings without capo, in the tuning's physical order. */
  tuning: number[];
  capo: number;
  frets: number;
}

export function findNote(arrangement: Arrangement, location: NoteLocation): PlacedNote | null {
  const bars = location.voice === 1 && arrangement.bass ? arrangement.bass : arrangement.bars;
  return bars[location.bar]?.[location.beat]?.notes.find((n) => n.string === location.string) ?? null;
}

/** Where the tab note made from a given detected note is (its first beat, not a tied one). */
export function locateSource(arrangement: Arrangement, isSource: (sources: number[]) => boolean): NoteLocation | null {
  const voices = arrangement.bass ? [arrangement.bars, arrangement.bass] : [arrangement.bars];
  for (const [voice, bars] of voices.entries()) {
    for (const [bar, beats] of bars.entries()) {
      for (const [beat, { notes }] of beats.entries()) {
        const note = notes.find((n) => !n.tied && isSource(n.sources));
        if (note) return { bar, beat, string: note.string, ...(voice === 1 ? { voice } : {}) };
      }
    }
  }
  return null;
}

/**
 * Applies an edit to the notes a tab note was made from. Returns the new notes and where the edited
 * note will be, or null when the edit is not playable (e.g. a fret beyond the neck).
 */
export function applyEdit(
  notes: NoteEvent[],
  placed: PlacedNote,
  location: NoteLocation,
  edit: NoteEdit,
  context: EditContext,
): { notes: NoteEvent[]; location: NoteLocation | null } | null {
  const sources = new Set(placed.sources);
  if (edit.type === 'delete') return { notes: notes.filter((_, i) => !sources.has(i)), location: null };

  const open = (string: number) => context.tuning[string] + context.capo;
  const playable = (string: number, pitch: number) =>
    string >= 0 && string < context.tuning.length && pitch - open(string) >= 0 && pitch - open(string) <= context.frets - context.capo;

  let pitch = placed.pitch;
  let string: number | undefined = placed.string;
  let shift = 0;
  if (edit.type === 'fret') pitch = open(placed.string) + edit.fret;
  else if (edit.type === 'string') {
    string = edit.string;
    if (edit.keep === 'fret') pitch = open(edit.string) + placed.fret;
  } else {
    const delta = edit.type === 'pitch' ? edit.delta : edit.semitones;
    if (edit.type === 'move') shift = edit.seconds;
    pitch = placed.pitch + delta;
    // Stay on the same string when possible; otherwise let the fingering pick one.
    if (!playable(placed.string, pitch)) string = undefined;
  }
  if (pitch < 0 || pitch > 127) return null;
  if (string !== undefined && !playable(string, pitch)) return null;
  if (string === undefined && !context.tuning.some((_, s) => playable(s, pitch))) return null;

  return {
    notes: notes.map((note, i) => (sources.has(i) ? { ...note, pitch, string, start: Math.max(0, note.start + shift) } : note)),
    location: string === undefined || shift !== 0 ? null : { ...location, string },
  };
}
