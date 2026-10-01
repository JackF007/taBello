// Instrument presets, shared by the transcription worker (frequency range)
// and the renderer (fingering, notation, colors). Every instrument is fretted and written as tablature.

export type InstrumentId = 'guitar' | 'bass' | 'ukulele';

export interface Tuning {
  id: string;
  name: string;
  /**
   * Open-string MIDI pitches in physical order, from the string nearest your face to the one nearest
   * the floor (6th → 1st on a guitar). Usually ascending, but not always: the ukulele's re-entrant
   * G string is higher than the C next to it.
   */
  strings: number[];
  /** Considered by automatic tuning detection (default true); special tunings are only chosen by hand. */
  autoDetect?: boolean;
}

export interface Instrument {
  id: InstrumentId;
  name: string;
  frets: number;
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

export const INSTRUMENTS: Record<InstrumentId, Instrument> = {
  guitar: {
    id: 'guitar',
    name: 'Guitar',
    frets: 22,
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
      { id: 'dadgad', name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62], autoDetect: false },
      { id: 'open-g', name: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62], autoDetect: false },
    ],
  },
  bass: {
    id: 'bass',
    name: 'Bass',
    frets: 20,
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
  ukulele: {
    id: 'ukulele',
    name: 'Ukulele',
    frets: 15,
    minHz: 140,
    maxHz: 1400,
    // General MIDI has no ukulele; the nylon-string guitar is the closest sound.
    alphaTexInstrument: 'acousticguitarnylon',
    midiProgram: 24,
    color: '#ffd600',
    tunings: [
      { id: 'standard', name: 'Standard, high G (G C E A)', strings: [67, 60, 64, 69] },
      { id: 'low-g', name: 'Low G (G C E A)', strings: [55, 60, 64, 69] },
      { id: 'd-tuning', name: 'D tuning (A D F♯ B)', strings: [69, 62, 66, 71], autoDetect: false },
      { id: 'baritone', name: 'Baritone (D G B E)', strings: [50, 55, 59, 64], autoDetect: false },
    ],
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
