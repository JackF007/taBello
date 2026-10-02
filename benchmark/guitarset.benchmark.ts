// GuitarSet benchmark. Download GuitarSet (https://guitarset.weebly.com/, CC BY 4.0), then:
//   GUITARSET_DIR=/path/to/GuitarSet npm run benchmark
// Options: GUITARSET_LIMIT=20 (first N tracks), GUITARSET_FILTER=solo|comp|<substring>,
// GUITARSET_SENSITIVITY=low|normal|high, GUITARSET_AUDIO=audio_mono-mic (folder) with suffix _mic.wav.
import ffmpegPath from 'ffmpeg-static';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SENSITIVITIES, type Sensitivity } from '../src/shared/ipc';
import { benchmarkTrack, summarize, type TrackResult } from './guitarset/run';

const require = createRequire(import.meta.url);
const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};

const root = process.env.GUITARSET_DIR;
const audioFolder = process.env.GUITARSET_AUDIO ?? 'audio_mono-mic';
const suffix = audioFolder === 'audio_mono-mic' ? '_mic.wav' : audioFolder.includes('mix') ? '_mix.wav' : '_hex_cln.wav';
const sensitivity = (SENSITIVITIES as string[]).includes(process.env.GUITARSET_SENSITIVITY ?? '')
  ? (process.env.GUITARSET_SENSITIVITY as Sensitivity)
  : 'normal';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

describe.skipIf(!root)('GuitarSet benchmark', () => {
  it('measures transcription and fingering accuracy', async () => {
    const annotations = path.join(root!, 'annotation');
    let tracks = (await readdir(annotations)).filter((f) => f.endsWith('.jams')).sort();
    if (process.env.GUITARSET_FILTER) tracks = tracks.filter((t) => t.includes(process.env.GUITARSET_FILTER!));
    if (process.env.GUITARSET_LIMIT) tracks = tracks.slice(0, Number(process.env.GUITARSET_LIMIT));

    const results: TrackResult[] = [];
    for (const track of tracks) {
      const audioPath = path.join(root!, audioFolder, track.replace(/\.jams$/, suffix));
      if (!existsSync(audioPath)) {
        console.warn(`Skipping ${track}: no audio at ${audioPath}`);
        continue;
      }
      const result = await benchmarkTrack({ jamsPath: path.join(annotations, track), audioPath, ffmpegPath: ffmpegPath!, assets, sensitivity });
      results.push(result);
      console.log(`${result.track}: F1 ${percent(result.f1)}, strings ${percent(result.stringAccuracy)}`);
    }
    expect(results.length).toBeGreaterThan(0);

    const summary = summarize(results);
    console.table({
      precision: percent(summary.precision),
      recall: percent(summary.recall),
      'note F1': percent(summary.f1),
      'string accuracy (pipeline)': percent(summary.stringAccuracy),
      'string accuracy (fingering only)': percent(summary.fingeringAccuracy),
    });
    const out = path.join(import.meta.dirname, 'results');
    await mkdir(out, { recursive: true });
    const file = path.join(out, `guitarset-${sensitivity}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify({ audioFolder, sensitivity, summary, results }, null, 2));
    console.log(`Results written to ${file}`);
  });
});
