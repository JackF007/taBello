import { useId } from 'react';

/** A note to light on the neck: string 0 is the lowest (thickest), frets from the nut. */
export interface FretboardNote {
  string: number;
  fret: number;
  /** A note picked now (bright) or one still ringing (dimmer). */
  ringing?: boolean;
  /** The note selected for editing. */
  selected?: boolean;
}

interface FretboardProps {
  /** Open-string names, lowest string first. */
  strings: string[];
  /** Colors by string, lowest first (the tab's). */
  colors: string[];
  capo: number;
  /** Frets drawn after the nut. */
  frets: number;
  notes: FretboardNote[];
}

const WIDTH = 1000;
const NUT = 64;
const RIGHT = 990;
const TOP = 16;
const GAP = 22;
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/**
 * The neck, drawn to scale (each fret 2^(-1/12) shorter than the one before), with the notes being
 * played lit where the fingers go: the same colors as the tab's strings.
 */
const Fretboard = ({ strings, colors, capo, frets, notes }: FretboardProps) => {
  const id = useId().replace(/:/g, '');
  const count = strings.length;
  const height = TOP * 2 + GAP * (count - 1) + 18;
  const wire = (n: number) => NUT + ((RIGHT - NUT) * (1 - 2 ** (-n / 12))) / (1 - 2 ** (-frets / 12));
  // Strings top to bottom as in the tab: the highest first.
  const y = (string: number) => TOP + GAP * (count - 1 - string);
  const between = (n: number) => (wire(n - 1) + wire(n)) / 2;
  const middle = TOP + (GAP * (count - 1)) / 2;
  // A finger presses just behind the fret wire.
  const fingerX = (fret: number) => wire(fret - 1) + (wire(fret) - wire(fret - 1)) * 0.62;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="block w-full select-none"
      role="img"
      aria-label={notes.length ? `Notes on the neck: ${notes.map((n) => `${strings[n.string]} string, ${n.fret ? `fret ${n.fret}` : 'open'}`).join('; ')}` : 'The neck'}
      data-testid="fretboard"
    >
      <defs>
        <linearGradient id={`${id}-wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2140" />
          <stop offset="0.5" stopColor="#1c1630" />
          <stop offset="1" stopColor="#261d3b" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* The board, nut and fret wires. */}
      <rect x={NUT} y={TOP - 9} width={RIGHT - NUT} height={GAP * (count - 1) + 18} rx="4" fill={`url(#${id}-wood)`} />
      {INLAYS.filter((n) => n <= frets).map((n) => (
        <circle key={n} cx={between(n)} cy={middle} r="4.5" fill="#4b4370" opacity="0.8" />
      ))}
      {frets >= 12 && (
        <>
          <circle cx={between(12)} cy={middle - GAP} r="4.5" fill="#4b4370" opacity="0.8" />
          <circle cx={between(12)} cy={middle + GAP} r="4.5" fill="#4b4370" opacity="0.8" />
        </>
      )}
      {Array.from({ length: frets }, (_, i) => i + 1).map((n) => (
        <line key={n} x1={wire(n)} x2={wire(n)} y1={TOP - 9} y2={TOP + GAP * (count - 1) + 9} stroke="#8d8aad" strokeWidth="2" opacity="0.7" />
      ))}
      <rect x={NUT - 5} y={TOP - 10} width="7" height={GAP * (count - 1) + 20} rx="2" fill="#ece6d6" />
      {[3, 5, 7, 9, 12, 15, 17].filter((n) => n <= frets).map((n) => (
        <text key={n} x={between(n)} y={height - 3} textAnchor="middle" fontSize="11" fill="#7e7aa3">
          {n}
        </text>
      ))}

      {/* Strings: the low ones thicker. */}
      {strings.map((name, s) => (
        <g key={s}>
          <text x={NUT - 22} y={y(s) + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={colors[s % colors.length]}>
            {name}
          </text>
          <line x1={NUT} x2={RIGHT} y1={y(s)} y2={y(s)} stroke="#d6d4e8" strokeWidth={0.8 + s * 0.38} opacity="0.75" />
        </g>
      ))}

      {capo > 0 && capo <= frets && (
        <g>
          <rect x={wire(capo) - 9} y={TOP - 13} width="10" height={GAP * (count - 1) + 26} rx="4" fill="#0b0a14" stroke="#5d5a8f" />
          <text x={wire(capo) - 4} y={TOP - 16} textAnchor="middle" fontSize="10" fill="#a3a3c2">
            capo
          </text>
        </g>
      )}

      {/* The notes. */}
      {notes.map((note) => {
        const color = colors[note.string % colors.length];
        const open = note.fret === capo;
        const cx = open ? (capo > 0 ? wire(capo) + 10 : NUT - 42) : fingerX(note.fret);
        const cy = y(note.string);
        return (
          <g
            key={`${note.string}-${note.fret}-${note.ringing ? 'r' : 'p'}`}
            className={note.ringing ? 'fret-note-ringing' : 'fret-note'}
            style={{ transformOrigin: `${cx}px ${cy}px` }}
          >
            {open ? (
              <circle cx={cx} cy={cy} r="8" fill="none" stroke={color} strokeWidth="3" filter={`url(#${id}-glow)`} />
            ) : (
              <>
                <circle cx={cx} cy={cy} r="10.5" fill={color} filter={`url(#${id}-glow)`} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0d0c1b">
                  {note.fret - capo}
                </text>
              </>
            )}
            {note.selected && <circle cx={cx} cy={cy} r="15" fill="none" stroke="#ffd600" strokeWidth="2.5" />}
          </g>
        );
      })}
    </svg>
  );
};

export default Fretboard;
