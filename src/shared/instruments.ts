// Instrument and tuning presets, shared by the transcription worker (frequency range)
// and the renderer (fret assignment, alphaTex output).

export type InstrumentId = 'guitar' | 'bass';

export interface Tuning {
  id: string;
  name: string;
  /** Open-string MIDI pitches, lowest string first. */
  strings: number[];
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
    frets: 20,
    minHz: 29,
    maxHz: 450,
    alphaTexInstrument: 'electricbassfinger',
    midiProgram: 33,
    tunings: [
      { id: 'standard', name: 'Standard (E A D G)', strings: [28, 33, 38, 43] },
      { id: 'drop-d', name: 'Drop D (D A D G)', strings: [26, 33, 38, 43] },
      { id: 'half-down', name: 'Half step down (E♭ A♭ D♭ G♭)', strings: [27, 32, 37, 42] },
      { id: 'five-string', name: '5-string (B E A D G)', strings: [23, 28, 33, 38, 43] },
    ],
  },
};

export function isInstrumentId(value: unknown): value is InstrumentId {
  return value === 'guitar' || value === 'bass';
}

export function getTuning(instrument: InstrumentId, tuningId: string): Tuning {
  const { tunings } = INSTRUMENTS[instrument];
  return tunings.find((t) => t.id === tuningId) ?? tunings[0];
}
