// Time signatures and rhythmic feels the arrangement can be written in.

export type MeterId = '4/4' | '3/4' | '6/8' | '4/4-triplets';

export interface Meter {
  id: MeterId;
  name: string;
  /** Written time signature. */
  numerator: number;
  denominator: number;
  /** Counted beats per bar (6/8 is counted in two dotted-quarter beats). */
  beatsPerBar: number;
  /** Grid positions per beat: 16th notes, 8th notes in 6/8, or 8th-note triplets. */
  slotsPerBeat: number;
  /** Length of one beat in quarter notes. */
  quartersPerBeat: number;
  /** Whether off-beat rhythms are written as triplets. */
  tuplets: boolean;
}

export const METERS: Record<MeterId, Meter> = {
  '4/4': { id: '4/4', name: '4/4', numerator: 4, denominator: 4, beatsPerBar: 4, slotsPerBeat: 4, quartersPerBeat: 1, tuplets: false },
  '3/4': { id: '3/4', name: '3/4 (waltz)', numerator: 3, denominator: 4, beatsPerBar: 3, slotsPerBeat: 4, quartersPerBeat: 1, tuplets: false },
  '6/8': { id: '6/8', name: '6/8', numerator: 6, denominator: 8, beatsPerBar: 2, slotsPerBeat: 3, quartersPerBeat: 1.5, tuplets: false },
  '4/4-triplets': {
    id: '4/4-triplets',
    name: '4/4, triplet feel (swing, shuffle)',
    numerator: 4,
    denominator: 4,
    beatsPerBar: 4,
    slotsPerBeat: 3,
    quartersPerBeat: 1,
    tuplets: true,
  },
};

export function isMeterId(value: unknown): value is MeterId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(METERS, value);
}
