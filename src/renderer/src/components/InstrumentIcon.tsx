import { Guitar } from 'lucide-react';
import type { InstrumentId } from '../../../shared/instruments';

/** Ukulele line icon in the lucide style (24×24, 2px stroke): a small figure-eight body and a short neck. */
const Ukulele = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14.5 9.5 20 4" />
    <path d="M18.5 2.5 21.5 5.5" />
    <path d="M9.5 8.5c1.6-1.1 3.8-.8 5 .6 1.3 1.4 1.2 3.4 0 4.6-.6.6-.7 1.3-.3 2.1.9 1.9.3 4-1.5 5.1-2 1.2-4.8.8-6.9-1.2-2-2.1-2.4-4.9-1.2-6.9 1.1-1.8 3.2-2.4 5.1-1.5" />
    <circle cx="10" cy="15" r="1.5" />
  </svg>
);

/** Icon for an instrument; bass reuses the guitar outline, mirrored. */
const InstrumentIcon = ({ instrument, className }: { instrument: InstrumentId; className?: string }) => {
  switch (instrument) {
    case 'guitar':
      return <Guitar className={className} />;
    case 'bass':
      return <Guitar className={className} style={{ transform: 'scaleX(-1)' }} />;
    case 'ukulele':
      return <Ukulele className={className} />;
  }
};

export default InstrumentIcon;
