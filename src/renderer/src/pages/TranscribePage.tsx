import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AudioWaveform, FileAudio, Guitar, Loader2, Music, ShieldCheck } from 'lucide-react';
import UploadSection from '@/components/UploadSection';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/hooks/use-toast';
import { requireApi, tabello } from '@/lib/api';
import type { Sensitivity, TranscriptionProgress, TranscriptionStage } from '../../../shared/ipc';
import { INSTRUMENTS, type InstrumentId } from '../../../shared/instruments';

const STAGES: { stage: TranscriptionStage; label: string; weight: number }[] = [
  { stage: 'starting', label: 'Starting', weight: 0.02 },
  { stage: 'extracting', label: 'Extracting audio', weight: 0.18 },
  { stage: 'transcribing', label: 'Detecting notes', weight: 0.75 },
  { stage: 'saving', label: 'Saving', weight: 0.05 },
];

/** Maps per-stage progress onto a single 0–100 bar. */
function overallPercent({ stage, fraction }: TranscriptionProgress): number {
  let done = 0;
  for (const s of STAGES) {
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
  { icon: FileAudio, title: 'Open a recording', text: 'Any audio or video file: a lesson, a live video, a demo you recorded.' },
  { icon: AudioWaveform, title: 'Local AI transcription', text: "Spotify's Basic Pitch model detects the notes on your own computer." },
  { icon: Music, title: 'Read, play, export', text: 'Notation and tabs you can play back and export to MIDI or Guitar Pro.' },
];

const TranscribePage = () => {
  const [instrument, setInstrument] = useState<InstrumentId>('guitar');
  const [sensitivity, setSensitivity] = useState<Sensitivity>('normal');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => tabello?.onTranscriptionProgress(setProgress), []);

  const start = async (selected: File) => {
    setFile(selected);
    setError(null);
    setProgress({ stage: 'starting', fraction: 0 });
    try {
      const result = await requireApi().transcribe(selected, { instrument, sensitivity });
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

  const busy = progress !== null;
  const stageLabel = STAGES.find((s) => s.stage === progress?.stage)?.label;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold bg-tabello-100 text-tabello-800 rounded-full mb-5">
          <ShieldCheck className="h-3.5 w-3.5" /> 100% offline · open source
        </span>
        <h1 className="text-4xl font-bold leading-tight mb-4">
          Turn recordings into <span className="text-tabello-700">tablature</span>
        </h1>
        <p className="text-lg text-muted-foreground">
          TaBello transcribes guitar and bass entirely on your computer. Nothing is uploaded.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Instrument</span>
          <ToggleGroup
            type="single"
            value={instrument}
            onValueChange={(value) => value && setInstrument(value as InstrumentId)}
            disabled={busy}
          >
            {Object.values(INSTRUMENTS).map((i) => (
              <ToggleGroupItem key={i.id} value={i.id} aria-label={i.name} className="gap-1.5 px-4">
                <Guitar className="h-4 w-4" /> {i.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="sensitivity" className="text-sm font-medium">Sensitivity</label>
          <Select value={sensitivity} onValueChange={(value) => setSensitivity(value as Sensitivity)} disabled={busy}>
            <SelectTrigger
              id="sensitivity"
              className="w-[140px]"
              title="Sensitive picks up quiet notes in soft or distant recordings; Strict ignores more noise."
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SENSITIVITY_LABELS) as Sensitivity[]).map((s) => (
                <SelectItem key={s} value={s}>{SENSITIVITY_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {busy ? (
        <div className="rounded-xl border bg-card p-8 shadow-sm" aria-live="polite">
          <div className="flex items-center gap-3 mb-4">
            <Loader2 className="h-5 w-5 animate-spin text-tabello-600" />
            <div className="min-w-0">
              <p className="font-medium truncate">{file?.name}</p>
              <p className="text-sm text-muted-foreground">{stageLabel}…</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => requireApi().cancelTranscription()}>
              Cancel
            </Button>
          </div>
          <Progress value={overallPercent(progress)} aria-label="Transcription progress" />
          <ol className="mt-4 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
            {STAGES.map((s, i) => {
              const current = STAGES.findIndex((x) => x.stage === progress.stage);
              return (
                <li key={s.stage} className={i < current ? 'text-foreground' : i === current ? 'text-tabello-700 font-medium' : ''}>
                  {s.label}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <UploadSection onFileSelected={start} />
      )}

      {error && (
        <div role="alert" className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Could not transcribe {file?.name}</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-14">
        {STEPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border bg-card p-5">
            <div className="w-10 h-10 bg-tabello-100 rounded-full flex items-center justify-center mb-3">
              <Icon className="h-5 w-5 text-tabello-700" />
            </div>
            <h3 className="font-medium mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TranscribePage;
