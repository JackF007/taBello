// Chord diagrams: a standard, playable shape for a chord on any tuning, the way chord charts show
// them — lowest position first, as many strings as sensible, the bass (root or slash note) on the
// lowest sounding string, at most four fingers (a barre counts as one).

export interface VoicingRequest {
  /** Root pitch class and the chord's intervals from it (e.g. [0, 3, 7] for minor). */
  root: number;
  intervals: number[];
  /** Pitch class that must be the lowest sounding note (root or slash bass); -1 for none (ukulele). */
  bass: number;
  /** Open strings in physical order, lowest string first (capo not included). */
  tuning: number[];
  frets: number;
}

const pc = (pitch: number) => ((pitch % 12) + 12) % 12;

/** Frets from the lowest string up, null for a muted string; null when no playable shape exists. */
export function chordVoicing({ root, intervals, bass, tuning, frets }: VoicingRequest): (number | null)[] | null {
  const tones = intervals.map((i) => (root + i) % 12);
  // Every tone must be heard except the perfect fifth, which chord shapes often leave out.
  const fifth = intervals.includes(7) ? (root + 7) % 12 : -1;
  const required = tones.filter((t) => t !== fifth);
  let best: { frets: (number | null)[]; score: number } | null = null;

  for (let position = 0; position <= Math.min(9, frets - 3); position++) {
    // Each string: muted, open, or a fret within the hand's four-fret window.
    const options = tuning.map((open) => {
      const choices: (number | null)[] = [null];
      if (tones.includes(pc(open))) choices.push(0);
      for (let fret = Math.max(1, position); fret <= position + 3 && fret <= frets; fret++) {
        if (tones.includes(pc(open + fret))) choices.push(fret);
      }
      return choices;
    });
    const shape: (number | null)[] = new Array(tuning.length).fill(null);
    const visit = (string: number) => {
      if (string < tuning.length) {
        for (const choice of options[string]) {
          shape[string] = choice;
          visit(string + 1);
        }
        shape[string] = null;
        return;
      }
      const sounding = shape.map((f, s) => (f === null ? null : tuning[s] + f));
      const lowest = sounding.findIndex((p) => p !== null);
      if (lowest < 0) return;
      const lowestPitch = Math.min(...sounding.filter((p): p is number => p !== null));
      if (bass >= 0 && pc(lowestPitch) !== bass) return;
      const heard = new Set(sounding.filter((p): p is number => p !== null).map(pc));
      for (const tone of required) if (!heard.has(tone)) return;
      // Fingers: fretted notes, minus a barre at the lowest fret.
      const fretted = shape.filter((f): f is number => f !== null && f > 0);
      const lowestFret = fretted.length ? Math.min(...fretted) : 0;
      const atLowest = fretted.filter((f) => f === lowestFret).length;
      // Up to four fretted notes take a finger each; more need a barre at the lowest fret (one
      // finger across the strings), under which no string can ring open.
      if (fretted.length > 4) {
        if (atLowest < 2 || fretted.length - (atLowest - 1) > 4) return;
        const first = shape.indexOf(lowestFret);
        const last = shape.lastIndexOf(lowestFret);
        if (shape.slice(first, last + 1).some((f) => f === 0)) return;
      }
      const strings = sounding.filter((p) => p !== null).length;
      // Strings muted above the bass (the hand would have to damp them while strumming).
      const muted = sounding.slice(lowest).filter((p) => p === null).length;
      const opens = shape.filter((f) => f === 0).length;
      // More strings, low on the neck, a compact hand, open strings, and the fifth.
      const highestFret = fretted.length ? Math.max(...fretted) : 0;
      const span = fretted.length ? highestFret - lowestFret : 0;
      // Open strings mixed with notes high on the neck make unfamiliar shapes; charts show barres there.
      const mixed = opens > 0 && highestFret >= 4 ? 1.5 : 0;
      const score = strings * 2 - muted * 2.5 - highestFret * 0.8 - span * 0.5 + opens * 0.3 - mixed + (heard.has(fifth) ? 1 : 0);
      if (!best || score > best.score) best = { frets: [...shape], score };
    };
    visit(0);
  }
  return (best as { frets: (number | null)[] } | null)?.frets ?? null;
}
