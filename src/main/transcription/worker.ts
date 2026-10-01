// Entry point of the transcription utility process: one process per job,
// so the heavy decoding and inference never block the main process, and cancelling is a kill.
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { MAX_SEPARATION_SECONDS } from '../../shared/ipc';
import { INSTRUMENTS } from '../../shared/instruments';
import { DEMUCS_SAMPLE_RATE, halveSampleRate, separateSource } from '../separation/demucs';
import type { WorkerMessage, WorkerRequest } from './messages';
import { decodeAudio, detectNotes, PipelineError, SAMPLE_RATE } from './pipeline';

const post = (message: WorkerMessage) => process.parentPort.postMessage(message);

// Copied next to the bundled worker at build time (see electron.vite.config.ts).
const ASSETS_DIR = path.join(import.meta.dirname, 'transcription-assets');
// ONNX Runtime starts its threads from these files, which cannot run from inside app.asar.
const ORT_DIR = path.join(ASSETS_DIR, 'ort').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const progress = (stage: 'extracting' | 'separating' | 'transcribing') => (fraction: number) =>
  post({ type: 'progress', progress: { stage, fraction } });

/** Decodes the recording for Basic Pitch, isolating one instrument first when asked. */
async function loadAudio(data: WorkerRequest): Promise<Float32Array> {
  if (!data.separation) return decodeAudio(data.ffmpegPath, data.inputPath, { onProgress: progress('extracting') });

  // Demucs works on stereo 44.1 kHz audio.
  const stereo = await decodeAudio(data.ffmpegPath, data.inputPath, {
    sampleRate: DEMUCS_SAMPLE_RATE,
    channels: 2,
    maxSeconds: MAX_SEPARATION_SECONDS,
    onProgress: progress('extracting'),
  });
  const frames = stereo.length / 2;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = stereo[2 * i];
    right[i] = stereo[2 * i + 1];
  }
  progress('separating')(0);
  const isolated = await separateSource(left, right, data.separation.source, {
    modelPath: data.separation.modelPath,
    wasmDir: ORT_DIR,
    threads: Math.min(8, availableParallelism()),
    onProgress: progress('separating'),
  });
  return halveSampleRate(isolated);
}

process.parentPort.once('message', async ({ data }: { data: WorkerRequest }) => {
  try {
    const audio = await loadAudio(data);

    const { minHz, maxHz } = INSTRUMENTS[data.instrument];
    progress('transcribing')(0);
    const notes = await detectNotes(audio, {
      assets: { wasmDir: path.join(ASSETS_DIR, 'wasm'), modelDir: path.join(ASSETS_DIR, 'model') },
      minHz,
      maxHz,
      sensitivity: data.sensitivity,
      onProgress: progress('transcribing'),
    });

    post({ type: 'result', notes, durationSeconds: audio.length / SAMPLE_RATE });
  } catch (error) {
    if (error instanceof PipelineError) {
      post({ type: 'error', code: error.code, message: error.message });
    } else {
      post({ type: 'error', code: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }
});
