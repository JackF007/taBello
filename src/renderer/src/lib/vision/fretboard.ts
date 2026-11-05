// Where the fretting hand is on the neck, from one video frame. The neck is found with plain image
// processing: the strings are the long parallel lines, the frets the thin wires across all of them,
// the nut the wide bright bar at one end; the frets are fitted to the physical rule that each fret
// is 2^(-1/12) closer to the next. The hand comes from MediaPipe (see handVision.ts): each fingertip
// on the neck then gets a fret.

/** A grayscale picture, values 0–255, row by row. */
export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Point {
  x: number;
  y: number;
}

export interface Neck {
  /** Angle of the strings in the picture, in radians (y grows downwards). */
  angle: number;
  /** Rows of the six strings in the straightened picture, top first. */
  strings: number[];
  /** Nut position and fret scale in the straightened picture, along the strings. */
  nut: number;
  scale: number;
  /** The headstock is on the left: frets are counted from the left instead. */
  mirrored: boolean;
  /** Fret wires found where the model expects them. */
  inliers: number;
}

const STRINGS = 6;
const MODEL_FRETS = 20;
/**
 * The neck must be in close-up: its first fret at least this share of the picture wide, and the
 * strings this share of its height apart. (Seen from across the room, frets and strings are too
 * small to tell apart, and a guitar body or an arm can pass for a neck.)
 */
const MIN_FIRST_FRET = 0.1;
const MIN_STRING_SPREAD = 0.2;
const MAX_STRING_SPREAD = 0.6;
/** Fret wires that must be found where the fret rule puts them. */
const MIN_INLIERS = 5;

export function grayFromRgba(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
  return { width, height, data };
}

const at = (g: Gray, x: number, y: number) => g.data[Math.min(g.height - 1, Math.max(0, y)) * g.width + Math.min(g.width - 1, Math.max(0, x))];

/** A 5×5 box blur: pixel steps along a slanted line would otherwise look like horizontal edges. */
function blur(g: Gray): Gray {
  const pass = (src: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -2; k <= 2; k++) {
          const xx = x + k * dx;
          const yy = y + k * dy;
          if (xx >= 0 && xx < g.width && yy >= 0 && yy < g.height) {
            sum += src[yy * g.width + xx];
            n++;
          }
        }
        out[y * g.width + x] = sum / n;
      }
    }
    return out;
  };
  return { width: g.width, height: g.height, data: pass(pass(g.data, 1, 0), 0, 1) };
}

function sobel(g: Gray): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(g.data.length);
  const gy = new Float32Array(g.data.length);
  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      const tl = at(g, x - 1, y - 1), t = at(g, x, y - 1), tr = at(g, x + 1, y - 1);
      const l = at(g, x - 1, y), r = at(g, x + 1, y);
      const bl = at(g, x - 1, y + 1), b = at(g, x, y + 1), br = at(g, x + 1, y + 1);
      gx[y * g.width + x] = tr + 2 * r + br - tl - 2 * l - bl;
      gy[y * g.width + x] = bl + 2 * b + br - tl - 2 * t - tr;
    }
  }
  return { gx, gy };
}

const percentile = (values: ArrayLike<number>, p: number) => {
  const sorted = Float32Array.from(values).sort();
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const smooth = (values: Float32Array, width: number) => {
  const out = new Float32Array(values.length);
  const half = Math.floor(width / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k < 0 || k >= values.length) continue;
      sum += values[k];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
};

const peaks = (profile: Float32Array, radius: number, threshold: number) => {
  const found: number[] = [];
  for (let i = radius; i < profile.length - radius; i++) {
    if (profile[i] <= threshold) continue;
    let top = true;
    // The first of equal values on a plateau is the peak.
    for (let k = i - radius; k <= i + radius && top; k++) if (profile[k] > profile[i] || (k < i && profile[k] === profile[i])) top = false;
    if (top) found.push(i);
  }
  return found;
};

/**
 * Directions the strings may run in: the strongest orientations of nearly horizontal edges, best
 * first (a shelf or a window frame can be as strong as the strings: each one is tried).
 */
export function stringAngles(g: Gray, count = 3): number[] {
  const { gx, gy } = sobel(blur(g));
  const magnitude = new Float32Array(gx.length);
  for (let i = 0; i < gx.length; i++) magnitude[i] = Math.hypot(gx[i], gy[i]);
  const strong = percentile(magnitude, 90);
  const bins = new Float32Array(181); // -45°..45° in half degrees
  for (let i = 0; i < gx.length; i++) {
    if (magnitude[i] < strong || magnitude[i] === 0) continue;
    // An edge runs across its gradient.
    let degrees = (Math.atan2(-gx[i], gy[i]) * 180) / Math.PI;
    if (degrees > 90) degrees -= 180;
    if (degrees <= -90) degrees += 180;
    if (Math.abs(degrees) > 45) continue;
    bins[Math.round((degrees + 45) * 2)] += magnitude[i];
  }
  const smoothed = smooth(bins, 3);
  const found: number[] = [];
  const order = Array.from(smoothed.keys()).sort((a, b) => smoothed[b] - smoothed[a]);
  for (const i of order) {
    if (found.length === count || smoothed[i] <= 0) break;
    // At least 3° from a direction already kept.
    if (found.every((j) => Math.abs(i - j) >= 6)) found.push(i);
  }
  return found.map((i) => ((i / 2 - 45) * Math.PI) / 180);
}

/** How sharp the strings are once straightened at `angle`: straight, each one falls on a single row. */
function rowSharpness(g: Gray, angle: number): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rows = new Float32Array(g.height);
  const counts = new Float32Array(g.height);
  const cx = g.width / 2;
  const cy = g.height / 2;
  // Vertical intensity changes, summed along the would-be rows (every other pixel is enough).
  for (let y = 1; y < g.height - 1; y += 2) {
    for (let x = 0; x < g.width; x += 2) {
      const d = Math.abs(g.data[(y + 1) * g.width + x] - g.data[(y - 1) * g.width + x]);
      const v = Math.round(cy - sin * (x - cx) + cos * (y - cy));
      if (v < 0 || v >= g.height) continue;
      rows[v] += d;
      counts[v] += 1;
    }
  }
  let sum = 0;
  for (let v = 0; v < g.height; v++) if (counts[v] > 0) sum += (rows[v] / counts[v]) ** 2;
  return sum;
}

/** The strings' angle refined within 2° of a first estimate, to a quarter of a degree. */
function refineAngle(g: Gray, angle: number): number {
  let best = angle;
  let bestScore = -1;
  for (let step = -8; step <= 8; step++) {
    const candidate = angle + (step * 0.25 * Math.PI) / 180;
    const score = rowSharpness(g, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** The picture turned so that the strings are horizontal (same size, nearest pixel). */
export function straighten(g: Gray, angle: number): Gray {
  const out = new Float32Array(g.data.length);
  const cx = g.width / 2;
  const cy = g.height / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let v = 0; v < g.height; v++) {
    for (let u = 0; u < g.width; u++) {
      const dx = u - cx;
      const dy = v - cy;
      const x = Math.round(cx + cos * dx - sin * dy);
      const y = Math.round(cy + sin * dx + cos * dy);
      out[v * g.width + u] = x >= 0 && x < g.width && y >= 0 && y < g.height ? g.data[y * g.width + x] : 0;
    }
  }
  return { width: g.width, height: g.height, data: out };
}

/** Where a point of the original picture lands in the straightened one. */
export function toStraight(p: Point, angle: number, width: number, height: number): Point {
  const dx = p.x - width / 2;
  const dy = p.y - height / 2;
  return { x: width / 2 + Math.cos(angle) * dx + Math.sin(angle) * dy, y: height / 2 - Math.sin(angle) * dx + Math.cos(angle) * dy };
}

/** Six string rows, roughly evenly spaced, among the strongest horizontal lines, and how many were seen. */
function stringRows(g: Gray): { rows: number[]; seen: number } | null {
  const profile = new Float32Array(g.height);
  for (let y = 1; y < g.height - 1; y++) {
    let sum = 0;
    for (let x = 0; x < g.width; x++) sum += Math.abs(at(g, x, y + 1) - at(g, x, y - 1));
    profile[y] = sum / g.width;
  }
  const p = smooth(profile, 3);
  const max = Math.max(...p);
  const candidates = peaks(p, 2, percentile(p, 85))
    .sort((a, b) => p[b] - p[a])
    .slice(0, 24)
    .sort((a, b) => a - b);
  let best: { score: number; rows: number[]; seen: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const gap = (candidates[j] - candidates[i]) / (STRINGS - 1);
      if (gap < 6) continue;
      let score = 0;
      let seen = 0;
      const rows: number[] = [];
      for (let k = 0; k < STRINGS; k++) {
        const target = candidates[i] + k * gap;
        const near = candidates.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
        if (Math.abs(near - target) > gap * 0.3) {
          score -= 1;
          rows.push(target);
        } else {
          score += p[near] / max;
          seen++;
          rows.push(near);
        }
      }
      if (!best || score > best.score) best = { score, rows, seen };
    }
  }
  return best && { rows: best.rows, seen: best.seen };
}

/**
 * Whether six rows look like the strings of a neck in close-up: (nearly) all of them seen, evenly
 * spaced (the perspective spreads them a little), and filling part of the picture, not all of it
 * (lines of a window, a shelf or a video's title card do not).
 */
function looksLikeStrings({ rows, seen }: { rows: number[]; seen: number }, height: number): boolean {
  const spread = rows[STRINGS - 1] - rows[0];
  const gaps = rows.slice(1).map((r, i) => r - rows[i]);
  return seen >= STRINGS - 1 && spread >= height * MIN_STRING_SPREAD && spread <= height * MAX_STRING_SPREAD && Math.max(...gaps) <= Math.min(...gaps) * 1.6;
}

/** Fret wires: columns where a vertical edge crosses the whole band of strings. */
function fretColumns(g: Gray, top: number, bottom: number): number[] {
  const profile = new Float32Array(g.width);
  const column: number[] = [];
  for (let x = 1; x < g.width - 1; x++) {
    column.length = 0;
    for (let y = Math.round(top); y <= Math.round(bottom); y++) column.push(Math.abs(at(g, x + 1, y) - at(g, x - 1, y)));
    // A low percentile across the strings: a fret crosses all of them, a finger only some.
    profile[x] = percentile(column, 40);
  }
  const p = smooth(profile, 5);
  return peaks(p, 6, percentile(p, 90));
}

/** The nut: the widest bright bar across the strings (a fret is a thin wire, the nut a block). */
function findNut(g: Gray, top: number, bottom: number): { from: number; to: number } | null {
  const bright = new Float32Array(g.width);
  const column: number[] = [];
  for (let x = 0; x < g.width; x++) {
    column.length = 0;
    for (let y = Math.round(top); y <= Math.round(bottom); y++) column.push(at(g, x, y));
    bright[x] = percentile(column, 30);
  }
  // Brighter than most of the board: halfway between its usual brightness and the brightest bar.
  const threshold = Math.max(percentile(bright, 97), (percentile(bright, 50) + Math.max(...bright)) / 2);
  let best: { from: number; to: number } | null = null;
  let start = -1;
  for (let x = 0; x <= g.width; x++) {
    const on = x < g.width && bright[x] >= threshold;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (!best || x - 1 - start > best.to - best.from) best = { from: start, to: x - 1 };
      start = -1;
    }
  }
  // Wider than a fret wire: at least 0.6% of the picture.
  return best && best.to - best.from >= Math.max(3, g.width * 0.006) ? best : null;
}

/** The scale that puts the frets where wires were found, counting from the nut. */
function fitScale(wires: number[], nut: number, width: number): { scale: number; inliers: number } | null {
  if (wires.length < 4) return null;
  let best: { score: number; scale: number; inliers: number } | null = null;
  for (let step = 0; step < 400; step++) {
    const scale = width * (0.15 + (step * (4 - 0.15)) / 399);
    const model: number[] = [];
    for (let n = 1; n < MODEL_FRETS; n++) {
      const x = nut - scale * (1 - 2 ** (-n / 12));
      if (x > 0) model.push(x);
    }
    if (model.length < 4) continue;
    const spacing = scale * (1 - 2 ** (-1 / 12));
    let inliers = 0;
    let off = 0;
    for (const w of wires) {
      const d = Math.min(...model.map((m) => Math.abs(m - w)));
      if (d < spacing * 0.12) {
        inliers += 1;
        off += d / spacing;
      }
    }
    const score = inliers - 0.02 * off;
    if (!best || score > best.score) best = { score, scale, inliers };
  }
  return best && { scale: best.scale, inliers: best.inliers };
}

/** The neck in a frame, when it is seen close enough to tell its frets apart; null otherwise. */
export function findNeck(g: Gray): Neck | null {
  let best: Neck | null = null;
  for (const rough of stringAngles(g)) {
    const neck = neckAlong(g, refineAngle(g, rough));
    if (neck && (!best || neck.inliers > best.inliers)) best = neck;
  }
  return best;
}

function neckAlong(g: Gray, angle: number): Neck | null {
  const straight = straighten(g, angle);
  const found = stringRows(straight);
  if (!found || !looksLikeStrings(found, g.height)) return null;
  const strings = found.rows;
  const top = strings[0];
  const bottom = strings[STRINGS - 1];
  const nutBar = findNut(straight, top, bottom);
  if (!nutBar) return null;
  const wires = fretColumns(straight, top, bottom);
  // The frets lie on the body's side of the nut, whichever end of the picture the headstock is at:
  // the side where they fit the fret rule best.
  let best: Neck | null = null;
  for (const mirrored of [false, true]) {
    const along = (x: number) => (mirrored ? straight.width - 1 - x : x);
    const nut = mirrored ? along(nutBar.to) : nutBar.from;
    const fit = fitScale(
      wires.map(along).filter((x) => x < nut - 5).sort((a, b) => a - b),
      nut,
      straight.width,
    );
    if (!fit || fit.inliers < MIN_INLIERS || fit.scale * (1 - 2 ** (-1 / 12)) < g.width * MIN_FIRST_FRET) continue;
    if (!best || fit.inliers > best.inliers) best = { angle, strings, nut, scale: fit.scale, mirrored, inliers: fit.inliers };
  }
  return best;
}

/**
 * The fret a fingertip presses, or null when it is off the neck (above or below the strings, on the
 * headstock, or past the 12th fret, where in a close-up it is the picking hand).
 */
export function fretAt(neck: Neck, tip: Point, width: number, height: number): number | null {
  const p = toStraight(tip, neck.angle, width, height);
  const spacing = (neck.strings[STRINGS - 1] - neck.strings[0]) / (STRINGS - 1);
  if (p.y < neck.strings[0] - spacing * 0.7 || p.y > neck.strings[STRINGS - 1] + spacing * 0.7) return null;
  const x = neck.mirrored ? width - 1 - p.x : p.x;
  const d = (neck.nut - x) / neck.scale;
  if (d < -0.02 || d >= 1) return null;
  // A finger presses just behind its fret wire.
  const fret = Math.floor(-12 * Math.log2(1 - Math.max(d, 1e-6))) + 1;
  return fret <= 12 ? fret : null;
}
