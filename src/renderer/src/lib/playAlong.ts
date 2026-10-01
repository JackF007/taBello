// Plays the score along with the original recording: alphaTab follows the media element's clock.
// The score starts at `offset` seconds into the recording and runs at a constant tempo.
import type { synth } from '@coderline/alphatab';

/**
 * alphaTab measures playback time in real time at the current speed (at 50% speed, the score's
 * 10th second is reached after 20 s), while the media element's clock is in recording time.
 */
export function mediaTimeToScore(mediaSeconds: number, offset: number, speed: number): number {
  return Math.max(0, ((mediaSeconds - offset) * 1000) / speed);
}

export function scoreTimeToMedia(scoreMilliseconds: number, offset: number, speed: number): number {
  return Math.max(0, offset + (scoreMilliseconds * speed) / 1000);
}

/** Media control handed to alphaTab's external-media player. */
export function createMediaHandler(
  media: HTMLMediaElement,
  getOffset: () => number,
): synth.IExternalMediaHandler {
  return {
    get backingTrackDuration() {
      return Number.isFinite(media.duration) ? mediaTimeToScore(media.duration, getOffset(), media.playbackRate) : 0;
    },
    get playbackRate() {
      return media.playbackRate;
    },
    set playbackRate(value: number) {
      // Slowing down keeps the pitch (the browser's default, made explicit).
      media.preservesPitch = true;
      media.playbackRate = value;
    },
    get masterVolume() {
      return media.volume;
    },
    set masterVolume(value: number) {
      media.volume = Math.min(1, Math.max(0, value));
    },
    seekTo(time: number) {
      media.currentTime = scoreTimeToMedia(time, getOffset(), media.playbackRate);
    },
    play() {
      void media.play().catch(() => undefined);
    },
    pause() {
      media.pause();
    },
  };
}
