import { useEffect, useRef, useState } from 'react';
import { AlphaTabApi, LayoutMode, LogLevel, PlayerMode, synth } from '@coderline/alphatab';
import { Loader2, Pause, Play, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';

interface ScoreViewProps {
  /** alphaTex source of the score to render. */
  tex: string;
}

const SPEEDS = ['0.5', '0.75', '1'];

/** Renders notation + tablature with alphaTab and plays it back with the bundled soundfont. */
const ScoreView = ({ tex }: ScoreViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !scrollRef.current) return;
    // Relative paths: assets are bundled in public/assets and served from the app's own origin.
    const api = new AlphaTabApi(containerRef.current, {
      core: { logLevel: LogLevel.Warning, fontDirectory: './assets/font/' },
      display: { layoutMode: LayoutMode.Page, scale: 0.9 },
      player: {
        playerMode: PlayerMode.EnabledSynthesizer,
        soundFont: './assets/soundfont/sonivox.sf2',
        scrollElement: scrollRef.current,
        enableCursor: true,
        enableAnimatedBeatCursor: true,
      },
    });
    api.renderStarted.on(() => setIsRendering(true));
    api.renderFinished.on(() => setIsRendering(false));
    api.playerReady.on(() => setIsPlayerReady(true));
    api.playerStateChanged.on((e) => setIsPlaying(e.state === synth.PlayerState.Playing));
    api.error.on((e) => {
      console.error('alphaTab error', e);
      setError(e.message);
      setIsRendering(false);
    });
    apiRef.current = api;
    return () => {
      api.destroy();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    setError(null);
    api.stop();
    api.tex(tex);
  }, [tex]);

  const toggleMetronome = (on: boolean) => {
    setMetronome(on);
    if (apiRef.current) apiRef.current.metronomeVolume = on ? 1 : 0;
  };

  const changeSpeed = (value: string) => {
    setSpeed(value);
    if (apiRef.current) apiRef.current.playbackSpeed = Number(value);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button size="sm" onClick={() => apiRef.current?.playPause()} disabled={!isPlayerReady} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          <span className="ml-1">{isPlaying ? 'Pause' : 'Play'}</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => apiRef.current?.stop()} disabled={!isPlayerReady} aria-label="Stop">
          <Square className="h-4 w-4" />
        </Button>
        <Toggle size="sm" pressed={metronome} onPressedChange={toggleMetronome} aria-label="Metronome" disabled={!isPlayerReady}>
          <Timer className="h-4 w-4 mr-1" /> Metronome
        </Toggle>
        <div className="flex items-center gap-2 ml-auto text-sm text-muted-foreground">
          Speed
          <Select value={speed} onValueChange={changeSpeed}>
            <SelectTrigger className="h-8 w-[84px]" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SPEEDS.map((s) => (
                <SelectItem key={s} value={s}>{Number(s) * 100}%</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isPlayerReady && !error && (
          <span className="flex items-center text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Loading sounds…
          </span>
        )}
      </div>

      {error && <p className="px-4 py-3 text-sm text-destructive">Could not render the score: {error}</p>}

      <div ref={scrollRef} className="relative max-h-[70vh] overflow-y-auto bg-white">
        {isRendering && (
          <div className="absolute inset-x-0 top-4 flex justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rendering score…
          </div>
        )}
        <div ref={containerRef} className="min-h-[300px]" />
      </div>
    </div>
  );
};

export default ScoreView;
