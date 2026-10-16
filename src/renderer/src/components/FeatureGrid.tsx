import type { CSSProperties } from 'react';
import {
  AudioWaveform,
  Download,
  Grid3x3,
  Hand,
  Layers,
  Music,
  Pencil,
  Repeat,
  ShieldCheck,
  Sparkles,
  Spline,
  Timer,
  type LucideIcon,
} from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  color: string;
  title: string;
  text: string;
}

/** What TaBello does with a recording, in the order a player meets it. */
const FEATURES: Feature[] = [
  { icon: Music, color: 'var(--gh-green)', title: 'Tab and notation', text: 'Guitar, bass or ukulele: tab and standard notation, bar lines and rhythms included.' },
  { icon: Hand, color: 'var(--gh-red)', title: 'Fingering like a teacher', text: 'Compact hand positions, lead lines in the box, bends pushed by the right finger.' },
  { icon: Sparkles, color: 'var(--gh-yellow)', title: 'Capo and tuning found', text: 'Capo, drop D, half step down, 5-string bass, low-G ukulele: detected for you.' },
  { icon: Grid3x3, color: 'var(--gh-blue)', title: 'Chords and diagrams', text: 'Chord names over the staff and their diagrams at the top, from the harmony heard.' },
  { icon: Spline, color: 'var(--gh-orange)', title: 'Playing techniques', text: 'Bends, slides, hammer-ons, pull-offs and vibrato written as you played them.' },
  { icon: Layers, color: 'var(--gh-purple)', title: 'Melody or accompaniment', text: 'Write the lead alone, or only the part under it: a solo without its backing.' },
  { icon: Timer, color: 'var(--gh-green)', title: 'Metronome aware', text: 'Played to a click? It is taken out, and its beats give the exact tempo and bars.' },
  { icon: AudioWaveform, color: 'var(--gh-red)', title: 'Isolate from a band', text: 'Pull your instrument out of a full mix, offline, before transcribing it.' },
  { icon: Repeat, color: 'var(--gh-yellow)', title: 'Play along', text: 'Follow the score with the original recording; loop a passage and slow it down.' },
  { icon: Pencil, color: 'var(--gh-blue)', title: 'Edit and transpose', text: 'Fix any note in one click; transpose, or keep the same shapes with a capo.' },
  { icon: Download, color: 'var(--gh-orange)', title: 'Guitar Pro and MIDI', text: 'Export to Guitar Pro 7, MIDI or alphaTex and keep working in your tools.' },
  { icon: ShieldCheck, color: 'var(--gh-purple)', title: '100% on your computer', text: 'No account, no upload, no subscription: free software that works offline.' },
];

const FeatureGrid = () => (
  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {FEATURES.map(({ icon: Icon, color, title, text }) => (
      <li
        key={title}
        className="flex gap-3 rounded-xl border bg-secondary/30 p-4 transition-colors hover:border-[color:color-mix(in_srgb,var(--feature)_60%,transparent)] hover:bg-secondary/50"
        style={{ '--feature': color } as CSSProperties}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--feature)_18%,transparent)]">
          <Icon className="h-[18px] w-[18px] text-[color:var(--feature)]" aria-hidden />
        </span>
        <div>
          <h3 className="font-semibold leading-tight">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        </div>
      </li>
    ))}
  </ul>
);

export default FeatureGrid;
