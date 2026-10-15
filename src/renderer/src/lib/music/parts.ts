// Melody and accompaniment: which notes form the line on top (a lead guitar, the melody of a
// fingerstyle piece) and which play under it (an arpeggio, chords, a bass). The way a musician
// follows a melody through a recording: mostly the highest note, moving smoothly, held or shaken
// more than the notes around it.
import type { NoteEvent, PartId } from '../../../../shared/ipc';

/** Notes starting within this time of each other are struck together. */
const TOGETHER = 0.04;
/**
 * Seconds a listener keeps the melody in mind through a pause: a note after it must follow on from
 * the melody (no leap down into the accompaniment just because the lead takes a breath).
 */
const MELODY_MEMORY = 2;
/** Seconds either side that set the register of the music around a note. */
const REGISTER_WINDOW = 3;

/**
 * For each note, whether it belongs to the melody. The melody is the best monophonic path through
 * the notes (one note at a time), scored note by note — the top note of what is struck together,
 * above the register around it, with a bend or vibrato — and against large leaps between its notes,
 * so that a note of the accompaniment between two melody notes is left out.
 */
export function melodyNotes(notes: NoteEvent[]): boolean[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].start - notes[b].start || notes[b].pitch - notes[a].pitch);
  if (order.length === 0) return [];

  const starts = order.map((i) => notes[i].start);
  // Positions in `order` of the first note starting at or after a time.
  const at = (t: number) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const score = order.map((i) => {
    const note = notes[i];
    // The register around the note: halfway between its low and high notes within a few seconds (not
    // the median, which a busy melody pulls up to itself).
    const around = order.slice(at(note.start - REGISTER_WINDOW), at(note.start + REGISTER_WINDOW + 1e-9)).map((k) => notes[k].pitch).sort((a, b) => a - b);
    const register = (around[Math.floor(around.length * 0.1)] + around[Math.ceil(around.length * 0.9) - 1]) / 2;
    const loudness = order.slice(at(note.start - REGISTER_WINDOW), at(note.start + REGISTER_WINDOW + 1e-9)).map((k) => notes[k].velocity).sort((a, b) => a - b);
    const typical = loudness[loudness.length >> 1];
    const together = order.slice(at(note.start - TOGETHER + 1e-9), at(note.start + TOGETHER));
    // On top of what is struck with it — leaving out notes much softer than it (a light strum above
    // a melody played out).
    const top = together.every((k) => notes[k].pitch <= note.pitch || notes[k].velocity < note.velocity * 0.75);
    const lowest = together.length > 1 && together.every((k) => notes[k].pitch >= note.pitch);
    // A chord struck under the melody: three notes or more, this one not the loudest.
    const inChord = together.length >= 3 && together.some((k) => notes[k].velocity > note.velocity * 1.1);
    const height = Math.max(-2, Math.min(2, (note.pitch - register) / 6));
    const louder = Math.max(-1, Math.min(1, (note.velocity - typical) / 0.15));
    const expressive = note.bend || note.vibrato ? 1 : 0;
    return (top ? 1 : -2) + (lowest ? -2 : 0) + (inChord ? -1.5 : 0) + height + louder + expressive - 0.3;
  });

  // Best path ending at each note: its score plus the best path before it, minus the leap. A path
  // can also start afresh after a pause (best of everything that ended well before).
  const best = new Array<number>(order.length).fill(-Infinity);
  const from = new Array<number>(order.length).fill(-1);
  const leap = (a: number, b: number) => {
    const interval = Math.abs(notes[a].pitch - notes[b].pitch);
    return 0.1 * Math.max(0, interval - 2) + 0.3 * Math.max(0, interval - 7);
  };
  let restart = { value: 0, index: -1, upTo: -1 };
  const prefix: { value: number; index: number }[] = [];
  for (let r = 0; r < order.length; r++) {
    const t = notes[order[r]].start;
    // Notes that ended (started) long enough before: the best of them is a fresh start.
    while (restart.upTo + 1 < r && notes[order[restart.upTo + 1]].start < t - MELODY_MEMORY) {
      restart.upTo++;
      const candidate = prefix[restart.upTo];
      if (candidate.value > restart.value) restart = { ...restart, value: candidate.value, index: candidate.index };
    }
    let value = restart.value;
    let link = restart.index;
    for (let q = r - 1; q >= 0 && notes[order[q]].start >= t - MELODY_MEMORY; q--) {
      if (notes[order[q]].start > t - TOGETHER || best[q] === -Infinity) continue;
      const v = best[q] - leap(order[q], order[r]);
      if (v > value) [value, link] = [v, q];
    }
    best[r] = value + score[r];
    from[r] = link;
    const previous = prefix[r - 1];
    prefix.push(!previous || best[r] > previous.value ? { value: best[r], index: r } : previous);
  }

  const melody = new Array<boolean>(notes.length).fill(false);
  let r = prefix[order.length - 1].index;
  while (r >= 0) {
    melody[order[r]] = true;
    r = from[r];
  }
  return melody;
}

/** The notes of one part, and for each the index of the note it comes from. */
export function partNotes(notes: NoteEvent[], part: PartId): { notes: NoteEvent[]; sources: number[] } {
  if (part === 'all') return { notes, sources: notes.map((_, i) => i) };
  const melody = melodyNotes(notes);
  const sources = notes.map((_, i) => i).filter((i) => melody[i] === (part === 'melody'));
  return { notes: sources.map((i) => notes[i]), sources };
}
