import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, Loader2, Pencil, Plus, RotateCcw, Sparkles, Timer, Trash2, Undo2 } from 'lucide-react';
import InstrumentIcon from '@/components/InstrumentIcon';
import ScoreView, { type NoteDrag } from '@/components/ScoreView';
import SwitchPartDialog from '@/components/SwitchPartDialog';
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
import { useMenuMusic } from '@/lib/menuMusic';
import { formatDate, formatDuration, isVideoFile } from '@/lib/format';
import { arrange, detectCapo, detectTuning } from '@/lib/music/arrange';
import { applyEdit, findNote, locateSource, type NoteEdit, type NoteLocation } from '@/lib/music/edit';
import { toAlphaTex, toMidi } from '@/lib/music/export';
import { partNotes } from '@/lib/music/parts';
import { toGuitarPro } from '@/lib/music/guitarPro';
import { clickBarPhase, clickGrid, detectTempoChanges } from '@/lib/music/tempo';
import { alphaTexPitch, detectKey, detectMeter, estimateTempo, makeKey } from '@/lib/music/theory';
import { MAX_TRANSPOSE, projectMediaUrl, type PartId, type ExportFormat, type NoteEvent, type Project, type ProjectSettings } from '../../../shared/ipc';
import { getTuning, INSTRUMENTS, MAX_CAPO, samePart, type InstrumentId } from '../../../shared/instruments';
import { METERS, type MeterId } from '../../../shared/meters';

const EXPORTS: { format: ExportFormat; label: string; use: string }[] = [
  { format: 'gp', label: 'Guitar Pro 7 (.gp)', use: 'Tab and notation for Guitar Pro, TuxGuitar or MuseScore' },
  { format: 'midi', label: 'MIDI (.mid)', use: 'The notes for a DAW or a notation program' },
  { format: 'alphatex', label: 'alphaTex (.alphatex)', use: 'The score as text, to edit by hand' },
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

/** A row of settings under a short heading, in the colour of one of the frets. */
const Group = ({ title, color, children }: { title: string; color: string; children: ReactNode }) => (
  <section className="border-t pt-4 first:border-t-0 first:pt-0" aria-label={title} style={{ '--group': color } as CSSProperties}>
    <h2 className="mb-3 flex items-center gap-2 font-sans text-sm font-semibold text-foreground">
      <span className="h-2 w-2 rounded-full bg-[color:var(--group)] shadow-[0_0_8px_var(--group)]" aria-hidden />
      {title}
    </h2>
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">{children}</div>
  </section>
);

/** An on/off option shown as a chip: ticked when on. */
const Option = ({
  pressed,
  onPressedChange,
  label,
  title,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  label: string;
  title: string;
  children: ReactNode;
}) => (
  <Toggle
    pressed={pressed}
    onPressedChange={onPressedChange}
    aria-label={label}
    title={title}
    className="h-10 gap-1.5 rounded-full border px-4 text-muted-foreground data-[state=on]:border-gh-yellow/60 data-[state=on]:bg-gh-yellow/10 data-[state=on]:text-gh-yellow"
  >
    {pressed ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
    {children}
  </Toggle>
);

/** Scientific pitch name, e.g. "E4", for the note editor. */
const pitchName = (midi: number) => {
  const name = alphaTexPitch(midi);
  return name[0].toUpperCase() + name.slice(1).replace('#', '♯');
};
const STRING_NAMES = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
/** Name of a string, given its index in the tuning's physical order (lowest first). */
const stringName = (string: number, count: number) => STRING_NAMES[count - 1 - string] ?? `${count - string}th`;
/** The grid a dragged note moves by, from its length in quarter notes. */
const SLOT_NAMES: Record<string, string> = { '0.25': 'sixteenth', '0.5': 'eighth', '1': 'quarter' };

const ProjectEditor = ({ project }: { project: Project }) => {
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const [notes, setNotes] = useState<NoteEvent[]>(project.notes);
  const [edited, setEdited] = useState(project.edited);
  const [history, setHistory] = useState<NoteEvent[][]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<NoteLocation | null>(null);
  /** An edited note to select again once the tab is rearranged (an index into the sounding notes). */
  const [follow, setFollow] = useState<number | null>(null);
  /** Bumped to play the selected note, so an edit is heard. */
  const [preview, setPreview] = useState(0);
  // An instrument of another part, waiting for the user to have it transcribed.
  const [otherPart, setOtherPart] = useState<InstrumentId | null>(null);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveTimer = useRef<number>();
  const notesTimer = useRef<number>();

  // Detection runs on the notes as opened, so hand edits do not shift the tempo or bar lines.
  const detectionNotes = useRef(project.notes).current;
  // A metronome heard in the recording gives the beats exactly (its accents, the bars).
  const clicks = useMemo(() => (project.metronome ? clickGrid(project.metronome) : null), [project.metronome]);
  const detectedTempo = useMemo(
    () => (clicks ? { bpm: clicks.bpm, offset: clicks.beats[0] } : estimateTempo(detectionNotes)),
    [clicks, detectionNotes],
  );
  const steadyMeter = useMemo(() => detectMeter(detectionNotes, detectedTempo), [detectionNotes, detectedTempo]);
  const key = useMemo(() => detectKey(detectionNotes), [detectionNotes]);
  const instrument = INSTRUMENTS[settings.instrument];
  const bpm = settings.tempo ?? detectedTempo.bpm;
  // The metronome's beats, unless a tempo was chosen by hand.
  const metronomeBeats = clicks && settings.tempo === null ? clicks : null;
  // Tempo changes are tracked around the chosen tempo, so ½× and 2× still apply.
  const tempoChanges = useMemo(
    () => (settings.tempoChanges && !metronomeBeats && detectionNotes.length > 0 ? detectTempoChanges(detectionNotes, bpm) : null),
    [settings.tempoChanges, metronomeBeats, detectionNotes, bpm],
  );
  const beats = metronomeBeats ? metronomeBeats.beats : tempoChanges?.variable ? tempoChanges.beats : undefined;
  const detectedMeter = useMemo(() => {
    const heard = beats ? detectMeter(detectionNotes, detectedTempo, beats) : steadyMeter;
    // The metronome's accents tell the bars: how many beats, and where they start.
    const phase = metronomeBeats && detectionNotes.length > 0 ? clickBarPhase(metronomeBeats, Math.min(...detectionNotes.map((n) => n.start))) : null;
    if (phase === null || !metronomeBeats || (metronomeBeats.beatsPerBar !== 3 && metronomeBeats.beatsPerBar !== 4)) return heard;
    const triplets = heard.meter.endsWith('-triplets');
    const meter: MeterId = metronomeBeats.beatsPerBar === 3 ? (triplets ? '3/4-triplets' : '3/4') : triplets ? '4/4-triplets' : '4/4';
    return { ...heard, meter, barPhase: phase };
  }, [beats, metronomeBeats, detectionNotes, detectedTempo, steadyMeter]);
  const meterId: MeterId = settings.meter ?? detectedMeter.meter;
  const meter = METERS[meterId];
  const timing = useMemo(() => {
    // Downbeats found for the detected meter still apply to a chosen meter with as many beats per bar.
    const barPhase = METERS[detectedMeter.meter].beatsPerBar === meter.beatsPerBar ? detectedMeter.barPhase : 0;
    return { bpm, offset: steadyMeter.offset, beats, meter: meterId, barPhase };
  }, [bpm, steadyMeter, beats, detectedMeter, meter, meterId]);
  const [tempoText, setTempoText] = useState(String(bpm));
  useEffect(() => setTempoText(String(bpm)), [bpm]);

  const detectedTuning = useMemo(
    () => detectTuning(detectionNotes, instrument.tunings, { frets: instrument.frets, ...timing }),
    [detectionNotes, instrument, timing],
  );
  const tuning = settings.tuningId === null ? detectedTuning : getTuning(settings.instrument, settings.tuningId);
  // Transposed, the part is written and played higher or lower than the recording.
  const transpose = settings.transpose;
  const shift = (list: NoteEvent[], semitones: number) => (semitones ? list.map((n) => ({ ...n, pitch: n.pitch + semitones })) : list);
  const sounding = useMemo(() => shift(notes, transpose), [notes, transpose]);
  // The part written: everything, the melody on top or the accompaniment (sources: their indices).
  const part = useMemo(() => partNotes(sounding, settings.part), [sounding, settings.part]);
  const detectionSounding = useMemo(() => shift(detectionNotes, transpose), [detectionNotes, transpose]);
  const shownKey = useMemo(() => (transpose ? makeKey((((key.tonic + transpose) % 12) + 12) % 12, key.mode) : key), [key, transpose]);
  const detectedCapo = useMemo(
    () => detectCapo(detectionSounding, { tuning: tuning.strings, frets: instrument.frets, ...timing }, MAX_CAPO),
    [detectionSounding, tuning, instrument, timing],
  );
  const capo = settings.capo ?? detectedCapo;
  // "Same shapes": moving the part up a semitone moves the capo up a fret, so the tab stays the same.
  const [sameShapes, setSameShapes] = useState(true);
  const canTranspose = (step: number) =>
    Math.abs(transpose + step) <= MAX_TRANSPOSE && (!sameShapes || (capo + step >= 0 && capo + step <= MAX_CAPO));
  const transposeBy = (step: number) =>
    updateSettings({ ...settings, transpose: transpose + step, capo: sameShapes ? capo + step : settings.capo });

  const arrangement = useMemo(
    () => arrange(part.notes, { tuning: tuning.strings, frets: instrument.frets, ...timing, capo, techniques: settings.techniques }),
    [part, instrument, tuning, timing, capo, settings.techniques],
  );
  const tex = useMemo(
    () => toAlphaTex(arrangement, { title: project.title, bpm, key: shownKey, instrument, tuning: tuning.strings, capo, chords: settings.chords }),
    [arrangement, project.title, bpm, shownKey, instrument, tuning, capo, settings.chords],
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

  /** Why an edit cannot be played, in words. */
  const unplayable = (change: NoteEdit, note: { pitch: number; fret: number }): string => {
    const count = tuning.strings.length;
    if (change.type === 'fret') return `Fret ${change.fret} is not on the neck: frets go from 0 to ${instrument.frets - capo}${capo ? ' above the capo' : ''}.`;
    if (change.type === 'string' && change.keep === 'pitch') {
      const open = tuning.strings[change.string] + capo;
      if (change.string < 0 || change.string >= count) return 'There is no string beyond this one.';
      return `${pitchName(note.pitch)} cannot be played on the ${stringName(change.string, count)} string: it is ${note.pitch < open ? 'lower than the open string' : 'beyond its last fret'}.`;
    }
    if (change.type === 'string') return `Fret ${note.fret} is not on the ${stringName(change.string, count)} string.`;
    return `That note is out of the ${instrument.name.toLowerCase()}'s range.`;
  };

  const edit = (change: NoteEdit) => {
    if (!selected || !selectedNote) return;
    // The arrangement's notes are the part's: edit the same notes in the whole transcription.
    const placed = { ...selectedNote, sources: selectedNote.sources.map((k) => part.sources[k]) };
    const result = applyEdit(sounding, placed, selected, change, editContext);
    if (!result) {
      toast({ title: "Can't play that", description: unplayable(change, selectedNote) });
      return;
    }
    setHistory((h) => [...h.slice(-99), notes]);
    // Select the note again where the new arrangement puts it, and play it.
    setSelected(null);
    setFollow(change.type === 'delete' ? null : placed.sources[0]);
    // Edits are made in the written key and stored in the recording's.
    saveNotes(shift(result.notes, -transpose));
  };

  useEffect(() => {
    if (follow === null) return;
    setFollow(null);
    setSelected(locateSource(arrangement, (sources) => sources.some((k) => part.sources[k] === follow)));
    setPreview((n) => n + 1);
  }, [follow, arrangement, part]);

  const selectNote = (location: NoteLocation) => {
    setSelected(location);
    setPreview((n) => n + 1);
  };

  // A drag moves a note by semitones and by steps of the rhythmic grid (a sixteenth in 4/4).
  const slotsPerBar = meter.beatsPerBar * meter.slotsPerBeat;
  const dragSteps = (drag: NoteDrag) => Math.round(drag.bars * slotsPerBar);
  const describeDrag = (_location: NoteLocation, drag: NoteDrag) => {
    if (!selectedNote) return '';
    const steps = dragSteps(drag);
    const slot = SLOT_NAMES[String(meter.quartersPerBeat / meter.slotsPerBeat)] ?? 'step';
    const when = steps === 0 ? '' : ` · ${Math.abs(steps)} ${slot}${Math.abs(steps) > 1 ? 's' : ''} ${steps > 0 ? 'later' : 'earlier'}`;
    return `${pitchName(selectedNote.pitch + drag.semitones)}${when}`;
  };
  const dragNote = (location: NoteLocation, drag: NoteDrag) => {
    const steps = dragSteps(drag);
    if (drag.semitones === 0 && steps === 0) return;
    const { barTimes } = arrangement;
    const barSeconds = (barTimes[location.bar + 1] ?? barTimes[location.bar]) - barTimes[location.bar];
    edit({ type: 'move', semitones: drag.semitones, seconds: (steps * barSeconds) / slotsPerBar });
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
      else if (e.key === 'ArrowUp' && e.altKey) edit({ type: 'string', string: selected.string + 1, keep: 'pitch' });
      else if (e.key === 'ArrowDown' && e.altKey) edit({ type: 'string', string: selected.string - 1, keep: 'pitch' });
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
        format === 'midi' ? toMidi(part.notes, { title: project.title, bpm: bpm * meter.quartersPerBeat, instrument }, arrangement)
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
            {project.isolated && ` · ${instrument.name.toLowerCase()} isolated from the mix`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="btn-fire mt-7 h-11 rounded-full px-6">
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {EXPORTS.map(({ format, label, use }) => (
              <DropdownMenuItem key={format} onSelect={() => void exportAs(format)} className="flex-col items-start gap-0.5 py-2">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{use}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="panel space-y-4 p-5 animate-rise-in [animation-delay:80ms]">
        <Group title="What to write" color="var(--gh-green)">
          <Field label="Instrument" htmlFor="instrument">
            <Select
              value={settings.instrument}
              onValueChange={(value) => {
                const id = value as InstrumentId;
                // Guitar and ukulele: the same notes, written for the other neck. The bass: its own part.
                if (samePart(settings.instrument, id)) updateSettings({ ...settings, instrument: id, tuningId: null, capo: null });
                else setOtherPart(id);
              }}
            >
              <SelectTrigger id="instrument" className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(INSTRUMENTS).map((i) =>
                  samePart(settings.instrument, i.id) ? (
                    <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                  ) : (
                    <SelectItem key={i.id} value={i.id} disabled={!project.sourceAvailable}>
                      {i.name} · {project.sourceAvailable ? 'transcribe' : 'needs the recording'}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <SwitchPartDialog project={project} from={settings.instrument} to={otherPart} onClose={() => setOtherPart(null)} />
          </Field>

          <Field label="Part" htmlFor="part">
            <Select value={settings.part} onValueChange={(value) => updateSettings({ ...settings, part: value as PartId })}>
              <SelectTrigger id="part" className="w-[170px]" title="Two guitars, or a melody over its accompaniment: write one of them"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                <SelectItem value="melody">Melody / lead</SelectItem>
                <SelectItem value="accompaniment">Accompaniment</SelectItem>
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

        </Group>

        <Group title="Timing and key" color="var(--gh-blue)">
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
            {beats && tempoChanges && (
              <p className="text-xs text-muted-foreground" data-testid="tempo-range">
                Varies {tempoChanges.range[0]}–{tempoChanges.range[1]} BPM
              </p>
            )}
          </Field>

          <Field label="Key">
            <p className="h-10 flex items-center font-display text-lg">{shownKey.name}</p>
          </Field>

          <Field label="Transpose" htmlFor="transpose">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={!canTranspose(-1)} onClick={() => transposeBy(-1)} aria-label="Transpose down" title="A semitone lower">
                −
              </Button>
              <span id="transpose" className="w-10 text-center font-display tabular-nums" data-testid="transpose">
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <Button variant="outline" size="sm" disabled={!canTranspose(1)} onClick={() => transposeBy(1)} aria-label="Transpose up" title="A semitone higher">
                +
              </Button>
              <Toggle
                pressed={sameShapes}
                onPressedChange={setSameShapes}
                aria-label="Same shapes with a capo"
                title="Keep the same shapes and frets: the capo moves with the key (a capo makes the song sound higher)"
                className="h-9 rounded-full border px-3 text-xs data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
              >
                Same shapes (capo)
              </Toggle>
              <Button
                variant="ghost"
                size="sm"
                disabled={transpose === 0}
                onClick={() => updateSettings({ ...settings, transpose: 0, capo: null })}
                title="Back to the key of the recording"
              >
                Reset
              </Button>
            </div>
            {transpose !== 0 && (
              <p className="text-xs text-muted-foreground" data-testid="transpose-note">
                Sounds {Math.abs(transpose)} semitone{Math.abs(transpose) === 1 ? '' : 's'} {transpose > 0 ? 'higher' : 'lower'} than the recording
              </p>
            )}
          </Field>

        </Group>

        <Group title="In the score" color="var(--gh-yellow)">
          <Option
            pressed={settings.chords}
            onPressedChange={(chords) => updateSettings({ ...settings, chords })}
            label="Chord names"
            title="Show chord names over the staff and their diagrams at the top"
          >
            Chords
          </Option>

          <Option
            pressed={settings.techniques}
            onPressedChange={(techniques) => updateSettings({ ...settings, techniques })}
            label="Techniques"
            title="Write bends, slides, hammer-ons, pull-offs and vibrato (experimental)"
          >
            Techniques
          </Option>

          <Option
            pressed={settings.tempoChanges}
            onPressedChange={(tempoChanges) => updateSettings({ ...settings, tempoChanges })}
            label="Follow tempo changes"
            title="Follow the recording when it speeds up or slows down (otherwise the tempo is constant)"
          >
            Tempo changes
          </Option>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {metronomeBeats && (
              <span
                className="flex items-center gap-1.5 rounded-full border border-gh-blue/60 bg-gh-blue/10 px-3 py-1.5 text-sm text-gh-blue"
                title="A metronome was heard in the recording: its clicks give the beats and its accents the bars (it is left out of the transcription)"
                data-testid="metronome"
              >
                <Timer className="h-4 w-4" aria-hidden />
                Metronome · {metronomeBeats.bpm} BPM
              </span>
            )}

            {capo > 0 && (
              <span
                className="flex items-center gap-1.5 rounded-full border border-gh-yellow/60 bg-gh-yellow/10 px-3 py-1.5 text-sm text-gh-yellow"
                role="status"
              >
                <Sparkles className="h-4 w-4" />
                Capo on the {ordinal(capo)} fret{settings.capo === null && ' (detected)'}
              </span>
            )}
          </div>
        </Group>
      </div>

      {project.sourceAvailable ? (
        isVideoFile(project.sourceName) ? (
          <video ref={setMedia} controls src={mediaUrl} className="w-full max-h-72 rounded-2xl bg-black border" aria-label="Original recording" />
        ) : (
          <div className="panel flex items-center gap-4 py-2 pl-5 pr-2">
            <span className="shrink-0 text-xs uppercase tracking-widest text-muted-foreground">Original recording</span>
            <audio ref={setMedia} controls src={mediaUrl} className="h-10 min-w-0 flex-1" aria-label="Original recording" />
          </div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          The original file is no longer at <code>{project.sourcePath}</code>, so it can't be played back.
        </p>
      )}

      <ScoreView
        tex={tex}
        // The recording cannot follow a transposed part.
        media={transpose ? null : media}
        mediaOffset={arrangement.startTime}
        onNoteClick={editing ? selectNote : undefined}
        selected={editing ? selected : null}
        onNoteDrag={editing ? dragNote : undefined}
        dragLabel={describeDrag}
        previewKey={preview}
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
                <span className="text-sm text-muted-foreground">
                  Click a note to change or delete it. Drag it up or down to change the note, left or right to move it in time.
                </span>
              )}
              {selected && selectedNote && (
                <div className="flex flex-wrap items-center gap-3 text-sm" aria-label="Selected note">
                  <span className="font-display text-base" data-testid="selected-note-info">
                    {pitchName(selectedNote.pitch)}
                  </span>
                  <span className="text-muted-foreground">bar {selected.bar + 1}</span>
                  <Label htmlFor="note-fret" className="text-muted-foreground">Fret</Label>
                  <Input
                    key={`${selected.voice ?? 0}-${selected.bar}-${selected.beat}-${selected.string}-${selectedNote.fret}`}
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
                  <Select value={String(selected.string)} onValueChange={(value) => edit({ type: 'string', string: Number(value), keep: 'fret' })}>
                    <SelectTrigger id="note-string" className="h-9 w-[150px]" title="The same fret on another string (Alt+↑/↓: the same note on another string)"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tuning.strings.map((open, string) => (
                        <SelectItem key={string} value={String(string)}>
                          {stringName(string, tuning.strings.length)} ({pitchName(open + capo).replace(/\d+$/, '')})
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
  // No menu music over a song.
  useMenuMusic(false);
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
