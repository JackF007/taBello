import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AudioWaveform, FileAudio, Music, ShieldCheck } from 'lucide-react';
import InstrumentPicker from '@/components/InstrumentPicker';
import IsolateControl from '@/components/IsolateControl';
import SampleTracks from '@/components/SampleTracks';
import NoteHighway from '@/components/NoteHighway';
import UploadSection from '@/components/UploadSection';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { requireApi, tabello } from '@/lib/api';
import { useSeparationModel } from '@/lib/separationModel';
import { cn } from '@/lib/utils';
import type { IpcResult, ProjectSummary, Sensitivity, TranscriptionProgress, TranscriptionStage } from '../../../shared/ipc';
import { INSTRUMENTS, type InstrumentId } from '../../../shared/instruments';
import type { Sample } from '../../../shared/samples';

interface Stage {
  stage: TranscriptionStage;
  label: string;
  weight: number;
  color: string;
}

const STAGES: Stage[] = [
  { stage: 'starting', label: 'Starting', weight: 0.02, color: 'var(--gh-green)' },
  { stage: 'extracting', label: 'Extracting audio', weight: 0.18, color: 'var(--gh-red)' },
  { stage: 'transcribing', label: 'Detecting notes', weight: 0.75, color: 'var(--gh-yellow)' },
  { stage: 'saving', label: 'Saving', weight: 0.05, color: 'var(--gh-blue)' },
];

// With source separation, isolating the instrument takes most of the time.
const ISOLATE_STAGES: Stage[] = [
  { stage: 'starting', label: 'Starting', weight: 0.02, color: 'var(--gh-green)' },
  { stage: 'extracting', label: 'Extracting audio', weight: 0.05, color: 'var(--gh-red)' },
  { stage: 'separating', label: 'Isolating instrument', weight: 0.7, color: 'var(--gh-orange)' },
  { stage: 'transcribing', label: 'Detecting notes', weight: 0.2, color: 'var(--gh-yellow)' },
  { stage: 'saving', label: 'Saving', weight: 0.03, color: 'var(--gh-blue)' },
];

/** Maps per-stage progress onto a single 0–100 bar. */
function overallPercent(stages: Stage[], { stage, fraction }: TranscriptionProgress): number {
  let done = 0;
  for (const s of stages) {
    if (s.stage === stage) return Math.round((done + s.weight * fraction) * 100);
    done += s.weight;
  }
  return 100;
}

const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: 'Strict',
  normal: 'Balanced',
  high: 'Sensitive',
};

const STEPS = [
  { icon: FileAudio, color: 'var(--gh-green)', title: 'Open a recording', text: 'Any audio or video file: a lesson, a live video, a demo you recorded.' },
  { icon: AudioWaveform, color: 'var(--gh-yellow)', title: 'Local AI transcription', text: "Spotify's Basic Pitch model detects the notes on your own computer." },
  { icon: Music, color: 'var(--gh-blue)', title: 'Read, play, export', text: 'Tabs you can play along with and export to Guitar Pro or MIDI.' },
];

const TranscribePage = () => {
  const [instrument, setInstrument] = useState<InstrumentId>('guitar');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal');
  const [isolate, setIsolate] = useState(false);
  const [source, setSource] = useState<{ name: string; isolate: boolean } | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const { data: model } = useSeparationModel();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => tabello?.onTranscriptionProgress(setProgress), []);

  const run = async (name: string, withIsolation: boolean, transcribe: () => Promise<IpcResult<ProjectSummary>>) => {
    setSource({ name, isolate: withIsolation });
    setError(null);
    setProgress({ stage: 'starting', fraction: 0 });
    try {
      const result = await transcribe();
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        navigate(`/project/${result.value.id}`);
      } else if (result.error.code === 'cancelled') {
        toast({ title: 'Transcription cancelled' });
      } else {
        setError(result.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const useIsolation = isolate && !!model?.installed;
  const start = (selected: File) =>
    run(selected.name, useIsolation, () => requireApi().transcribe(selected, { instrument, sensitivity, isolate: useIsolation }));

  // Samples are transcribed for their instrument; band mixes are isolated when the model is there.
  const trySample = (sample: Sample) => {
    const withIsolation = sample.band ? !!model?.installed : useIsolation;
    setInstrument(sample.instrument);
    void run(sample.title, withIsolation, () =>
      requireApi().transcribeSample(sample.id, { instrument: sample.instrument, sensitivity, isolate: withIsolation }),
    );
  };

  const busy = progress !== null;
  const stages = source?.isolate ? ISOLATE_STAGES : STAGES;
  const currentStage = stages.findIndex((s) => s.stage === progress?.stage);
  const percent = progress ? overallPercent(stages, progress) : 0;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] mb-10">
        <div className="animate-rise-in">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1 text-xs font-semibold text-muted-foreground mb-5">
            <ShieldCheck className="h-3.5 w-3.5 text-gh-green" /> 100% offline · open source
          </span>
          <h1 className="text-5xl leading-[1.05] mb-5">
            Turn any recording
            <br />
            into <span className="text-fire">tabs &amp; sheet music</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg">
            Guitar, bass or ukulele: TaBello listens and writes the tab, capo included, entirely on your computer. Nothing is
            uploaded.
          </p>
        </div>
        <NoteHighway speed={busy ? 'fast' : 'idle'} className="h-64 mx-auto w-full max-w-md" />
      </section>

      <section className="panel p-6 space-y-6 animate-rise-in [animation-delay:120ms]">
        <div>
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">1 · Pick your instrument</h2>
          <InstrumentPicker value={instrument} onChange={setInstrument} disabled={busy} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm uppercase tracking-widest text-muted-foreground">Sensitivity</span>
          <ToggleGroup
            type="single"
            value={sensitivity}
            onValueChange={(value) => value && setSensitivity(value as Sensitivity)}
            disabled={busy}
            className="rounded-full bg-secondary p-1"
            title="Sensitive picks up quiet notes in soft or distant recordings; Strict ignores more noise."
          >
            {(Object.keys(SENSITIVITY_LABELS) as Sensitivity[]).map((s) => (
              <ToggleGroupItem
                key={s}
                value={s}
                className="h-8 rounded-full px-4 data-[state=on]:bg-background data-[state=on]:text-foreground"
              >
                {SENSITIVITY_LABELS[s]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <IsolateControl
          instrumentName={INSTRUMENTS[instrument].name.toLowerCase()}
          checked={isolate}
          onCheckedChange={setIsolate}
          disabled={busy}
        />

        <div>
          <h2 className="text-sm uppercase tracking-widest text-muted-foreground mb-3">2 · Drop your {INSTRUMENTS[instrument].name.toLowerCase()} recording</h2>
          {busy ? (
            <div className="rounded-2xl border bg-background/60 p-6" aria-live="polite">
              <div className="flex items-center gap-4 mb-5">
                <div className="min-w-0">
                  <p className="font-medium truncate">{source?.name}</p>
                  <p className="text-sm text-muted-foreground">{stages[currentStage]?.label}…</p>
                </div>
                <span className="ml-auto font-display text-3xl tabular-nums text-fire">{percent}%</span>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => requireApi().cancelTranscription()}>
                  Cancel
                </Button>
              </div>
              <div
                className="h-3 w-full overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-label="Transcription progress"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full gh-rainbow transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }}>
                  <div className="h-full w-full progress-stripes" />
                </div>
              </div>
              <ol className={cn('mt-4 grid gap-2 text-xs', stages.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
                {stages.map((s, i) => (
                  <li
                    key={s.stage}
                    style={{ '--stage': s.color } as CSSProperties}
                    className={cn(
                      'flex items-center gap-1.5',
                      i < currentStage ? 'text-foreground' : i === currentStage ? 'text-[color:var(--stage)] font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn('h-2 w-2 rounded-full', i <= currentStage ? 'bg-[color:var(--stage)]' : 'bg-secondary', i === currentStage && 'animate-pulse')}
                    />
                    {s.label}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <UploadSection onFileSelected={start} />
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">Could not transcribe {source?.name}</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
          </div>
        )}
      </section>

      <section className="panel p-6 mt-10 animate-rise-in [animation-delay:200ms]" aria-labelledby="samples-heading">
        <h2 id="samples-heading" className="text-sm uppercase tracking-widest text-muted-foreground mb-1">
          No recording at hand? Try a sample
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Famous public-domain pieces, played by TaBello's own synthesizer.
        </p>
        <SampleTracks onTry={trySample} disabled={busy} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
        {STEPS.map(({ icon: Icon, color, title, text }, i) => (
          <div
            key={title}
            className="panel p-5 animate-rise-in"
            style={{ animationDelay: `${240 + i * 90}ms`, '--step': color } as CSSProperties}
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3 bg-[color-mix(in_srgb,var(--step)_18%,transparent)]">
              <Icon className="h-5 w-5 text-[color:var(--step)]" />
            </div>
            <h3 className="font-semibold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
};

export default TranscribePage;
