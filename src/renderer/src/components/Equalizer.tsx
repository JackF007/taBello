import { cn } from '@/lib/utils';

const BARS = ['var(--gh-green)', 'var(--gh-red)', 'var(--gh-yellow)', 'var(--gh-blue)', 'var(--gh-orange)'];

/** Small animated equalizer in the five fret colors. */
const Equalizer = ({ active = true, className }: { active?: boolean; className?: string }) => (
  <span className={cn('inline-flex items-end gap-[3px] h-4', !active && 'eq-paused', className)} aria-hidden="true">
    {BARS.map((color, i) => (
      <span
        key={color}
        className="eq-bar w-[3px] h-full rounded-full"
        style={{ background: color, animationDelay: `${-i * 0.17}s`, animationDuration: `${0.7 + (i % 3) * 0.2}s` }}
      />
    ))}
  </span>
);

export default Equalizer;
