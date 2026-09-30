import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const LANES = ['var(--gh-green)', 'var(--gh-red)', 'var(--gh-yellow)', 'var(--gh-blue)', 'var(--gh-orange)'];
// Fixed "chart" of gem start times per lane (fractions of the loop), so every render looks the same.
const CHART = [
  [0, 0.45],
  [0.2, 0.7],
  [0.35, 0.85],
  [0.1, 0.6],
  [0.5, 0.95],
];

interface NoteHighwayProps {
  /** `fast` while the app is working, `idle` as decoration. */
  speed?: 'idle' | 'fast';
  className?: string;
}

/** A Guitar Hero-style fretboard with gems scrolling towards the strike line. Decorative only. */
const NoteHighway = ({ speed = 'idle', className }: NoteHighwayProps) => {
  const duration = speed === 'fast' ? 1.1 : 2.6;
  return (
    <div className={cn('highway-scene flex flex-col', className)} aria-hidden="true">
      <div className="highway flex flex-1" style={{ '--highway-speed': `${duration * 0.6}s` } as CSSProperties}>
        {LANES.map((color, lane) => (
          <div key={color} className="highway-lane">
            {CHART[lane].map((start) => (
              <span
                key={start}
                className="highway-gem"
                style={{ '--gem-color': color, '--gem-duration': `${duration}s`, '--gem-delay': `${-start * duration}s` } as CSSProperties}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-around px-[3%] -mt-3 relative">
        {LANES.map((color, lane) => (
          <span
            key={color}
            className="strike-target block w-[13%] aspect-square rounded-full"
            style={{ '--gem-color': color, '--gem-duration': `${duration}s`, '--gem-delay': `${-CHART[lane][0] * duration}s` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
};

export default NoteHighway;
