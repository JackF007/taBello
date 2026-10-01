// Hand edits of the tab. The tab is always computed from the project's notes, so an edit changes the
// detected notes behind a tab note (its sources) and the tab is arranged again.
import type { NoteEvent } from '../../../../shared/ipc';
import type { Arrangement, PlacedNote } from './arrange';

/** Where a note is in the tab: bar and beat indices, and string (in the tuning's physical order). */
export interface NoteLocation {
  bar: number;
  beat: number;
  string: number;
}

export type NoteEdit =
  | { type: 'delete' }
  | { type: 'fret'; fret: number }
  | { type: 'string'; string: number }
  | { type: 'pitch'; delta: number };

export interface EditContext {
  /** Open strings without capo, in the tuning's physical order. */
  tuning: number[];
  capo: number;
  frets: number;
}

export function findNote(arrangement: Arrangement, location: NoteLocation): PlacedNote | null {
  return arrangement.bars[location.bar]?.[location.beat]?.notes.find((n) => n.string === location.string) ?? null;
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
  if (edit.type === 'fret') pitch = open(placed.string) + edit.fret;
  else if (edit.type === 'string') string = edit.string;
  else {
    pitch = placed.pitch + edit.delta;
    // Stay on the same string when possible; otherwise let the fingering pick one.
    if (!playable(placed.string, pitch)) string = undefined;
  }
  if (pitch < 0 || pitch > 127) return null;
  if (string !== undefined && !playable(string, pitch)) return null;
  if (string === undefined && !context.tuning.some((_, s) => playable(s, pitch))) return null;

  return {
    notes: notes.map((note, i) => (sources.has(i) ? { ...note, pitch, string } : note)),
    location: string === undefined ? null : { ...location, string },
  };
}
