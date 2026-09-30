// Entry point of the transcription utility process: one process per job,
// so the heavy decoding and inference never block the main process, and cancelling is a kill.
import path from 'node:path';
import { INSTRUMENTS } from '../../shared/instruments';
import type { WorkerMessage, WorkerRequest } from './messages';
import { decodeAudio, detectNotes, PipelineError, SAMPLE_RATE } from './pipeline';

const post = (message: WorkerMessage) => process.parentPort.postMessage(message);

// Copied next to the bundled worker at build time (see electron.vite.config.ts).
const ASSETS_DIR = path.join(import.meta.dirname, 'transcription-assets');

process.parentPort.once('message', async ({ data }: { data: WorkerRequest }) => {
  try {
    const audio = await decodeAudio(data.ffmpegPath, data.inputPath, {
      onProgress: (fraction) => post({ type: 'progress', progress: { stage: 'extracting', fraction } }),
    });

    const { minHz, maxHz } = INSTRUMENTS[data.instrument];
    post({ type: 'progress', progress: { stage: 'transcribing', fraction: 0 } });
    const notes = await detectNotes(audio, {
      assets: { wasmDir: path.join(ASSETS_DIR, 'wasm'), modelDir: path.join(ASSETS_DIR, 'model') },
      minHz,
      maxHz,
      sensitivity: data.sensitivity,
      onProgress: (fraction) => post({ type: 'progress', progress: { stage: 'transcribing', fraction } }),
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
