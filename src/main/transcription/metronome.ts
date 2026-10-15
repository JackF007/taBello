// Metronome clicks: lessons and home recordings are often played to a click track. A digital click
// is the same sound every time, so it can be found — a sound repeating identically, beat after beat
// — and subtracted from the recording, leaving the guitar alone. Left in, it puts a "pick click" on
// every beat, which misleads the attack measurements (picked or legato, a string picked again).

/** Length of the click template (seconds): a digital click lasts about 20 ms. */
const TEMPLATE_SECONDS = 0.03;
/** Correlation between two clicks heard alone for them to be the same sound. */
const SAME_CLICK = 0.9;
/** A metronome needs this many clicks, and found on this share of its beats. */
const MIN_CLICKS = 8;
const MIN_FOUND = 0.5;

export interface Metronome {
  /** Times of the clicks (seconds). */
  clicks: number[];
  /** The clicks that sound different (an accent: the first beat of each bar). */
  accents: number[];
  /** Clicks left in the audio (an accent never heard alone): their attack is the metronome's. */
  remaining: number[];
  /** Beat period (seconds). */
  period: number;
}

/** First difference: the high frequencies, where a click stands out over a guitar. */
function highPass(audio: Float32Array): Float32Array {
  const out = new Float32Array(audio.length);
  for (let i = 1; i < audio.length; i++) out[i] = audio[i] - audio[i - 1];
  return out;
}

/** Samples where the high frequencies jump out of near silence: clicks heard alone, pick attacks. */
function transients(hp: Float32Array, rate: number): number[] {
  const hop = Math.round(rate * 0.002);
  const energy: number[] = [];
  for (let i = 0; i + hop < hp.length; i += hop) {
    let sum = 0;
    for (let k = 0; k < hop; k++) sum += hp[i + k] * hp[i + k];
    energy.push(sum);
  }
  const peaks: number[] = [];
  for (let f = 3; f < energy.length; f++) {
    const before = Math.max(energy[f - 3], energy[f - 2], 1e-12);
    if (energy[f] > before * 8 && energy[f] >= energy[f - 1] && energy[f] > 1e-7) {
      const at = f * hop;
      if (peaks.length === 0 || at - peaks[peaks.length - 1] > rate * 0.05) peaks.push(at);
    }
  }
  return peaks;
}

/** Best normalized correlation of `signal` with `template` starting within [from, to]. */
function bestMatch(signal: Float32Array, template: Float32Array, from: number, to: number): { value: number; at: number } {
  let tt = 0;
  for (const v of template) tt += v * v;
  let best = { value: -1, at: from };
  for (let start = Math.max(0, from); start <= to && start + template.length <= signal.length; start++) {
    let xt = 0;
    let xx = 0;
    for (let i = 0; i < template.length; i++) {
      const v = signal[start + i];
      xt += v * template[i];
      xx += v * v;
    }
    const value = xx > 0 && tt > 0 ? xt / Math.sqrt(xx * tt) : 0;
    if (value > best.value) best = { value, at: start };
  }
  return best;
}

/**
 * Finds a metronome and subtracts its clicks. Returns the cleaned audio (a copy) and the clicks, or
 * the audio unchanged and null when there is no metronome.
 */
export function removeMetronome(audio: Float32Array, rate: number): { audio: Float32Array; metronome: Metronome | null } {
  const none = { audio, metronome: null };
  const length = Math.round(TEMPLATE_SECONDS * rate);
  const hp = highPass(audio);
  // (The first sounds heard alone are enough: a click track usually starts with a count-in.) A click
  // is over at once: right after it, the sound has died away, unlike a string.
  const window = (at: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += (hp[at + i] ?? 0) ** 2;
    return sum;
  };
  const candidates = transients(hp, rate)
    .filter((at) => window(at + length) < window(at) * 0.05)
    .slice(0, 60);
  if (candidates.length < 2) return none;

  // The click: among the sounds heard alone, one that repeats identically (pick attacks never do).
  const slack = Math.round(rate * 0.001);
  let group: { at: number; value: number }[] = [];
  for (const a of candidates) {
    const reference = hp.subarray(Math.max(0, a - slack), Math.max(0, a - slack) + length);
    if (reference.length < length) continue;
    const members = candidates
      .map((b) => bestMatch(hp, reference, b - 2 * slack, b + slack))
      .filter((m) => m.value >= SAME_CLICK);
    if (members.length > group.length) group = members;
  }
  if (group.length < 2) return none;
  group.sort((a, b) => a.at - b.at);
  // The beat: the shortest interval between two of these clicks that the others are multiples of.
  // (Only nearby clicks: a video can be cut between them.)
  const gaps = group.slice(1).map((m, i) => m.at - group[i].at).filter((g) => g > rate * 0.25 && g < rate * 3);
  if (gaps.length === 0) return none;
  const shortest = Math.min(...gaps);
  const fits = gaps.filter((g) => Math.abs(g / shortest - Math.round(g / shortest)) < 0.02).length;
  if (fits < gaps.length * 0.8) return none;
  const period = shortest / Math.max(1, Math.round(shortest / (rate * 1.5)));
  const average = (signal: Float32Array, positions: number[]) => {
    const out = new Float32Array(length);
    for (const at of positions) for (let i = 0; i < length; i++) out[i] += (signal[at + i] ?? 0) / positions.length;
    return out;
  };
  const energy = (t: Float32Array) => t.reduce((sum, v) => sum + v * v, 0);
  // How much of a click is at a position (1 = exactly one click): stable under a guitar playing,
  // unlike a correlation, since the guitar is not correlated with the click.
  const level = (t: Float32Array, tt: number, at: number) => {
    let xt = 0;
    for (let i = 0; i < length; i++) xt += (hp[at + i] ?? 0) * t[i];
    return xt / tt;
  };
  const clickAround = (t: Float32Array, tt: number, expected: number, slackSamples: number) => {
    let best = { level: -Infinity, at: expected };
    for (let at = Math.max(0, expected - slackSamples); at <= expected + slackSamples && at + length <= hp.length; at++) {
      const l = level(t, tt, at);
      if (l > best.level) best = { level: l, at };
    }
    return best;
  };
  // (Loose: a note picked on the same beat adds its own high frequencies.)
  const isClick = (l: number) => l >= 0.5 && l <= 2;

  // Follow the beat through the recording, both ways from the first click: a metronome keeps time
  // exactly, so each beat is where the last one says, within a millisecond. Beats without this click
  // are kept apart: a metronome often sounds another click on the first beat of the bar. When the beat
  // is lost (a pause, a cut in a video), look for the click again further on.
  const hpClick = average(hp, group.map((m) => m.at));
  const clickEnergy = energy(hpClick);
  const exact = Math.max(1, Math.round(rate * 0.001));
  const found = new Set<number>(group.map((m) => m.at));
  const others: number[] = [];
  const resync = (from: number): number | null => {
    for (let at = from; at + 3 * period + length < hp.length; at++) {
      if (!isClick(level(hpClick, clickEnergy, at))) continue;
      // Two of the next three beats (one may be the accent).
      const next = [1, 2, 3].filter((k) => isClick(clickAround(hpClick, clickEnergy, Math.round(at + k * period), exact).level)).length;
      if (next >= 2) return at;
    }
    return null;
  };
  const follow = (start: number, direction: 1 | -1) => {
    let at = start;
    let missed: number[] = [];
    for (let beat = 1; ; beat++) {
      const expected = Math.round(at + direction * period * (missed.length + 1));
      if (expected < 0 || expected + length > audio.length) return;
      const click = clickAround(hpClick, clickEnergy, expected, exact);
      if (isClick(click.level)) {
        found.add(click.at);
        others.push(...missed);
        at = click.at;
        missed = [];
      } else {
        missed.push(expected);
        if (missed.length >= 8) {
          // Lost (a pause, a cut): find the click again further on — a click whose next beats have it
          // too, a rhythm the guitar cannot imitate.
          if (direction < 0) return;
          const again = resync(expected);
          if (again === null) return;
          found.add(again);
          at = again;
          missed = [];
        }
      }
    }
  };
  follow(group[0].at, 1);
  follow(group[0].at, -1);


  // The other click (an accented first beat): the average of the beats without the first click,
  // where the guitar averages out and a click shows. Kept only if it is found at those beats.
  const accents: number[] = [];
  let accent = false;
  if (others.length >= 4) {
    const hpAccent = average(hp, others);
    const accentEnergy = energy(hpAccent);
    if (accentEnergy > clickEnergy * 0.05) {
      // The average is weaker than one accent where some of those beats had none (pauses): the
      // accents are the beats at the level most of them share.
      const levels = others.map((expected) => clickAround(hpAccent, accentEnergy, expected, exact));
      const strong = levels.map((l) => l.level).filter((l) => l > 0.3).sort((a, b) => a - b);
      const typical = strong[strong.length >> 1] ?? 1;
      // An accent sounds like the accent, not like the other click (missed under a strum).
      for (const click of levels) {
        if (!isClick(click.level / typical)) continue;
        const asAccent = bestMatch(hp, hpAccent, click.at, click.at).value;
        const asClick = bestMatch(hp, hpClick, click.at - exact, click.at + exact).value;
        if (asAccent > asClick) accents.push(click.at);
      }
      if (accents.length >= Math.max(3, others.length * 0.2)) accent = true;
      else accents.length = 0;
    }
  }

  // One position per click (the same click can be found a sample apart from both directions).
  const unique = (positions: number[]) =>
    [...positions].sort((a, b) => a - b).filter((at, i, all) => i === 0 || at - all[i - 1] > rate * 0.005);
  const regular = unique([...found]);
  const accented = unique(accents).filter((at) => !regular.some((r) => Math.abs(r - at) <= rate * 0.005));
  const sorted = unique([...regular, ...accented]);
  // The beat, precisely: each interval between clicks a few beats apart, divided by its beats.
  const perBeat = sorted
    .slice(1)
    .map((at, i) => at - sorted[i])
    .filter((gap) => gap < 4.5 * period)
    .map((gap) => gap / Math.max(1, Math.round(gap / period)))
    .sort((a, b) => a - b);
  const beatPeriod = perBeat.length ? perBeat[perBeat.length >> 1] : period;
  const span = (sorted[sorted.length - 1] - sorted[0]) / period + 1;
  if (sorted.length < MIN_CLICKS || sorted.length < span * MIN_FOUND) return none;

  // Subtract each click at its own level, measured in the high frequencies where it stands out. The
  // click's sound is taken where it was heard alone (a guitar on the beat would be part of an average
  // over all beats); an accent never heard alone is only located, not subtracted.
  const quietest = (positions: number[]) => {
    const lowEnergy = (at: number) => {
      let sum = 0;
      for (let i = 0; i < length; i++) sum += (audio[at + i] ?? 0) ** 2 - (hp[at + i] ?? 0) ** 2 / 4;
      return sum;
    };
    const ranked = [...positions].sort((a, b) => lowEnergy(a) - lowEnergy(b)).slice(0, 4);
    const reference = average(hp, ranked.slice(0, 1));
    return ranked.filter((at) => bestMatch(hp, reference, at, at).value >= SAME_CLICK);
  };
  const clean = Float32Array.from(audio);
  const subtract = (positions: number[], raw: Float32Array, hpT: Float32Array) => {
    const tt = energy(hpT);
    for (const position of positions) {
      // Aligned to the sample: a click a sample off would be left half in.
      const { at, level: gain } = clickAround(hpT, tt, position, 2);
      const g = Math.max(0, Math.min(1.5, gain));
      for (let i = 0; i < length && at + i < clean.length; i++) clean[at + i] -= g * raw[i];
    }
  };
  const alone = group.map((m) => m.at);
  subtract(regular, average(audio, alone), average(hp, alone));
  const accentAlone = accent ? quietest(accented) : [];
  const subtracted = accentAlone.length >= 2;
  if (subtracted) subtract(accented, average(audio, accentAlone), average(hp, accentAlone));
  // Click times: where the sound starts within the windows (they begin a little before).
  const sound = average(audio, alone);
  const peak = Math.max(...sound.map(Math.abs));
  const onset = Math.max(0, sound.findIndex((v) => Math.abs(v) >= peak * 0.1));
  const time = (at: number) => (at + onset) / rate;
  return {
    audio: clean,
    metronome: { clicks: sorted.map(time), accents: accented.map(time), remaining: subtracted ? [] : accented.map(time), period: beatPeriod / rate },
  };
}
