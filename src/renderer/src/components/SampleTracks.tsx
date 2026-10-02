import type { CSSProperties } from 'react';
import { Layers, Play } from 'lucide-react';
import InstrumentIcon from '@/components/InstrumentIcon';
import { Button } from '@/components/ui/button';
import { INSTRUMENTS } from '../../../shared/instruments';
import { SAMPLES, type Sample } from '../../../shared/samples';

interface SampleTracksProps {
  onTry: (sample: Sample) => void;
  disabled?: boolean;
}

/** Famous public-domain pieces bundled with the app, to try TaBello without a recording of your own. */
const SampleTracks = ({ onTry, disabled }: SampleTracksProps) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {SAMPLES.map((sample) => {
      const instrument = INSTRUMENTS[sample.instrument];
      return (
        <div
          key={sample.id}
          className="flex gap-3 rounded-2xl border bg-card/60 p-4"
          style={{ '--instrument': instrument.color } as CSSProperties}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--instrument)_18%,transparent)] text-[color:var(--instrument)]">
            <InstrumentIcon instrument={instrument.id} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{sample.title}</p>
            <p className="text-xs text-muted-foreground">{sample.composer}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {sample.band && <Layers className="mr-1 inline h-3.5 w-3.5 text-gh-yellow" />}
              {sample.description}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-center rounded-full"
            disabled={disabled}
            onClick={() => onTry(sample)}
            aria-label={`Try ${sample.title}`}
          >
            <Play className="h-3.5 w-3.5 mr-1" /> Try
          </Button>
        </div>
      );
    })}
  </div>
);

export default SampleTracks;
