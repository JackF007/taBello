// Benchmarks TaBello on GuitarSet tracks: transcription accuracy and string (fingering) accuracy.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { NoteEvent, Sensitivity } from '../../src/shared/ipc';
import { INSTRUMENTS } from '../../src/shared/instruments';
import { decodeAudio, detectNotes, type ModelAssets } from '../../src/main/transcription/pipeline';
import { arrange } from '../../src/renderer/src/lib/music/arrange';
import { estimateTempo } from '../../src/renderer/src/lib/music/theory';
import { parseJams } from './jams';
import { matchNotes, noteScores, stringAccuracy, type Scores } from './metrics';

export interface TrackResult extends Scores {
  track: string;
  referenceNotes: number;
  detectedNotes: number;
  /** String accuracy of the full pipeline, on correctly detected notes. */
  stringAccuracy: number;
  /** String accuracy of the fingering alone, arranging the reference notes. */
  fingeringAccuracy: number;
}

const guitar = INSTRUMENTS.guitar;
// GuitarSet is recorded in standard tuning, without capo.
const standard = guitar.tunings[0].strings;

function arrangeNotes(notes: NoteEvent[]) {
  const tempo = estimateTempo(notes);
  return arrange(notes, { tuning: standard, frets: guitar.frets, bpm: tempo.bpm, offset: tempo.offset });
}

export async function benchmarkTrack(options: {
  jamsPath: string;
  audioPath: string;
  ffmpegPath: string;
  assets: ModelAssets;
  sensitivity?: Sensitivity;
}): Promise<TrackResult> {
  const { notes: reference } = parseJams(JSON.parse(await readFile(options.jamsPath, 'utf8')));
  const audio = await decodeAudio(options.ffmpegPath, options.audioPath);
  const detected = await detectNotes(audio, {
    assets: options.assets,
    minHz: guitar.minHz,
    maxHz: guitar.maxHz,
    sensitivity: options.sensitivity,
  });

  const matches = matchNotes(reference, detected);
  // The fingering alone: arrange the true notes (without their strings) and compare.
  const unlabeled = reference.map(({ string: _string, ...note }) => note);
  const oracle = reference.map((_, i) => [i, i] as [number, number]);

  return {
    track: path.basename(options.jamsPath, '.jams'),
    referenceNotes: reference.length,
    detectedNotes: detected.length,
    ...noteScores(reference.length, detected.length, matches.length),
    stringAccuracy: stringAccuracy(reference, arrangeNotes(detected), matches),
    fingeringAccuracy: stringAccuracy(reference, arrangeNotes(unlabeled), oracle),
  };
}

export function summarize(results: TrackResult[]): Omit<TrackResult, 'track'> & { tracks: number } {
  const mean = (key: keyof Omit<TrackResult, 'track'>) => results.reduce((sum, r) => sum + r[key], 0) / Math.max(1, results.length);
  return {
    tracks: results.length,
    referenceNotes: mean('referenceNotes'),
    detectedNotes: mean('detectedNotes'),
    precision: mean('precision'),
    recall: mean('recall'),
    f1: mean('f1'),
    stringAccuracy: mean('stringAccuracy'),
    fingeringAccuracy: mean('fingeringAccuracy'),
  };
}
