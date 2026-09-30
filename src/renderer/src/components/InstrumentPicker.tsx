import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { INSTRUMENTS, type InstrumentId } from '../../../shared/instruments';
import InstrumentIcon from './InstrumentIcon';

interface InstrumentPickerProps {
  value: InstrumentId;
  onChange: (instrument: InstrumentId) => void;
  disabled?: boolean;
}

/** Big instrument cards; the selected one glows in the instrument's color. */
const InstrumentPicker = ({ value, onChange, disabled }: InstrumentPickerProps) => (
  <div role="radiogroup" aria-label="Instrument" className="grid grid-cols-3 gap-3">
    {Object.values(INSTRUMENTS).map((instrument) => {
      const selected = instrument.id === value;
      return (
        <button
          key={instrument.id}
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={() => onChange(instrument.id)}
          style={{ '--instrument': instrument.color, '--glow': `${instrument.color}66` } as CSSProperties}
          className={cn(
            'group relative flex flex-col items-center gap-2 rounded-2xl border bg-card/70 px-2 py-4 transition-all duration-200',
            'hover:-translate-y-0.5 hover:border-[color:var(--instrument)] disabled:pointer-events-none disabled:opacity-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--instrument)]',
            selected && 'border-[color:var(--instrument)] bg-[color-mix(in_srgb,var(--instrument)_12%,transparent)] animate-glow-pulse',
          )}
        >
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-110',
              selected ? 'bg-[color:var(--instrument)] text-black' : 'bg-secondary text-[color:var(--instrument)]',
            )}
          >
            <InstrumentIcon instrument={instrument.id} className="h-6 w-6" />
          </span>
          <span className={cn('text-sm font-medium', selected ? 'text-foreground' : 'text-muted-foreground')}>{instrument.name}</span>
        </button>
      );
    })}
  </div>
);

export default InstrumentPicker;
