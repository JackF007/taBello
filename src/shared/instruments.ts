// Instrument presets, shared by the transcription worker (frequency range)
// and the renderer (arrangement, notation, colors).

export type InstrumentId = 'guitar' | 'bass' | 'piano' | 'violin' | 'accordion';

/**
 * How the instrument is written:
 * - `tab`: standard notation + tablature, notes placed on strings/frets (guitar, bass);
 * - `grand`: two staves, treble and bass clef (piano, accordion);
 * - `treble`: a single treble-clef staff (violin).
 */
export type NotationKind = 'tab' | 'grand' | 'treble';

export interface Tuning {
  id: string;
  name: string;
  /** Open-string MIDI pitches, lowest string first (empty for keyboard instruments). */
  strings: number[];
}

export interface Instrument {
  id: InstrumentId;
  name: string;
  notation: NotationKind;
  /** Fret count, for `tab` instruments. */
  frets: number;
  /** Playable MIDI range; detected notes outside it are moved by octaves. */
  range: [lowest: number, highest: number];
  /** Maximum simultaneous notes; the quietest extra notes are dropped. */
  maxPolyphony: number;
  /** Frequency window handed to Basic Pitch; notes outside it are ignored. */
  minHz: number;
  maxHz: number;
  /** alphaTex instrument name (General MIDI program used for playback). */
  alphaTexInstrument: string;
  midiProgram: number;
  /** Accent color used by the UI. */
  color: string;
  tunings: Tuning[];
}

const NO_TUNING: Tuning[] = [{ id: 'standard', name: 'Standard', strings: [] }];

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: {
    id: 'guitar',
    name: 'Guitar',
    notation: 'tab',
    frets: 22,
    range: [38, 86],
    maxPolyphony: 6,
    minHz: 70,
    maxHz: 1400,
    alphaTexInstrument: 'acousticguitarsteel',
    midiProgram: 25,
    color: '#2ee05a',
    tunings: [
      { id: 'standard', name: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
      { id: 'drop-d', name: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64] },
      { id: 'half-down', name: 'Half step down (E♭ A♭ D♭ G♭ B♭ E♭)', strings: [39, 44, 49, 54, 58, 63] },
      { id: 'd-standard', name: 'D standard (D G C F A D)', strings: [38, 43, 48, 53, 57, 62] },
      { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
      { id: 'open-g', name: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62] },
    ],
  },
  bass: {
    id: 'bass',
    name: 'Bass',
    notation: 'tab',
    frets: 20,
    range: [23, 63],
    maxPolyphony: 4,
    minHz: 29,
    maxHz: 450,
    alphaTexInstrument: 'electricbassfinger',
    midiProgram: 33,
    color: '#2e9bff',
    tunings: [
      { id: 'standard', name: 'Standard (E A D G)', strings: [28, 33, 38, 43] },
      { id: 'drop-d', name: 'Drop D (D A D G)', strings: [26, 33, 38, 43] },
      { id: 'half-down', name: 'Half step down (E♭ A♭ D♭ G♭)', strings: [27, 32, 37, 42] },
      { id: 'five-string', name: '5-string (B E A D G)', strings: [23, 28, 33, 38, 43] },
    ],
  },
  piano: {
    id: 'piano',
    name: 'Piano',
    notation: 'grand',
    frets: 0,
    range: [21, 108],
    maxPolyphony: 10,
    minHz: 27,
    maxHz: 4200,
    alphaTexInstrument: 'acousticgrandpiano',
    midiProgram: 0,
    color: '#ffd600',
    tunings: NO_TUNING,
  },
  violin: {
    id: 'violin',
    name: 'Violin',
    notation: 'treble',
    frets: 0,
    range: [55, 100],
    // Double stops at most.
    maxPolyphony: 2,
    minHz: 185,
    maxHz: 3600,
    alphaTexInstrument: 'violin',
    midiProgram: 40,
    color: '#ff3355',
    tunings: [{ id: 'standard', name: 'Standard (G D A E)', strings: [55, 62, 69, 76] }],
  },
  accordion: {
    id: 'accordion',
    name: 'Accordion',
    notation: 'grand',
    frets: 0,
    range: [28, 96],
    maxPolyphony: 8,
    minHz: 40,
    maxHz: 2100,
    alphaTexInstrument: 'accordion',
    midiProgram: 21,
    color: '#ff8a1f',
    tunings: NO_TUNING,
  },
};

/** Highest capo position offered and detected. */
export const MAX_CAPO = 9;

export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INSTRUMENTS, value);
}

export function getTuning(instrument: InstrumentId, tuningId: string): Tuning {
  const { tunings } = INSTRUMENTS[instrument];
  return tunings.find((t) => t.id === tuningId) ?? tunings[0];
}
