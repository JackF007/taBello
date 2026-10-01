// Reads GuitarSet annotations (JAMS files): one "note_midi" annotation per string.
// https://guitarset.weebly.com/ — data_source "0" is the low E string.
import type { NoteEvent } from '../../src/shared/ipc';

export interface ReferenceNote extends NoteEvent {
  /** String index, 0 = lowest (as in TaBello's tunings). */
  string: number;
}

interface Observation {
  time: number;
  duration: number;
  value: number;
}

interface JamsAnnotation {
  namespace: string;
  annotation_metadata?: { data_source?: string };
  /** A list of observations, or (older JAMS) parallel arrays. */
  data: Observation[] | { time: number[]; duration: number[]; value: number[] };
}

function observations(data: JamsAnnotation['data']): Observation[] {
  if (Array.isArray(data)) return data;
  return data.time.map((time, i) => ({ time, duration: data.duration[i], value: data.value[i] }));
}

export function parseJams(json: unknown): { notes: ReferenceNote[]; tempo: number | null } {
  const annotations = (json as { annotations?: JamsAnnotation[] }).annotations ?? [];
  const notes: ReferenceNote[] = [];
  for (const annotation of annotations.filter((a) => a.namespace === 'note_midi')) {
    const string = Number(annotation.annotation_metadata?.data_source);
    if (!Number.isInteger(string)) continue;
    for (const { time, duration, value } of observations(annotation.data)) {
      // Pitches are annotated in fractional MIDI (bends, intonation).
      notes.push({ start: time, duration, pitch: Math.round(value), velocity: 1, string });
    }
  }
  const tempo = annotations.find((a) => a.namespace === 'tempo');
  const tempoValue = tempo ? observations(tempo.data)[0]?.value : undefined;
  return { notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch), tempo: tempoValue ?? null };
}
