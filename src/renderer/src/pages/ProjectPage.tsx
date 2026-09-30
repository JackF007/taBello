import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, Sparkles } from 'lucide-react';
import InstrumentIcon from '@/components/InstrumentIcon';
import ScoreView from '@/components/ScoreView';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { requireApi } from '@/lib/api';
import { formatDate, formatDuration, isVideoFile } from '@/lib/format';
import { arrange, detectCapo } from '@/lib/music/arrange';
import { toAlphaTex, toMidi } from '@/lib/music/export';
import { toGuitarPro } from '@/lib/music/guitarPro';
import { detectKey, estimateTempo } from '@/lib/music/theory';
import { projectMediaUrl, type ExportFormat, type Project, type ProjectSettings } from '../../../shared/ipc';
import { getTuning, INSTRUMENTS, MAX_CAPO, type InstrumentId } from '../../../shared/instruments';

const EXPORTS: { format: ExportFormat; label: string }[] = [
  { format: 'gp', label: 'Guitar Pro 7 (.gp)' },
  { format: 'midi', label: 'MIDI (.mid)' },
  { format: 'alphatex', label: 'alphaTex (.alphatex)' },
];

const clampTempo = (bpm: number) => Math.min(400, Math.max(20, Math.round(bpm * 10) / 10));
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

const Field = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) => (
  <div className="space-y-1.5">
    <Label htmlFor={htmlFor} className="text-xs uppercase tracking-widest text-muted-foreground">
      {label}
    </Label>
    {children}
  </div>
);

const ProjectEditor = ({ project }: { project: Project }) => {
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveTimer = useRef<number>();

  const detectedTempo = useMemo(() => estimateTempo(project.notes), [project.notes]);
  const key = useMemo(() => detectKey(project.notes), [project.notes]);
  const instrument = INSTRUMENTS[settings.instrument];
  const tuning = getTuning(settings.instrument, settings.tuningId);
  const bpm = settings.tempo ?? detectedTempo.bpm;
  const timing = useMemo(() => ({ bpm, offset: detectedTempo.offset }), [bpm, detectedTempo.offset]);
  const [tempoText, setTempoText] = useState(String(bpm));
  useEffect(() => setTempoText(String(bpm)), [bpm]);

  const detectedCapo = useMemo(
    () => detectCapo(project.notes, { tuning: tuning.strings, frets: instrument.frets, ...timing }, MAX_CAPO),
    [project.notes, tuning, instrument, timing],
  );
  const capo = settings.capo ?? detectedCapo;

  const arrangement = useMemo(
    () => arrange(project.notes, { tuning: tuning.strings, frets: instrument.frets, ...timing, capo }),
    [project.notes, instrument, tuning, timing, capo],
  );
  const tex = useMemo(
    () => toAlphaTex(arrangement, { title: project.title, bpm, key, instrument, tuning: tuning.strings, capo }),
    [arrangement, project.title, bpm, key, instrument, tuning, capo],
  );

  // Settings apply instantly; saving to disk is debounced.
  const updateSettings = (next: ProjectSettings) => {
    setSettings(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const result = await requireApi().updateProjectSettings(project.id, next);
      if (result.ok) void queryClient.invalidateQueries({ queryKey: ['projects'] });
      else toast({ title: 'Could not save settings', description: result.error.message, variant: 'destructive' });
    }, 400);
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const commitTempo = () => {
    const value = Number(tempoText);
    if (Number.isFinite(value) && value > 0) updateSettings({ ...settings, tempo: clampTempo(value) });
    else setTempoText(String(bpm));
  };

  const exportAs = async (format: ExportFormat) => {
    try {
      const data =
        format === 'midi' ? toMidi(project.notes, { title: project.title, bpm, instrument })
        : format === 'gp' ? toGuitarPro(tex)
        : new TextEncoder().encode(tex);
      const result = await requireApi().exportFile({ format, suggestedName: project.title, data });
      if (!result.ok) throw new Error(result.error.message);
      if (result.value) toast({ title: 'Exported', description: result.value });
    } catch (e) {
      toast({ title: 'Export failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const mediaUrl = projectMediaUrl(project.id);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6" style={{ '--instrument': instrument.color } as CSSProperties}>
      <div className="flex flex-wrap items-start gap-4 animate-rise-in">
        <span className="mt-7 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--instrument)] text-black shadow-[0_0_30px_-4px_var(--instrument)]">
          <InstrumentIcon instrument={instrument.id} className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-1">
            <ArrowLeft className="h-4 w-4 mr-1" /> Library
          </Link>
          <h1 className="text-3xl truncate">{project.title}</h1>
          <p className="text-sm text-muted-foreground">
            {project.sourceName} · {formatDuration(project.durationSeconds)} · {project.noteCount} notes · {formatDate(project.createdAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="btn-fire mt-7 h-11 rounded-full px-6">
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {EXPORTS.map(({ format, label }) => (
              <DropdownMenuItem key={format} onSelect={() => void exportAs(format)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="panel flex flex-wrap items-end gap-6 p-5 animate-rise-in [animation-delay:80ms]">
        <Field label="Instrument" htmlFor="instrument">
          <Select
            value={settings.instrument}
            onValueChange={(value) => {
              const id = value as InstrumentId;
              updateSettings({ ...settings, instrument: id, tuningId: INSTRUMENTS[id].tunings[0].id });
            }}
          >
            <SelectTrigger id="instrument" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(INSTRUMENTS).map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Tuning" htmlFor="tuning">
          <Select value={tuning.id} onValueChange={(tuningId) => updateSettings({ ...settings, tuningId })}>
            <SelectTrigger id="tuning" className="w-[250px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {instrument.tunings.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Capo" htmlFor="capo">
          <Select
            value={settings.capo === null ? 'auto' : String(settings.capo)}
            onValueChange={(value) => updateSettings({ ...settings, capo: value === 'auto' ? null : Number(value) })}
          >
            <SelectTrigger id="capo" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto ({detectedCapo === 0 ? 'none' : `${ordinal(detectedCapo)} fret`})</SelectItem>
              <SelectItem value="0">No capo</SelectItem>
              {Array.from({ length: MAX_CAPO }, (_, i) => i + 1).map((fret) => (
                <SelectItem key={fret} value={String(fret)}>{ordinal(fret)} fret</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Tempo (BPM)" htmlFor="tempo">
          <div className="flex items-center gap-1">
            <Input
              id="tempo"
              className="w-[84px]"
              inputMode="decimal"
              value={tempoText}
              onChange={(e) => setTempoText(e.target.value)}
              onBlur={commitTempo}
              onKeyDown={(e) => e.key === 'Enter' && commitTempo()}
            />
            <Button variant="outline" size="sm" onClick={() => updateSettings({ ...settings, tempo: clampTempo(bpm / 2) })} title="Half tempo">½×</Button>
            <Button variant="outline" size="sm" onClick={() => updateSettings({ ...settings, tempo: clampTempo(bpm * 2) })} title="Double tempo">2×</Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={settings.tempo === null}
              onClick={() => updateSettings({ ...settings, tempo: null })}
              title={`Use the detected tempo (${detectedTempo.bpm} BPM)`}
            >
              Auto
            </Button>
          </div>
        </Field>

        <Field label="Key">
          <p className="h-10 flex items-center font-display text-lg">{key.name}</p>
        </Field>

        {capo > 0 && (
          <span
            className="ml-auto flex items-center gap-1.5 rounded-full border border-gh-yellow/60 bg-gh-yellow/10 px-3 py-1.5 text-sm text-gh-yellow"
            role="status"
          >
            <Sparkles className="h-4 w-4" />
            Capo on the {ordinal(capo)} fret{settings.capo === null && ' (detected)'}
          </span>
        )}
      </div>

      {project.sourceAvailable ? (
        isVideoFile(project.sourceName) ? (
          <video controls src={mediaUrl} className="w-full max-h-72 rounded-2xl bg-black border" aria-label="Original recording" />
        ) : (
          <audio controls src={mediaUrl} className="w-full" aria-label="Original recording" />
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          The original file is no longer at <code>{project.sourcePath}</code>, so it can't be played back.
        </p>
      )}

      <ScoreView tex={tex} />

      <p className="text-xs text-muted-foreground">
        Automatic transcription is a starting point: check it by ear.{' '}
        {arrangement.droppedNotes === 1 && '1 note was left out because it could not be played together with the others on this instrument.'}
        {arrangement.droppedNotes > 1 &&
          `${arrangement.droppedNotes} notes were left out because they could not be played together on this instrument.`}
      </p>
    </div>
  );
};

const ProjectPage = () => {
  const { id = '' } = useParams();
  const { data: project, error, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const result = await requireApi().getProject(id);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading project…
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center">
        <p className="mb-4">{error instanceof Error ? error.message : 'Project not found.'}</p>
        <Button asChild variant="outline"><Link to="/library">Back to library</Link></Button>
      </div>
    );
  }
  // Keyed so switching projects resets the editor state.
  return <ProjectEditor key={project.id} project={project} />;
};

export default ProjectPage;
