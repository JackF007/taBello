import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../../../../shared/ipc';
import { melodyNotes, partNotes } from './parts';

const note = (start: number, pitch: number, duration = 0.3, velocity = 0.6): NoteEvent => ({ start, duration, pitch, velocity });

describe('melody and accompaniment', () => {
  // An A minor arpeggio in 8ths (bass on the beat) and, over it, a lead line played louder.
  const arpeggio = Array.from({ length: 32 }, (_, i) => note(i * 0.3, [45, 52, 57, 60][i % 4], 0.6, 0.55));
  const lead = [69, 72, 74, 76, 74, 72, 69, 67].map((p, i) => note(0.15 + i * 1.2, p, 1, 0.75));
  const notes = [...arpeggio, ...lead];

  it('follows the lead line over an arpeggio', () => {
    const melody = melodyNotes(notes);
    expect(lead.every((n) => melody[notes.indexOf(n)])).toBe(true);
    // The arpeggio stays in the accompaniment (its bass always).
    expect(arpeggio.filter((n) => n.pitch === 45).some((n) => melody[notes.indexOf(n)])).toBe(false);
    expect(arpeggio.filter((n) => melody[notes.indexOf(n)]).length).toBeLessThanOrEqual(4);
  });

  it('leaves the backing out when the lead takes a breath', () => {
    // A lead with bends and vibrato, then four seconds of the arpeggio alone, then the lead again.
    const backing = Array.from({ length: 48 }, (_, i) => note(i * 0.3, [45, 52, 57, 62][i % 4], 0.6, 0.6));
    const phrase = (start: number) => [67, 69, 67].map((p, i) => ({ ...note(start + i * 0.6, p, 0.5, 0.65), ...(i === 1 ? { bend: 2 } : { vibrato: true }) }));
    const solo = [...phrase(0.15), ...phrase(10.35)];
    const all = [...backing, ...solo];
    const melody = melodyNotes(all);
    expect(solo.every((n) => melody[all.indexOf(n)])).toBe(true);
    expect(backing.filter((n) => melody[all.indexOf(n)])).toEqual([]);
  });

  it('gives each part its notes and where they come from', () => {
    expect(partNotes(notes, 'all').notes).toBe(notes);
    const melody = partNotes(notes, 'melody');
    const accompaniment = partNotes(notes, 'accompaniment');
    expect(melody.notes.length + accompaniment.notes.length).toBe(notes.length);
    melody.notes.forEach((n, k) => expect(notes[melody.sources[k]]).toBe(n));
  });
});
