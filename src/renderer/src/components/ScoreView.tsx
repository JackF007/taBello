import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlphaTabApi, LayoutMode, LogLevel, model, NotationElement, PlayerMode, ScrollMode, synth } from '@coderline/alphatab';
import { AudioLines, Guitar, Loader2, Pause, Play, Repeat, Square, Timer, X } from 'lucide-react';
import Equalizer from '@/components/Equalizer';
import Fretboard, { type FretboardNote } from '@/components/Fretboard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { NoteLocation } from '@/lib/music/edit';
import { createMediaHandler, mediaTimeToScore } from '@/lib/playAlong';

interface ScoreViewProps {
  /** alphaTex source of the score to render. */
  tex: string;
  /** The original recording, to play the score along with it. */
  media?: HTMLMediaElement | null;
  /** Time in the recording, in seconds, where bar 1 starts. */
  mediaOffset?: number;
  /**
   * When set, notes can be picked: a click on one selects it (and moves the cursor there), a click
   * elsewhere passes null.
   */
  onNoteClick?: (location: NoteLocation | null) => void;
  /** Note to highlight. */
  selected?: NoteLocation | null;
  /**
   * When set, a note can be dragged: on the staff up or down by lines and spaces, on the tab onto
   * another string, and left or right in time (in bars, a fraction of the width of its bar). Called
   * on release.
   */
  onNoteDrag?: (location: NoteLocation, drag: NoteDrag) => void;
  /** What a drag in progress would do, shown next to the pointer. */
  dragLabel?: (location: NoteLocation, drag: NoteDrag) => string;
  /** Changing this plays the selected note (after an edit, to hear it). */
  previewKey?: number;
  /**
   * Changing this means a note was edited: the transcription is played from then on (the original
   * recording cannot sound an edit).
   */
  editKey?: number;
  /** The instrument's neck, to show where the notes being played are: open-string names, lowest first. */
  neck?: { strings: string[]; capo: number; frets: number };
  /** Extra controls for the transport bar. */
  controls?: ReactNode;
  /** An extra toolbar row below the transport bar. */
  toolbar?: ReactNode;
}

type Source = 'synth' | 'original';

export interface NoteDrag {
  /** Where the note was taken: its head on the staff, or its number on the tab. */
  on: 'staff' | 'tab';
  /** Lines and spaces up on the staff, or strings up on the tab (negative: down). */
  steps: number;
  bars: number;
}

/** Pixels before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** The score's scale, and alphaTab's staff space at scale 1 (its music font size, 36, over 4). */
const SCALE = 0.9;
const STAFF_SPACE = 9;
/** A line or a space of the staff, and the distance between two strings of the tab, in pixels. */
const STAFF_STEP = (STAFF_SPACE * SCALE) / 2;
const TAB_LINE = Math.floor(STAFF_SPACE * 1.5) * SCALE;
/** How far from a note head a press still takes the note. */
const HIT_SLOP = 6;

const SPEEDS = ['0.5', '0.75', '1'];
/** Pixels of the score kept in sight above the line being played. */
const SCROLL_CONTEXT = 140;

// Tab numbers take the Guitar Hero fret colors, from the lowest string up.
const STRING_COLORS = ['#2ee05a', '#ff3355', '#ffd600', '#2e9bff', '#ff8a1f', '#b45cff'];

/** Colors each tablature number by its string, so strings are easy to follow at a glance. */
function colorTabByString(score: model.Score): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      if (!staff.showTablature) continue;
      for (const bar of staff.bars) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              const style = new model.NoteStyle();
              // alphaTab numbers strings from 1 = lowest.
              style.colors.set(model.NoteSubElement.GuitarTabFretNumber, model.Color.fromJson(STRING_COLORS[(note.string - 1) % STRING_COLORS.length]));
              note.style = style;
            }
          }
        }
      }
    }
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Renders notation and tablature with alphaTab and plays it back, either with the bundled soundfont
 * or by following the original recording (cursor in sync, same speed and loop controls).
 */
const ScoreView = ({ tex, media = null, mediaOffset = 0, onNoteClick, selected = null, onNoteDrag, dragLabel, previewKey, editKey, neck, controls, toolbar }: ScoreViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const [source, setSource] = useState<Source>('synth');
  const [isRendering, setIsRendering] = useState(true);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [showNeck, setShowNeck] = useState(true);
  /** Notes sounding now (from the playback cursor), and the one selected for editing. */
  const [playing, setPlaying] = useState<FretboardNote[]>([]);
  const [chosen, setChosen] = useState<FretboardNote | null>(null);
  const [loop, setLoop] = useState(false);
  const [hasRange, setHasRange] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Box[]>([]);
  /** The selected note's moment, as a band across the staves (where a dragged note leaves from). */
  const [column, setColumn] = useState<Box | null>(null);
  /** What the dragged note becomes, shown in a lens around it (centre, in the score's pixels). */
  const [dragTip, setDragTip] = useState<{ x: number; y: number; text: string } | null>(null);
  /** Where a dragged note would land, drawn over the score, and its moment when moved in time. */
  const [ghost, setGhost] = useState<Box | null>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Latest values for alphaTab callbacks, which are registered once per player.
  const texRef = useRef(tex);
  texRef.current = tex;
  const offsetRef = useRef(mediaOffset);
  offsetRef.current = mediaOffset;
  const noteClickRef = useRef(onNoteClick);
  noteClickRef.current = onNoteClick;
  const dragRef = useRef({ onNoteDrag, dragLabel });
  dragRef.current = { onNoteDrag, dragLabel };
  /** The note pressed: where, on which staff, its head, its beat and its bar's width. */
  const pressRef = useRef<{
    x: number;
    y: number;
    location: NoteLocation;
    on: 'staff' | 'tab';
    head: Box;
    beat: model.Beat;
    barWidth: number;
    /** The staves of the note's line: the height of the band showing where it goes. */
    system: { y: number; h: number };
    dragging?: boolean;
  } | null>(null);
  /** The selected note is to be played once the transcription's sounds are ready. */
  const pendingPreviewRef = useRef(false);
  const loadedTexRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  const neckRef = useRef(neck);
  neckRef.current = neck;
  selectedRef.current = selected;
  const settingsRef = useRef({ metronome, loop, speed });
  settingsRef.current = { metronome, loop, speed };

  const updateHighlight = useCallback(() => {
    const api = apiRef.current;
    const location = selectedRef.current;
    const beat = location && api?.score?.tracks[0]?.staves[0]?.bars[location.bar]?.voices[location.voice ?? 0]?.beats[location.beat];
    const note = beat?.notes.find((n) => n.string - 1 === location!.string);
    // The note in both staves: its head in the notation and its number in the tablature, so an
    // edit shows in both.
    const bounds = note ? (api?.boundsLookup?.findBeats(beat!)?.flatMap((b) => b.notes ?? []).filter((n) => n.note === note) ?? []) : [];
    setHighlights(bounds.map(({ noteHeadBounds: box }) => ({ x: box.x, y: box.y, w: box.w, h: box.h })));
    const first = bounds[0];
    if (first) {
      const system = first.beatBounds.barBounds.masterBarBounds.visualBounds;
      const beatBox = first.beatBounds.visualBounds;
      setColumn({ x: beatBox.x - 6, y: system.y - 6, w: beatBox.w + 12, h: system.h + 12 });
    } else setColumn(null);
    setChosen(note ? { string: note.string - 1, fret: note.fret + (neckRef.current?.capo ?? 0), selected: true } : null);
  }, []);

  useEffect(updateHighlight, [selected, updateHighlight]);

  /** Plays the selected note with the transcription's sound. */
  const lastPreviewRef = useRef(0);
  const playSelected = useCallback((api: AlphaTabApi) => {
    // One sound for one change, even when both an edit and a new selection ask for it.
    if (performance.now() - lastPreviewRef.current < 300) return;
    lastPreviewRef.current = performance.now();
    const location = selectedRef.current;
    const beat = location && api.score?.tracks[0]?.staves[0]?.bars[location.bar]?.voices[location.voice ?? 0]?.beats[location.beat];
    const note = beat?.notes.find((n) => n.string - 1 === location!.string);
    if (note) api.playNote(note);
  }, []);

  // One alphaTab instance per sound source: switching player modes means a new player.
  useEffect(() => {
    if (!containerRef.current || !scrollRef.current) return;
    const original = source === 'original' && media !== null;
    setIsPlayerReady(false);
    setIsPlaying(false);
    setHasRange(false);
    // Relative paths: assets are bundled in public/assets and served from the app's own origin.
    const api = new AlphaTabApi(containerRef.current, {
      core: { logLevel: LogLevel.Warning, fontDirectory: './assets/font/', includeNoteBounds: true },
      // Dynamics are not detected, so alphaTab's default marking would be made up.
      notation: { elements: new Map([[NotationElement.EffectDynamics, false]]) },
      display: {
        layoutMode: LayoutMode.Page,
        scale: SCALE,
        resources: {
          mainGlyphColor: '#eeeef8',
          secondaryGlyphColor: '#a3a3c2',
          scoreInfoColor: '#eeeef8',
          staffLineColor: '#3d3b63',
          barSeparatorColor: '#5d5a8f',
          barNumberColor: '#ff8a1f',
          elementFonts: new Map([[NotationElement.ScoreTitle, '28px "Russo One", sans-serif']]),
        },
      },
      player: {
        playerMode: original ? PlayerMode.EnabledExternalMedia : PlayerMode.EnabledSynthesizer,
        // GeneralUser GS guitars and bass, built by scripts/build-soundfont.py.
        soundFont: './soundfont/generaluser-gs-tabello.sf2',
        scrollElement: scrollRef.current,
        // Scroll to the line being played with some of the score above it in sight (at the start: the
        // title and chord diagrams).
        scrollOffsetY: -SCROLL_CONTEXT,
        scrollMode: ScrollMode.Off,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true,
      },
    });
    api.scoreLoaded.on(colorTabByString);
    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));
    // Note positions are known only once the whole score is laid out.
    api.postRenderFinished.on(updateHighlight);
    api.playerReady.on(() => {
      if (original) (api.player!.output as synth.IExternalMediaSynthOutput).handler = createMediaHandler(media, () => offsetRef.current);
      const { metronome: click, loop: looping, speed: rate } = settingsRef.current;
      api.metronomeVolume = click && !original ? 1 : 0;
      api.isLooping = looping;
      api.playbackSpeed = Number(rate);
      setIsPlayerReady(true);
      if (pendingPreviewRef.current && !original) {
        pendingPreviewRef.current = false;
        playSelected(api);
      }
    });
    api.playerStateChanged.on((e) => {
      setIsPlaying(e.state === synth.PlayerState.Playing);
      // The score follows the cursor once it plays: opened, it stays at its top (title, chord diagrams).
      if (e.state === synth.PlayerState.Playing) api.settings.player.scrollMode = ScrollMode.Continuous;
    });
    // The notes under the cursor, for the neck: a picked note bright, a tied one still ringing.
    api.activeBeatsChanged.on(({ activeBeats }) => {
      const capo = neckRef.current?.capo ?? 0;
      setPlaying(
        activeBeats
          .filter((beat) => beat.voice.bar.staff.index === 0 && beat.voice.bar.staff.track.index === 0)
          .flatMap((beat) => beat.notes.map((n) => ({ string: n.string - 1, fret: n.fret + capo, ringing: n.isTieDestination }))),
      );
    });
    api.playbackRangeChanged.on((e) => setHasRange(e.playbackRange !== null));
    api.error.on((e) => {
      console.error('alphaTab error', e);
      setError(e.message);
      setIsRendering(false);
    });
    apiRef.current = api;
    setError(null);
    loadedTexRef.current = texRef.current;
    api.tex(texRef.current);

    // Follow the recording's clock: smoothly while it plays, and when it is paused or sought with
    // its own controls.
    const cleanups: (() => void)[] = [];
    if (original) {
      const output = () => api.player?.output as synth.IExternalMediaSynthOutput | undefined;
      const sync = () => output()?.updatePosition(mediaTimeToScore(media.currentTime, offsetRef.current, media.playbackRate));
      let frame = 0;
      const tick = () => {
        sync();
        frame = requestAnimationFrame(tick);
      };
      const onPlay = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
        if (api.playerState !== synth.PlayerState.Playing) api.play();
      };
      const onPause = () => {
        cancelAnimationFrame(frame);
        sync();
        if (api.playerState === synth.PlayerState.Playing) api.pause();
      };
      media.addEventListener('play', onPlay);
      media.addEventListener('pause', onPause);
      media.addEventListener('seeked', sync);
      cleanups.push(() => {
        cancelAnimationFrame(frame);
        media.removeEventListener('play', onPlay);
        media.removeEventListener('pause', onPause);
        media.removeEventListener('seeked', sync);
        media.pause();
        media.playbackRate = 1;
      });
    }
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      api.destroy();
      apiRef.current = null;
    };
  }, [source, media, updateHighlight, playSelected]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || tex === loadedTexRef.current) return;
    setError(null);
    api.stop();
    setPlaying([]);
    loadedTexRef.current = tex;
    api.tex(tex);
  }, [tex]);

  const editable = !!onNoteClick;

  // Plays the selected note, to hear it or an edit (with the transcription's sound only: the
  // original recording cannot play one note).
  useEffect(() => {
    const api = apiRef.current;
    if (!previewKey || !api || !selectedRef.current || source !== 'synth') return;
    if (isPlayerReady) playSelected(api);
    else pendingPreviewRef.current = true;
    // Only a new key plays: not a change of selection or player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // An edit is heard: the original recording cannot play it, so the transcription takes over.
  useEffect(() => {
    if (!editKey || source !== 'original') return;
    pendingPreviewRef.current = true;
    setSource('synth');
    setNotice('Playing the transcription now, so you hear your changes.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Taking a note: a press on a note head (staff) or number (tab) selects it, and dragging it moves
  // it; a press anywhere else is alphaTab's (moving the cursor, selecting bars to loop). The
  // pointer is followed on the whole window, so the drag can leave the score.
  useEffect(() => {
    if (!editable) return;
    const container = containerRef.current;
    if (!container) return;
    /** The note under a point of the score, with the staff it was taken on. */
    const noteAt = (x: number, y: number) => {
      const lookup = apiRef.current?.boundsLookup;
      const beat = lookup?.getBeatAtPos(x, y);
      if (!lookup || !beat) return null;
      const heads = (lookup.findBeats(beat) ?? []).flatMap((b) => b.notes ?? []);
      const near = (n: (typeof heads)[number]) => {
        const box = n.noteHeadBounds;
        return Math.max(box.x - x, x - box.x - box.w, 0) + Math.max(box.y - y, y - box.y - box.h, 0);
      };
      const hit = heads.filter((n) => near(n) <= HIT_SLOP).sort((a, b) => near(a) - near(b))[0];
      if (!hit) return null;
      // The same note on both staves: the notation's head is above the tab's number.
      const same = heads.filter((n) => n.note === hit.note).sort((a, b) => a.noteHeadBounds.y - b.noteHeadBounds.y);
      const on: 'staff' | 'tab' = same.length > 1 && same.indexOf(hit) > 0 ? 'tab' : 'staff';
      const { x: hx, y: hy, w, h } = hit.noteHeadBounds;
      const bar = hit.beatBounds.barBounds.masterBarBounds.visualBounds;
      return { note: hit.note, beat: hit.note.beat, on, head: { x: hx, y: hy, w, h }, barWidth: bar.w, system: { y: bar.y, h: bar.h } };
    };
    const local = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const measure = (e: PointerEvent): NoteDrag | null => {
      const press = pressRef.current;
      if (!press) return null;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (!press.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return null;
      press.dragging = true;
      const steps = -Math.round(dy / (press.on === 'staff' ? STAFF_STEP : TAB_LINE));
      return { on: press.on, steps, bars: dx / press.barWidth };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      const found = noteAt(x, y);
      if (!found) {
        noteClickRef.current?.(null);
        return;
      }
      // The press is the note's: alphaTab does not start selecting bars from it.
      const api = apiRef.current!;
      api.settings.player.enableUserInteraction = false;
      const { note, beat, on, head, barWidth, system } = found;
      const location = { bar: beat.voice.bar.index, beat: beat.index, string: note.string - 1, voice: beat.voice.index };
      pressRef.current = { x: e.clientX, y: e.clientY, location, on, head, beat, barWidth: barWidth || 1, system };
      noteClickRef.current?.(location);
    };
    const onMove = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press) {
        // A hand over a note: it can be taken.
        if (e.target instanceof Node && container.contains(e.target)) {
          const { x, y } = local(e);
          container.style.cursor = noteAt(x, y) ? 'grab' : '';
        }
        return;
      }
      const drag = measure(e);
      if (!drag) return;
      container.style.cursor = 'grabbing';
      const lift = drag.steps * (press.on === 'staff' ? STAFF_STEP : TAB_LINE);
      const x = press.head.x + (e.clientX - press.x);
      setGhost({ ...press.head, x, y: press.head.y - lift });
      setDragTip({ x: x + press.head.w / 2, y: press.head.y - lift + press.head.h / 2, text: dragRef.current.dragLabel?.(press.location, drag) ?? '' });
      setTarget(Math.abs(e.clientX - press.x) > press.head.w ? { x: x - 6, y: press.system.y - 6, w: press.head.w + 12, h: press.system.h + 12 } : null);
    };
    const onUp = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      const drag = measure(e);
      pressRef.current = null;
      setDragTip(null);
      setGhost(null);
      setTarget(null);
      container.style.cursor = '';
      const api = apiRef.current;
      // After alphaTab has seen the release, presses elsewhere are its own again.
      window.setTimeout(() => {
        if (api) api.settings.player.enableUserInteraction = true;
      });
      if (drag) dragRef.current.onNoteDrag?.(press.location, drag);
      // A click on a note also moves the cursor there (and the recording, when following it).
      else if (api) api.tickPosition = press.beat.absolutePlaybackStart;
    };
    // Capture: the press is known before alphaTab handles it.
    container.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [editable]);

  // Space bar plays and pauses, unless typing or using a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.target !== document.body) return;
      e.preventDefault();
      apiRef.current?.playPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleMetronome = (on: boolean) => {
    setMetronome(on);
    if (apiRef.current) apiRef.current.metronomeVolume = on ? 1 : 0;
  };

  const toggleLoop = (on: boolean) => {
    setLoop(on);
    if (apiRef.current) apiRef.current.isLooping = on;
  };

  const clearRange = () => {
    const api = apiRef.current;
    if (!api) return;
    api.playbackRange = null;
    api.clearPlaybackRangeHighlight();
    setHasRange(false);
  };

  const changeSpeed = (value: string) => {
    setSpeed(value);
    if (apiRef.current) apiRef.current.playbackSpeed = Number(value);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button
          onClick={() => apiRef.current?.playPause()}
          disabled={!isPlayerReady}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="btn-fire h-11 rounded-full px-6"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="ml-1">{isPlaying ? 'Pause' : 'Play'}</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 rounded-full"
          onClick={() => {
            apiRef.current?.stop();
            setPlaying([]);
          }}
          disabled={!isPlayerReady}
          aria-label="Stop"
        >
          <Square className="h-4 w-4" />
        </Button>
        <Toggle
          pressed={loop}
          onPressedChange={toggleLoop}
          aria-label="Loop"
          title="Loop the selected bars (drag over the score to select), or the whole piece"
          disabled={!isPlayerReady}
          className="h-11 rounded-full px-4 data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
        >
          <Repeat className="h-4 w-4 mr-1" /> Loop
        </Toggle>
        {hasRange && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={clearRange}>
            <X className="h-4 w-4 mr-1" /> Clear selection
          </Button>
        )}
        <Toggle
          pressed={metronome && source === 'synth'}
          onPressedChange={toggleMetronome}
          aria-label="Metronome"
          disabled={!isPlayerReady || source === 'original'}
          className="h-11 rounded-full px-4 data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
        >
          <Timer className="h-4 w-4 mr-1" /> Metronome
        </Toggle>
        {neck && (
          <Toggle
            pressed={showNeck}
            onPressedChange={setShowNeck}
            aria-label="Neck"
            title="Show where the notes being played are on the neck"
            className="h-11 rounded-full px-4 data-[state=on]:bg-secondary data-[state=on]:text-gh-yellow"
          >
            <Guitar className="h-4 w-4 mr-1" /> Neck
          </Toggle>
        )}
        {controls}
        <Equalizer active={isPlaying} className="h-6 ml-1" />
        <div className="flex flex-wrap items-center gap-3 ml-auto text-sm text-muted-foreground">
          {media && (
            <ToggleGroup
              type="single"
              value={source}
              onValueChange={(value) => value && setSource(value as Source)}
              aria-label="Sound"
              className="rounded-full border p-0.5"
            >
              <ToggleGroupItem value="synth" className="h-8 rounded-full px-3 text-xs" title="Hear the transcription">
                Transcription
              </ToggleGroupItem>
              <ToggleGroupItem value="original" className="h-8 rounded-full px-3 text-xs" title="Hear the original recording, with the score following it">
                <AudioLines className="h-3.5 w-3.5 mr-1" /> Original
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <span className="flex items-center gap-2">
            Speed
            <Select value={speed} onValueChange={changeSpeed}>
              <SelectTrigger className="h-9 w-[88px] rounded-full" aria-label="Playback speed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((s) => (
                  <SelectItem key={s} value={s}>{Number(s) * 100}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>
        {!isPlayerReady && !error && (
          <span className="flex items-center text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading sounds…
          </span>
        )}
      </div>

      {toolbar && <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">{toolbar}</div>}
      {notice && (
        <p role="status" className="border-b px-4 py-2 text-sm text-gh-yellow" data-testid="score-notice">
          {notice}
        </p>
      )}

      {neck && showNeck && (
        <div className="border-b bg-[#0d0c1b] px-4 py-2">
          <Fretboard
            strings={neck.strings}
            colors={STRING_COLORS}
            capo={neck.capo}
            frets={neck.frets}
            // Playing: the notes sounding (and the selected one). Paused with a note selected: that note alone.
            notes={
              chosen && !isPlaying
                ? [chosen]
                : [...playing.filter((n) => !chosen || n.string !== chosen.string || n.fret !== chosen.fret), ...(chosen ? [chosen] : [])]
            }
          />
        </div>
      )}

      {error && <p className="px-4 py-3 text-sm text-destructive">Could not render the score: {error}</p>}

      <div ref={scrollRef} className="relative max-h-[70vh] overflow-y-auto bg-[#0d0c1b]">
        {isRendering && (
          <div className="absolute inset-x-0 top-6 z-10 flex justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rendering score…
          </div>
        )}
        <div className="relative">
          {/* Notes can be dragged: no text selection. */}
          {column && selected && (
            <div aria-hidden className="pointer-events-none absolute rounded-xl bg-gh-yellow/[0.07]" style={{ left: column.x, top: column.y, width: column.w, height: column.h }} />
          )}
          {target && (
            <div
              aria-hidden
              data-testid="drag-target"
              className="pointer-events-none absolute rounded-xl border-2 border-dashed border-gh-yellow/50"
              style={{ left: target.x, top: target.y, width: target.w, height: target.h }}
            />
          )}
          <div ref={containerRef} className={`min-h-[300px] ${editable ? 'select-none' : ''}`} />
          {highlights.map((box, i) => (
            <div
              key={i}
              aria-hidden
              data-testid="selected-note"
              className="pointer-events-none absolute rounded-md border-2 border-gh-yellow shadow-[0_0_12px_2px_rgba(255,214,0,0.6)]"
              style={{ left: box.x - 4, top: box.y - 3, width: box.w + 8, height: box.h + 6 }}
            />
          ))}
          {dragTip && (
            // A lens on the dragged note, with what it becomes in large letters above it.
            <div aria-hidden className="pointer-events-none absolute z-20" style={{ left: dragTip.x, top: dragTip.y }}>
              <div className="absolute -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full border-2 border-gh-yellow/80 bg-[#0d0c1b]/40 shadow-[0_0_24px_4px_rgba(255,214,0,0.35)] backdrop-blur-[1px]" />
            </div>
          )}
          {dragTip && (
            <div
              role="status"
              data-testid="drag-tip"
              className="pointer-events-none absolute z-30 -translate-x-1/2 whitespace-nowrap text-center"
              style={{ left: dragTip.x, top: dragTip.y - 88 }}
            >
              <div className="font-display text-3xl leading-none text-gh-yellow drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{dragTip.text.split(' · ')[0]}</div>
              {dragTip.text.includes(' · ') && (
                <div className="mt-1 rounded-full bg-card/90 px-2 py-0.5 text-xs font-semibold text-foreground">{dragTip.text.split(' · ').slice(1).join(' · ')}</div>
              )}
            </div>
          )}
          {ghost && (
            <div
              aria-hidden
              data-testid="drag-ghost"
              className="pointer-events-none absolute rounded-full border-2 border-dashed border-gh-yellow bg-gh-yellow/30 shadow-[0_0_14px_2px_rgba(255,214,0,0.5)]"
              style={{ left: ghost.x - 3, top: ghost.y - 2, width: ghost.w + 6, height: ghost.h + 4 }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ScoreView;
