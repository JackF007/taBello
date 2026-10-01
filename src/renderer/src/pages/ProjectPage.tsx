import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, Pencil, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react';
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
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/hooks/use-toast';
import { requireApi } from '@/lib/api';
import { formatDate, formatDuration, isVideoFile } from '@/lib/format';
import { arrange, detectCapo, detectTuning } from '@/lib/music/arrange';
import { applyEdit, findNote, type NoteEdit, type NoteLocation } from '@/lib/music/edit';
import { toAlphaTex, toMidi } from '@/lib/music/export';
import { toGuitarPro } from '@/lib/music/guitarPro';
import { alphaTexPitch, detectKey, detectMeter, estimateTempo } from '@/lib/music/theory';
import { projectMediaUrl, type ExportFormat, type NoteEvent, type Project, type ProjectSettings } from '../../../shared/ipc';
import { getTuning, INSTRUMENTS, MAX_CAPO, type InstrumentId } from '../../../shared/instruments';
import { METERS, type MeterId } from '../../../shared/meters';

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

/** Scientific pitch name, e.g. "E4", for the note editor. */
const pitchName = (midi: number) => {
  const name = alphaTexPitch(midi);
  return name[0].toUpperCase() + name.slice(1).replace('#', '♯');
};
const STRING_NAMES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

const ProjectEditor = ({ project }: { project: Project }) => {
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const [notes, setNotes] = useState<NoteEvent[]>(project.notes);
  const [edited, setEdited] = useState(project.edited);
  const [history, setHistory] = useState<NoteEvent[][]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<NoteLocation | null>(null);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveTimer = useRef<number>();
  const notesTimer = useRef<number>();

  // Detection runs on the notes as opened, so hand edits do not shift the tempo or bar lines.
  const detectionNotes = useRef(project.notes).current;
  const detectedTempo = useMemo(() => estimateTempo(detectionNotes), [detectionNotes]);
  const detectedMeter = useMemo(() => detectMeter(detectionNotes, detectedTempo), [detectionNotes, detectedTempo]);
  const key = useMemo(() => detectKey(detectionNotes), [detectionNotes]);
  const instrument = INSTRUMENTS[settings.instrument];
  const meterId: MeterId = settings.meter ?? detectedMeter.meter;
  const meter = METERS[meterId];
  const bpm = settings.tempo ?? detectedTempo.bpm;
  const timing = useMemo(() => {
    // Downbeats found for the detected meter still apply to a chosen meter with as many beats per bar.
    const barPhase = METERS[detectedMeter.meter].beatsPerBar === meter.beatsPerBar ? detectedMeter.barPhase : 0;
    return { bpm, offset: detectedMeter.offset, meter: meterId, barPhase };
  }, [bpm, detectedMeter, meter, meterId]);
  const [tempoText, setTempoText] = useState(String(bpm));
  useEffect(() => setTempoText(String(bpm)), [bpm]);

  const detectedTuning = useMemo(
    () => detectTuning(detectionNotes, instrument.tunings, { frets: instrument.frets, ...timing }),
    [detectionNotes, instrument, timing],
  );
  const tuning = settings.tuningId === null ? detectedTuning : getTuning(settings.instrument, settings.tuningId);
  const detectedCapo = useMemo(
    () => detectCapo(detectionNotes, { tuning: tuning.strings, frets: instrument.frets, ...timing }, MAX_CAPO),
    [detectionNotes, tuning, instrument, timing],
  );
  const capo = settings.capo ?? detectedCapo;

  const arrangement = useMemo(
    () => arrange(notes, { tuning: tuning.strings, frets: instrument.frets, ...timing, capo }),
    [notes, instrument, tuning, timing, capo],
  );
  const tex = useMemo(
    () => toAlphaTex(arrangement, { title: project.title, bpm, key, instrument, tuning: tuning.strings, capo, chords: settings.chords }),
    [arrangement, project.title, bpm, key, instrument, tuning, capo, settings.chords],
  );

  // Settings apply instantly; saving to disk is debounced.
  const updateSettings = (next: ProjectSettings) => {
    setSettings(next);
    setSelected(null);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const result = await requireApi().updateProjectSettings(project.id, next);
      if (result.ok) void queryClient.invalidateQueries({ queryKey: ['projects'] });
      else toast({ title: 'Could not save settings', description: result.error.message, variant: 'destructive' });
    }, 400);
  };

  const saveNotes = (next: NoteEvent[]) => {
    setNotes(next);
    setEdited(true);
    window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(async () => {
      const result = await requireApi().updateProjectNotes(project.id, next);
      if (result.ok) void queryClient.invalidateQueries({ queryKey: ['projects'] });
      else toast({ title: 'Could not save your edits', description: result.error.message, variant: 'destructive' });
    }, 600);
  };
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(notesTimer.current);
    },
    [],
  );

  const selectedNote = selected && findNote(arrangement, selected);
  const editContext = { tuning: tuning.strings, capo, frets: instrument.frets };

  const edit = (change: NoteEdit) => {
    if (!selected || !selectedNote) return;
    const result = applyEdit(notes, selectedNote, selected, change, editContext);
    if (!result) {
      toast({ title: "Can't play that", description: 'That note does not fit on this string or neck.' });
      return;
    }
    setHistory((h) => [...h.slice(-99), notes]);
    setSelected(result.location);
    saveNotes(result.notes);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setSelected(null);
    saveNotes(previous);
  };

  const restoreDetected = async () => {
    window.clearTimeout(notesTimer.current);
    const result = await requireApi().resetProjectNotes(project.id);
    if (!result.ok) {
      toast({ title: 'Could not restore the notes', description: result.error.message, variant: 'destructive' });
      return;
    }
    setHistory((h) => [...h.slice(-99), notes]);
    setNotes(result.value);
    setEdited(false);
    setSelected(null);
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  // Keyboard editing: arrows move by a semitone (or between strings with Alt), digits type a fret.
  const fretTyping = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      if (!selected || !selectedNote) return;
      if (e.key === 'Delete' || e.key === 'Backspace') edit({ type: 'delete' });
      else if (e.key === 'ArrowUp' && e.altKey) edit({ type: 'string', string: selected.string + 1 });
      else if (e.key === 'ArrowDown' && e.altKey) edit({ type: 'string', string: selected.string - 1 });
      else if (e.key === 'ArrowUp') edit({ type: 'pitch', delta: 1 });
      else if (e.key === 'ArrowDown') edit({ type: 'pitch', delta: -1 });
      else if (e.key === 'Escape') setSelected(null);
      else if (/^[0-9]$/.test(e.key)) {
        // Two digits typed quickly make a two-digit fret.
        const now = Date.now();
        const typing = fretTyping.current;
        const text = now - typing.at < 800 && typing.text.length === 1 ? typing.text + e.key : e.key;
        fretTyping.current = { text, at: now };
        edit({ type: 'fret', fret: Number(text) });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const commitTempo = () => {
    const value = Number(tempoText);
    if (Number.isFinite(value) && value > 0) updateSettings({ ...settings, tempo: clampTempo(value) });
    else setTempoText(String(bpm));
  };

  const exportAs = async (format: ExportFormat) => {
    try {
      const data =
        format === 'midi' ? toMidi(notes, { title: project.title, bpm: bpm * meter.quartersPerBeat, instrument })
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
            {project.sourceName} · {formatDuration(project.durationSeconds)} · {notes.length} notes · {formatDate(project.createdAt)}
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
              updateSettings({ ...settings, instrument: id, tuningId: null, capo: null });
            }}
          >
            <SelectTrigger id="instrument" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.values(INSTRUMENTS).map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Tuning" htmlFor="tuning">
          <Select
            value={settings.tuningId ?? 'auto'}
            onValueChange={(value) => updateSettings({ ...settings, tuningId: value === 'auto' ? null : value })}
          >
            <SelectTrigger id="tuning" className="w-[260px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto ({detectedTuning.name})</SelectItem>
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

        <Field label="Time signature" htmlFor="meter">
          <Select
            value={settings.meter ?? 'auto'}
            onValueChange={(value) => updateSettings({ ...settings, meter: value === 'auto' ? null : (value as MeterId) })}
          >
            <SelectTrigger id="meter" className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto ({METERS[detectedMeter.meter].name})</SelectItem>
              {Object.values(METERS).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        <Field label={meter.quartersPerBeat === 1 ? 'Tempo (BPM)' : 'Tempo (dotted ♩)'} htmlFor="tempo">
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

        <Toggle
          pressed={settings.chords}
          onPressedChange={(chords) => updateSettings({ ...settings, chords })}
          aria-label="Chord names"
          title="Show chord names and diagrams"
          className="h-10 self-end rounded-full border px-4 data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
        >
          Chords
        </Toggle>

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
          <video ref={setMedia} controls src={mediaUrl} className="w-full max-h-72 rounded-2xl bg-black border" aria-label="Original recording" />
        ) : (
          <audio ref={setMedia} controls src={mediaUrl} className="w-full" aria-label="Original recording" />
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          The original file is no longer at <code>{project.sourcePath}</code>, so it can't be played back.
        </p>
      )}

      <ScoreView
        tex={tex}
        media={media}
        mediaOffset={arrangement.startTime}
        onNoteClick={editing ? setSelected : undefined}
        selected={editing ? selected : null}
        controls={
          <Toggle
            pressed={editing}
            onPressedChange={(on) => {
              setEditing(on);
              setSelected(null);
            }}
            aria-label="Edit notes"
            className="h-11 rounded-full px-4 data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
          >
            <Pencil className="h-4 w-4 mr-1" /> Edit notes
          </Toggle>
        }
        toolbar={
          editing && (
            <>
              {!selectedNote && (
                <span className="text-sm text-muted-foreground">Click a note in the score to change or delete it.</span>
              )}
              {selected && selectedNote && (
                <div className="flex flex-wrap items-center gap-3 text-sm" aria-label="Selected note">
                  <span className="font-display text-base" data-testid="selected-note-info">
                    {pitchName(selectedNote.pitch)}
                  </span>
                  <span className="text-muted-foreground">bar {selected.bar + 1}</span>
                  <Label htmlFor="note-fret" className="text-muted-foreground">Fret</Label>
                  <Input
                    key={`${selected.bar}-${selected.beat}-${selected.string}-${selectedNote.fret}`}
                    id="note-fret"
                    className="h-9 w-16"
                    type="number"
                    min={0}
                    max={instrument.frets - capo}
                    defaultValue={selectedNote.fret}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const fret = Number(e.currentTarget.value);
                      if (Number.isInteger(fret) && fret !== selectedNote.fret) edit({ type: 'fret', fret });
                    }}
                  />
                  <Label htmlFor="note-string" className="text-muted-foreground">String</Label>
                  <Select value={String(selected.string)} onValueChange={(value) => edit({ type: 'string', string: Number(value) })}>
                    <SelectTrigger id="note-string" className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tuning.strings.map((open, string) => (
                        <SelectItem key={string} value={String(string)}>
                          {STRING_NAMES[tuning.strings.length - 1 - string] ?? `${tuning.strings.length - string}th`} ({pitchName(open + capo).replace(/\d+$/, '')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => edit({ type: 'pitch', delta: -1 })} title="Down a semitone (↓)">−½</Button>
                  <Button variant="outline" size="sm" onClick={() => edit({ type: 'pitch', delta: 1 })} title="Up a semitone (↑)">+½</Button>
                  <Button variant="outline" size="sm" onClick={() => edit({ type: 'delete' })} title="Delete (Del)" aria-label="Delete note">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={history.length === 0} onClick={undo} title="Undo (Ctrl+Z)">
                  <Undo2 className="h-4 w-4 mr-1" /> Undo
                </Button>
                {edited && (
                  <Button variant="ghost" size="sm" onClick={() => void restoreDetected()} title="Discard all edits">
                    <RotateCcw className="h-4 w-4 mr-1" /> Restore detected notes
                  </Button>
                )}
              </div>
            </>
          )
        }
      />

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
