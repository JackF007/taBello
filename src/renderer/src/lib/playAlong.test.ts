import { describe, expect, it } from 'vitest';
import { createMediaHandler, mediaTimeToScore, scoreTimeToMedia } from './playAlong';

describe('play along', () => {
  it('maps recording time to score time and back, at any speed', () => {
    expect(mediaTimeToScore(12.5, 2.5, 1)).toBe(10_000);
    expect(mediaTimeToScore(12.5, 2.5, 0.5)).toBe(20_000);
    expect(scoreTimeToMedia(20_000, 2.5, 0.5)).toBe(12.5);
    // Before bar 1 the score stays at its start.
    expect(mediaTimeToScore(1, 2.5, 1)).toBe(0);
  });

  it('drives the media element', () => {
    const media = { duration: 60, currentTime: 0, playbackRate: 1, volume: 1, preservesPitch: false } as HTMLMediaElement;
    const handler = createMediaHandler(media, () => 2);
    handler.playbackRate = 0.75;
    expect(media.playbackRate).toBe(0.75);
    expect(media.preservesPitch).toBe(true);
    handler.seekTo(4000);
    expect(media.currentTime).toBeCloseTo(5);
    expect(handler.backingTrackDuration).toBeCloseTo((58 * 1000) / 0.75);
  });
});
