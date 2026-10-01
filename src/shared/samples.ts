// Sample recordings shipped with TaBello, so anyone can try it straight away. All are famous
// public-domain pieces, rendered by TaBello's own string synthesizer (scripts/generate-samples.ts).
import type { InstrumentId } from './instruments';

export interface Sample {
  id: string;
  title: string;
  composer: string;
  instrument: InstrumentId;
  /** File name in the samples folder. */
  file: string;
  description: string;
  /** A band mix: isolating the instrument (source separation) gives a much cleaner tab. */
  band?: boolean;
}

export const SAMPLES: Sample[] = [
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditional (16th century)',
    instrument: 'guitar',
    file: 'greensleeves.ogg',
    description: 'Fingerpicked melody and bass in 3/4.',
  },
  {
    id: 'romance',
    title: 'Romance (Spanish Romance)',
    composer: 'Anonymous (19th century)',
    instrument: 'guitar',
    file: 'romance.ogg',
    description: 'Triplet arpeggios in 3/4, with the melody on the top string.',
  },
  {
    id: 'minuet',
    title: 'Minuet in G',
    composer: 'Christian Petzold (attr. J. S. Bach), 1725',
    instrument: 'guitar',
    file: 'minuet-in-g.ogg',
    description: 'A classical melody that gently speeds up — try the tempo changes.',
  },
  {
    id: 'blues-lick',
    title: 'Blues lick in A',
    composer: 'Written for TaBello',
    instrument: 'guitar',
    file: 'blues-lick.ogg',
    description: 'Bends, hammer-ons, pull-offs, a slide and vibrato.',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'Ludwig van Beethoven, 1824',
    instrument: 'ukulele',
    file: 'ode-to-joy.ogg',
    description: 'Melody with strummed chords on ukulele.',
  },
  {
    id: 'saints',
    title: 'When the Saints Go Marching In',
    composer: 'Traditional',
    instrument: 'bass',
    file: 'saints-band.ogg',
    description: 'A full band (drums, bass, guitar, lead). Transcribe the bass with "Isolate" on.',
    band: true,
  },
];

export function getSample(id: unknown): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
