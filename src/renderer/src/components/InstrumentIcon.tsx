import { Guitar, Piano } from 'lucide-react';
import type { InstrumentId } from '../../../shared/instruments';

interface IconProps {
  className?: string;
}

// Line icons in the lucide style (24×24, 2px stroke) for instruments lucide does not have.
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Violin = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <path d="M12 2v7" />
    <path d="M10.5 2.5h3" />
    <path d="M9 9c-2 0-3 1.3-3 3 0 1 .6 1.7.6 2.5S5 16 5 18c0 2.2 3 4 7 4s7-1.8 7-4c0-2-1.6-2.7-1.6-3.5s.6-1.5.6-2.5c0-1.7-1-3-3-3" />
    <path d="M9 9h6" />
    <path d="M10 13.5v3M14 13.5v3" />
    <path d="M12 16v4" />
  </svg>
);

const Accordion = ({ className }: IconProps) => (
  <svg {...svgProps} className={className}>
    <rect x="2" y="5" width="5" height="14" rx="1.5" />
    <rect x="17" y="5" width="5" height="14" rx="1.5" />
    <path d="M7 6l2.5 2-2.5 2 2.5 2-2.5 2 2.5 2L7 18" />
    <path d="M17 6l-2.5 2 2.5 2-2.5 2 2.5 2-2.5 2 2.5 2" />
    <path d="M9.5 8h5M9.5 12h5M9.5 16h5" />
  </svg>
);

/** Icon for an instrument; bass reuses the guitar outline, mirrored. */
const InstrumentIcon = ({ instrument, className }: { instrument: InstrumentId; className?: string }) => {
  switch (instrument) {
    case 'guitar':
      return <Guitar className={className} />;
    case 'bass':
      return <Guitar className={className} style={{ transform: 'scaleX(-1)' }} />;
    case 'piano':
      return <Piano className={className} />;
    case 'violin':
      return <Violin className={className} />;
    case 'accordion':
      return <Accordion className={className} />;
  }
};

export default InstrumentIcon;
