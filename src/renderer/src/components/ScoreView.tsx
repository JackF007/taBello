import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlphaTabApi, LayoutMode, LogLevel, model, NotationElement, PlayerMode, synth } from '@coderline/alphatab';
import { AudioLines, Loader2, Pause, Play, Repeat, Square, Timer, X } from 'lucide-react';
import Equalizer from '@/components/Equalizer';
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
  /** When set, clicking a note selects it instead of moving the cursor. */
  onNoteClick?: (location: NoteLocation) => void;
  /** Note to highlight. */
  selected?: NoteLocation | null;
  /** Extra controls for the transport bar. */
  controls?: ReactNode;
  /** An extra toolbar row below the transport bar. */
  toolbar?: ReactNode;
}

type Source = 'synth' | 'original';

const SPEEDS = ['0.5', '0.75', '1'];

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
const ScoreView = ({ tex, media = null, mediaOffset = 0, onNoteClick, selected = null, controls, toolbar }: ScoreViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const [source, setSource] = useState<Source>('synth');
  const [isRendering, setIsRendering] = useState(true);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [loop, setLoop] = useState(false);
  const [hasRange, setHasRange] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Box | null>(null);

  // Latest values for alphaTab callbacks, which are registered once per player.
  const texRef = useRef(tex);
  texRef.current = tex;
  const offsetRef = useRef(mediaOffset);
  offsetRef.current = mediaOffset;
  const noteClickRef = useRef(onNoteClick);
  noteClickRef.current = onNoteClick;
  const loadedTexRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const settingsRef = useRef({ metronome, loop, speed });
  settingsRef.current = { metronome, loop, speed };

  const updateHighlight = useCallback(() => {
    const api = apiRef.current;
    const location = selectedRef.current;
    const beat = location && api?.score?.tracks[0]?.staves[0]?.bars[location.bar]?.voices[0]?.beats[location.beat];
    const note = beat?.notes.find((n) => n.string - 1 === location!.string);
    // The tablature is rendered below the notation: its note bounds come last.
    const bounds = note && api?.boundsLookup?.findBeats(beat!)?.flatMap((b) => b.notes ?? []).filter((n) => n.note === note).at(-1);
    const box = bounds?.noteHeadBounds;
    setHighlight(box ? { x: box.x, y: box.y, w: box.w, h: box.h } : null);
  }, []);

  useEffect(updateHighlight, [selected, updateHighlight]);

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
      display: {
        layoutMode: LayoutMode.Page,
        scale: 0.9,
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
        soundFont: './assets/soundfont/sonivox.sf2',
        scrollElement: scrollRef.current,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableUserInteraction: true,
      },
    });
    api.scoreLoaded.on(colorTabByString);
    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => {
      setIsRendering(false);
      updateHighlight();
    });
    api.playerReady.on(() => {
      if (original) (api.player!.output as synth.IExternalMediaSynthOutput).handler = createMediaHandler(media, () => offsetRef.current);
      const { metronome: click, loop: looping, speed: rate } = settingsRef.current;
      api.metronomeVolume = click && !original ? 1 : 0;
      api.isLooping = looping;
      api.playbackSpeed = Number(rate);
      setIsPlayerReady(true);
    });
    api.playerStateChanged.on((e) => setIsPlaying(e.state === synth.PlayerState.Playing));
    api.playbackRangeChanged.on((e) => setHasRange(e.playbackRange !== null));
    api.noteMouseDown.on((note) => {
      noteClickRef.current?.({ bar: note.beat.voice.bar.index, beat: note.beat.index, string: note.string - 1 });
    });
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
  }, [source, media, updateHighlight]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || tex === loadedTexRef.current) return;
    setError(null);
    api.stop();
    loadedTexRef.current = tex;
    api.tex(tex);
  }, [tex]);

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
          onClick={() => apiRef.current?.stop()}
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

      {error && <p className="px-4 py-3 text-sm text-destructive">Could not render the score: {error}</p>}

      <div ref={scrollRef} className="relative max-h-[70vh] overflow-y-auto bg-[#0d0c1b]">
        {isRendering && (
          <div className="absolute inset-x-0 top-6 z-10 flex justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rendering score…
          </div>
        )}
        <div className="relative">
          <div ref={containerRef} className={`min-h-[300px] ${onNoteClick ? 'cursor-pointer' : ''}`} />
          {highlight && (
            <div
              aria-hidden
              data-testid="selected-note"
              className="pointer-events-none absolute rounded-md border-2 border-gh-yellow shadow-[0_0_12px_2px_rgba(255,214,0,0.6)]"
              style={{ left: highlight.x - 4, top: highlight.y - 3, width: highlight.w + 8, height: highlight.h + 6 }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ScoreView;
