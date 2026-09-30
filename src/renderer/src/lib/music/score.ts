import type { Instrument, Tuning } from '../../../../shared/instruments';
import type { ArrangeOptions } from './arrange';

/** Pitch at or above which notes are written on the upper staff of a grand staff (middle C). */
export const GRAND_STAFF_SPLIT = 60;

/** Arrangement options for an instrument: strings and frets for guitar/bass, staves for the others. */
export function arrangementOptions(
  instrument: Instrument,
  tuning: Tuning,
  timing: { bpm: number; offset: number },
  capo = 0,
): ArrangeOptions {
  if (instrument.notation === 'tab') {
    return { kind: 'fretted', tuning: tuning.strings, frets: instrument.frets, capo, ...timing };
  }
  return {
    kind: 'pitched',
    range: instrument.range,
    maxPolyphony: instrument.maxPolyphony,
    splitAt: instrument.notation === 'grand' ? GRAND_STAFF_SPLIT : undefined,
    ...timing,
  };
}
