// The stages of a transcription, for progress bars: what each one is called and how long it takes.
import type { TranscriptionProgress, TranscriptionStage } from '../../../shared/ipc';

export interface Stage {
  stage: TranscriptionStage;
  label: string;
  weight: number;
  color: string;
}

export const STAGES: Stage[] = [
  { stage: 'starting', label: 'Starting', weight: 0.02, color: 'var(--gh-green)' },
  { stage: 'extracting', label: 'Extracting audio', weight: 0.18, color: 'var(--gh-red)' },
  { stage: 'transcribing', label: 'Detecting notes', weight: 0.75, color: 'var(--gh-yellow)' },
  { stage: 'saving', label: 'Saving', weight: 0.05, color: 'var(--gh-blue)' },
];

// With source separation, isolating the instrument takes most of the time.
export const ISOLATE_STAGES: Stage[] = [
  { stage: 'starting', label: 'Starting', weight: 0.02, color: 'var(--gh-green)' },
  { stage: 'extracting', label: 'Extracting audio', weight: 0.05, color: 'var(--gh-red)' },
  { stage: 'separating', label: 'Isolating instrument', weight: 0.7, color: 'var(--gh-orange)' },
  { stage: 'transcribing', label: 'Detecting notes', weight: 0.2, color: 'var(--gh-yellow)' },
  { stage: 'saving', label: 'Saving', weight: 0.03, color: 'var(--gh-blue)' },
];

/** Maps per-stage progress onto a single 0–100 bar. */
export function overallPercent(stages: Stage[], { stage, fraction }: TranscriptionProgress): number {
  let done = 0;
  for (const s of stages) {
    if (s.stage === stage) return Math.round((done + s.weight * fraction) * 100);
    done += s.weight;
  }
  return 100;
}
