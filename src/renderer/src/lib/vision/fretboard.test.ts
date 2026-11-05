import { describe, expect, it } from 'vitest';
import { findNeck, fretAt, toStraight, type Gray, type Point } from './fretboard';

const WIDTH = 640;
const HEIGHT = 360;

/**
 * A close-up of a neck, drawn: six strings across the picture at `degrees`, fret wires at their
 * physical spacing, a wide bright nut near the right (or the left when mirrored).
 */
function drawNeck(degrees: number, mirrored = false): { picture: Gray; fretCenter: (fret: number, string: number) => Point } {
  const angle = (degrees * Math.PI) / 180;
  const data = new Float32Array(WIDTH * HEIGHT).fill(40);
  const top = 130;
  const gap = 22;
  const nut = 560;
  const scale = 1400;
  const wires = Array.from({ length: 12 }, (_, i) => nut - scale * (1 - 2 ** (-(i + 1) / 12)));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const p = toStraight({ x, y }, angle, WIDTH, HEIGHT);
      const u = mirrored ? WIDTH - 1 - p.x : p.x;
      if (p.y < top - 8 || p.y > top + 5 * gap + 8 || u > nut + 60) continue;
      // Soft edges, as a camera sees them (hard pixel steps along a slant would look like flat edges).
      const line = (distance: number, half: number) => Math.max(0, Math.min(1, half + 0.5 - Math.abs(distance)));
      let value = 70; // the fingerboard
      value = Math.max(value, 70 + 180 * line(u - (nut + 7), 7));
      for (const w of wires) value = Math.max(value, 70 + 145 * line(u - w, 1));
      for (let s = 0; s < 6; s++) value = Math.max(value, 70 + 120 * line(p.y - (top + s * gap), 0.8));
      data[y * WIDTH + x] = value;
    }
  }
  // Where a finger presses `fret` on string row `string`: midway between the wires.
  const fretCenter = (fret: number, string: number): Point => {
    const before = fret === 1 ? nut : wires[fret - 2];
    const u = (before + wires[fret - 1]) / 2;
    const sx = mirrored ? WIDTH - 1 - u : u;
    const sy = top + string * gap;
    // Back to the picture: the inverse of toStraight.
    const dx = sx - WIDTH / 2;
    const dy = sy - HEIGHT / 2;
    return { x: WIDTH / 2 + Math.cos(angle) * dx - Math.sin(angle) * dy, y: HEIGHT / 2 + Math.sin(angle) * dx + Math.cos(angle) * dy };
  };
  return { picture: { width: WIDTH, height: HEIGHT, data }, fretCenter };
}

describe('findNeck', () => {
  it('finds a tilted neck, its strings, its nut and its frets', () => {
    const { picture, fretCenter } = drawNeck(8);
    const neck = findNeck(picture)!;
    expect(neck).not.toBeNull();
    expect((neck.angle * 180) / Math.PI).toBeCloseTo(8, 0);
    expect(neck.mirrored).toBe(false);
    expect(neck.inliers).toBeGreaterThanOrEqual(6);
    for (const fret of [1, 2, 3, 5, 7]) expect(fretAt(neck, fretCenter(fret, 2), WIDTH, HEIGHT)).toBe(fret);
  });

  it('counts frets from the left when the headstock is on the left', () => {
    const { picture, fretCenter } = drawNeck(-5, true);
    const neck = findNeck(picture)!;
    expect(neck.mirrored).toBe(true);
    expect(fretAt(neck, fretCenter(2, 1), WIDTH, HEIGHT)).toBe(2);
    expect(fretAt(neck, fretCenter(4, 4), WIDTH, HEIGHT)).toBe(4);
  });

  it('leaves out fingertips off the neck, and pictures without one', () => {
    const { picture } = drawNeck(8);
    const neck = findNeck(picture)!;
    expect(fretAt(neck, { x: 300, y: 20 }, WIDTH, HEIGHT)).toBeNull();
    expect(findNeck({ width: WIDTH, height: HEIGHT, data: new Float32Array(WIDTH * HEIGHT).fill(90) })).toBeNull();
  });

  it('does not take the lines of a whole picture (a title card, a shelf) for strings', () => {
    const data = new Float32Array(WIDTH * HEIGHT).fill(40);
    const rows = [12, 75, 140, 200, 275, 340];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const nearRow = rows.some((r) => Math.abs(y - r) < 1.5);
        const nearColumn = [100, 180, 270, 370, 480, 560].some((c) => Math.abs(x - c) < 1.5) || (x > 590 && x < 605);
        if (nearRow || nearColumn) data[y * WIDTH + x] = 220;
      }
    }
    expect(findNeck({ width: WIDTH, height: HEIGHT, data })).toBeNull();
  });
});
