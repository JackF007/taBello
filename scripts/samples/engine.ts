// Runs a sample through the whole engine, as the app does: transcription, then tempo, meter,
// tuning and capo detection, then the arrangement.
import ffmpegPath from 'ffmpeg-static';
import { createRequire } from 'node:module';
import path from 'node:path';
import { decodeAudio, detectNotes } from '../../src/main/transcription/pipeline';
import { INSTRUMENTS, type InstrumentId } from '../../src/shared/instruments';
import type { NoteEvent } from '../../src/shared/ipc';
import { getSample } from '../../src/shared/samples';
import { arrange, detectCapo, detectTuning } from '../../src/renderer/src/lib/music/arrange';
import { detectTempoChanges } from '../../src/renderer/src/lib/music/tempo';
import { detectKey, detectMeter, estimateTempo } from '../../src/renderer/src/lib/music/theory';

const require = createRequire(import.meta.url);
export const assets = {
  wasmDir: path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')),
  modelDir: path.join(path.dirname(require.resolve('@spotify/basic-pitch/package.json')), 'model'),
};
export const samplePath = (id: string) => path.join(import.meta.dirname, '../../resources/samples', getSample(id)!.file);

export async function transcribeSample(id: string) {
  const sample = getSample(id)!;
  const audio = await decodeAudio(ffmpegPath!, samplePath(id));
  return { sample, ...(await transcribeAudio(audio, sample.instrument)) };
}

/** The engine on 22.05 kHz mono audio. */
export async function transcribeAudio(audio: Float32Array, instrumentId: InstrumentId, options: { tempoScale?: number; notes?: NoteEvent[] } = {}) {
  const instrument = INSTRUMENTS[instrumentId];
  const notes = options.notes ?? (await detectNotes(audio, { assets, minHz: instrument.minHz, maxHz: instrument.maxHz }));
  const estimate = estimateTempo(notes);
  // As with the ½× and 2× buttons.
  const tempo = { ...estimate, bpm: estimate.bpm * (options.tempoScale ?? 1) };
  const steady = detectMeter(notes, tempo);
  const changes = detectTempoChanges(notes, tempo.bpm);
  const beats = changes.variable ? changes.beats : undefined;
  const meter = beats ? detectMeter(notes, tempo, beats) : steady;
  const timing = { bpm: tempo.bpm, offset: steady.offset, beats, meter: meter.meter, barPhase: meter.barPhase };
  const tuning = detectTuning(notes, instrument.tunings, { frets: instrument.frets, ...timing });
  const capo = detectCapo(notes, { tuning: tuning.strings, frets: instrument.frets, ...timing }, 9);
  const arrangement = arrange(notes, { tuning: tuning.strings, frets: instrument.frets, ...timing, capo });
  const techniques = arrangement.bars.flat().flatMap((b) => b.notes).flatMap((n) => Object.keys(n.techniques ?? {}));
  return { instrument, notes, tempo, meter, changes, tuning, capo, key: detectKey(notes), arrangement, techniques };
}
