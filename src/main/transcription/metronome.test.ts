import { describe, expect, it } from 'vitest';
import { removeMetronome } from './metronome';
import { RATE, renderStrings } from './testing/strings';

/** A digital click: the same short burst every time (an accent is higher). */
function click(accent: boolean): Float32Array {
  const out = new Float32Array(Math.round(0.02 * RATE));
  const f = accent ? 3500 : 2500;
  for (let i = 0; i < out.length; i++) out[i] = 0.08 * Math.sin((2 * Math.PI * f * i) / RATE) * Math.exp(-i / (0.004 * RATE));
  return out;
}

const PERIOD = 0.6;
const FIRST_CLICK = 0.3;
// A two-click count-in, then an arpeggio in 8ths from the third beat.
const guitar = Array.from({ length: 48 }, (_, i) => ({ start: FIRST_CLICK + 2 * PERIOD + i * 0.3, duration: 0.6, pitch: [45, 52, 57, 60][i % 4], amplitude: 0.4 }));
const seconds = FIRST_CLICK + 2 * PERIOD + 48 * 0.3 + 1;

function withClicks(): { audio: Float32Array; beats: number[] } {
  const audio = renderStrings(guitar, seconds);
  const beats: number[] = [];
  for (let k = 0; FIRST_CLICK + PERIOD * k < seconds - 0.5; k++) {
    const at = Math.round((FIRST_CLICK + PERIOD * k) * RATE);
    // The first beat of each bar (from the guitar's first bar) is accented.
    const sound = click(k >= 2 && (k - 2) % 4 === 0);
    for (let i = 0; i < sound.length; i++) audio[at + i] += sound[i];
    beats.push(FIRST_CLICK + PERIOD * k);
  }
  return { audio, beats };
}

describe('metronome', () => {
  it('finds a click track, with its accent, and takes it out', () => {
    const { audio, beats } = withClicks();
    const { audio: clean, metronome } = removeMetronome(audio, RATE);
    expect(metronome).not.toBeNull();
    expect(metronome!.period).toBeCloseTo(PERIOD, 3);
    const found = beats.filter((b) => metronome!.clicks.some((c) => Math.abs(c - b) < 0.002));
    expect(found.length).toBeGreaterThanOrEqual(beats.length * 0.9);
    // The count-in clicks, heard alone, are gone.
    const energy = (x: Float32Array, t: number) => x.subarray(Math.round(t * RATE), Math.round((t + 0.02) * RATE)).reduce((s, v) => s + v * v, 0);
    expect(10 * Math.log10(energy(clean, FIRST_CLICK) / energy(audio, FIRST_CLICK))).toBeLessThan(-15);
  });

  it('leaves a recording without a metronome alone', () => {
    const audio = renderStrings(guitar, seconds);
    const result = removeMetronome(audio, RATE);
    expect(result.metronome).toBeNull();
    expect(result.audio).toBe(audio);
  });
});
