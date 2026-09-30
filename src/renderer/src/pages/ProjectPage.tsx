import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
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
import { arrange } from '@/lib/music/arrange';
import { toAlphaTex, toMidi } from '@/lib/music/export';
import { toGuitarPro } from '@/lib/music/guitarPro';
import { detectKey, estimateTempo } from '@/lib/music/theory';
import { projectMediaUrl, type ExportFormat, type Project, type ProjectSettings } from '../../../shared/ipc';
import { getTuning, INSTRUMENTS, type InstrumentId } from '../../../shared/instruments';

const EXPORTS: { format: ExportFormat; label: string }[] = [
  { format: 'gp', label: 'Guitar Pro 7 (.gp)' },
  { format: 'midi', label: 'MIDI (.mid)' },
  { format: 'alphatex', label: 'alphaTex (.alphatex)' },
];

const clampTempo = (bpm: number) => Math.min(400, Math.max(20, Math.round(bpm * 10) / 10));

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
  const [tempoText, setTempoText] = useState(String(bpm));
  useEffect(() => setTempoText(String(bpm)), [bpm]);

  const arrangement = useMemo(
    () => arrange(project.notes, { tuning: tuning.strings, frets: instrument.frets, bpm, offset: detectedTempo.offset }),
    [project.notes, tuning, instrument, bpm, detectedTempo.offset],
  );
  const tex = useMemo(
    () => toAlphaTex(arrangement, { title: project.title, bpm, key, instrument, tuning: tuning.strings }),
    [arrangement, project.title, bpm, key, instrument, tuning],
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
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Library
          </Link>
          <h1 className="text-2xl font-bold truncate">{project.title}</h1>
          <p className="text-sm text-muted-foreground">
            {project.sourceName} · {formatDuration(project.durationSeconds)} · {project.noteCount} notes · {formatDate(project.createdAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
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

      <div className="flex flex-wrap items-end gap-6 rounded-xl border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="instrument">Instrument</Label>
          <Select
            value={settings.instrument}
            onValueChange={(value) => {
              const id = value as InstrumentId;
              updateSettings({ ...settings, instrument: id, tuningId: INSTRUMENTS[id].tunings[0].id });
            }}
          >
            <SelectTrigger id="instrument" className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(INSTRUMENTS).map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tuning">Tuning</Label>
          <Select value={tuning.id} onValueChange={(tuningId) => updateSettings({ ...settings, tuningId })}>
            <SelectTrigger id="tuning" className="w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {instrument.tunings.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tempo">Tempo (BPM)</Label>
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
        </div>

        <div className="space-y-1.5">
          <Label>Key</Label>
          <p className="h-10 flex items-center text-sm font-medium">{key.name}</p>
        </div>
      </div>

      {project.sourceAvailable ? (
        isVideoFile(project.sourceName) ? (
          <video controls src={mediaUrl} className="w-full max-h-72 rounded-xl bg-black" aria-label="Original recording" />
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
        Automatic transcription is a starting point: check it by ear. {arrangement.droppedNotes > 0 &&
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
