import { useEffect } from 'react';
import { tabello } from '@/lib/api';

// TaBello's menu music (scripts/generate-menu-music.ts), as in a game: it loops softly on the
// pages without a song and fades out while a song is transcribed or open, so it never plays over
// one. Web Audio loops the file without a gap, which an <audio> element does not.

const URL = 'sounds/menu-music.ogg';
const VOLUME = 0.35;
const FADE_IN = 2;
const FADE_OUT = 1.2;

let enabled = false;
let wanted = false;
let context: AudioContext | null = null;
let gain: GainNode | null = null;
let buffer: Promise<AudioBuffer> | null = null;
let source: AudioBufferSourceNode | null = null;

/** For the end-to-end tests: whether the music is playing. */
function mark(playing: boolean): void {
  document.documentElement.dataset.music = playing ? 'playing' : 'stopped';
}

async function start(): Promise<void> {
  context ??= new AudioContext();
  if (!gain) {
    gain = context.createGain();
    gain.connect(context.destination);
  }
  buffer ??= fetch(URL)
    .then((response) => response.arrayBuffer())
    .then((data) => context!.decodeAudioData(data));
  const audio = await buffer;
  // The page may have changed while the file was loading.
  if (!enabled || !wanted || source) return;
  await context.resume();
  source = context.createBufferSource();
  source.buffer = audio;
  source.loop = true;
  source.connect(gain);
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(VOLUME, now + FADE_IN);
  source.start();
  mark(true);
}

function stop(): void {
  if (!context || !gain || !source) return;
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
  source.stop(now + FADE_OUT);
  source = null;
  mark(false);
}

function update(): void {
  if (enabled && wanted) {
    // A sound that cannot play (no audio device) is no reason to complain.
    start().catch(() => mark(false));
  } else {
    stop();
  }
}

/** Turns the music on or off (the "Music" preference). */
export function setMusicEnabled(on: boolean): void {
  enabled = on;
  update();
}

/** At startup: the music plays unless the user turned it off. */
export async function initMusic(): Promise<void> {
  mark(false);
  if (!tabello) return;
  try {
    setMusicEnabled((await tabello.getPreferences()).music);
  } catch {
    // Without preferences, silence.
  }
}

/** Each page says whether the music fits it: yes in the menus, no with a song. */
export function useMenuMusic(fits: boolean): void {
  useEffect(() => {
    wanted = fits;
    update();
  }, [fits]);
}
