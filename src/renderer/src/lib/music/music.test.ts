import * as alphaTab from '@coderline/alphatab';
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../../../../shared/ipc';
import { INSTRUMENTS } from '../../../../shared/instruments';
import { arrange, detectCapo, SLOTS_PER_BAR, type FrettedOptions, type TabBeat } from './arrange';
import { toAlphaTex, toMidi } from './export';
import { arrangementOptions } from './score';
import { alphaTexPitch, detectKey, estimateTempo, makeKey } from './theory';

const guitar = INSTRUMENTS.guitar;
const standard = guitar.tunings[0].strings;
const note = (start: number, pitch: number, duration = 0.2, velocity = 0.8): NoteEvent => ({ start, duration, pitch, velocity });

/** Deterministic pseudo-random numbers, so failures are reproducible. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const slots = (beat: TabBeat) => (16 / beat.value) * (beat.dotted ? 1.5 : 1);

function parseAlphaTex(tex: string) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, new alphaTab.Settings());
  return importer.readScore();
}

describe('theory', () => {
  it('names pitches in alphaTex notation', () => {
    expect(alphaTexPitch(64)).toBe('e4');
    expect(alphaTexPitch(40)).toBe('e2');
    expect(alphaTexPitch(61)).toBe('c#4');
  });

  it('detects major and minor keys', () => {
    const cMajor = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60].map((p, i) => note(i * 0.5, p, 0.5));
    expect(detectKey(cMajor).name).toBe('C major');

    const aMinor = [57, 60, 64, 57, 59, 60, 62, 64, 57, 52, 57].map((p, i) => note(i * 0.5, p, 0.5));
    expect(detectKey(aMinor)).toMatchObject({ name: 'A minor', alphaTex: 'aminor' });
  });

  it.each([90, 100, 128, 150])('estimates a steady %i BPM', (bpm) => {
    const rand = random(bpm);
    const beat = 60 / bpm;
    // Eighth notes with accented downbeats and ±10 ms of human timing.
    const notes = Array.from({ length: 64 }, (_, i) =>
      note(0.37 + (i * beat) / 2 + (rand() - 0.5) * 0.02, 60, beat / 2, i % 2 === 0 ? 0.9 : 0.5),
    );
    expect(estimateTempo(notes).bpm).toBeCloseTo(bpm, -0.5);
  });
});

describe('arrange', () => {
  const at120: FrettedOptions = { kind: 'fretted', tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };
  const bars = (notes: NoteEvent[], options: FrettedOptions = at120) => arrange(notes, options).staves[0];

  it('quantizes a melody into full 4/4 bars', () => {
    const notes = [40, 45, 50, 55].map((p, i) => note(i * 0.5 + 0.01, p, 0.45));
    const [bar, ...rest] = bars(notes);
    expect(rest).toHaveLength(0);
    expect(bar.map((b) => b.value)).toEqual([4, 4, 4, 4]);
    // Open strings, lowest to highest.
    expect(bar.map((b) => [b.notes[0].string, b.notes[0].fret])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });

  it('plays an open E major chord in first position', () => {
    const eMajor = [40, 47, 52, 56, 59, 64].map((p) => note(0, p, 2));
    const [[beat]] = bars(eMajor);
    expect(beat.notes.map((n) => n.fret)).toEqual([0, 2, 2, 1, 0, 0]);
  });

  it('drops the quietest notes when there are more notes than strings', () => {
    const cluster = [40, 45, 50, 55, 59, 64, 69].map((p, i) => note(0, p, 1, 0.9 - i * 0.1));
    const { staves, droppedNotes } = arrange(cluster, at120);
    expect(droppedNotes).toBe(1);
    expect(staves[0][0][0].notes).toHaveLength(6);
  });

  it('ties notes that cross a bar line', () => {
    // The second note starts on beat 4 and lasts two beats.
    const [first, second] = bars([note(0, 60, 0.4), note(1.5, 64, 1.0)]);
    expect(second).toBeDefined();
    expect(first.at(-1)?.notes[0]).toMatchObject({ pitch: 64, tied: false });
    expect(second[0].notes[0]).toMatchObject({ pitch: 64, tied: true });
  });

  it('avoids large jumps between consecutive notes', () => {
    const melody = [57, 60, 62, 64, 67, 69, 72, 69, 67, 64, 62, 60, 57].map((p, i) => note(i * 0.25, p, 0.25));
    const fretted = bars(melody).flat().flatMap((b) => b.notes.filter((n) => n.fret! > 0).map((n) => n.fret!));
    const jumps = fretted.slice(1).map((f, i) => Math.abs(f - fretted[i]));
    expect(Math.max(...jumps)).toBeLessThanOrEqual(5);
  });

  it('folds out-of-range pitches into the instrument range', () => {
    const [[beat]] = bars([note(0, 20, 2)], { ...at120, tuning: INSTRUMENTS.bass.tunings[0].strings, frets: 20 });
    expect(beat.notes[0].pitch).toBe(32);
  });

  it('writes frets relative to the capo', () => {
    // G major played as an open "E shape" with a capo on the 3rd fret.
    const [[beat]] = bars([43, 50, 55, 59, 62, 67].map((p) => note(0, p, 2)), { ...at120, capo: 3 });
    expect(beat.notes.map((n) => n.fret)).toEqual([0, 2, 2, 1, 0, 0]);
  });
});

describe('arrange: notation-only instruments', () => {
  const timing = { bpm: 120, offset: 0 };

  it('splits piano chords between the treble and bass staves', () => {
    const options = arrangementOptions(INSTRUMENTS.piano, INSTRUMENTS.piano.tunings[0], timing);
    const { staves } = arrange([note(0, 48, 2), note(0, 55, 2), note(0, 64, 2), note(0, 72, 2), note(2, 76, 2)], options);
    expect(staves).toHaveLength(2);
    expect(staves[0][0][0].notes.map((n) => n.pitch)).toEqual([64, 72]);
    expect(staves[1][0][0].notes.map((n) => n.pitch)).toEqual([48, 55]);
    // Both staves have the same bars; the bass staff rests while the right hand plays alone in bar 2.
    expect(staves[0]).toHaveLength(2);
    expect(staves[1]).toHaveLength(2);
    expect(staves[0][1][0].notes.map((n) => n.pitch)).toEqual([76]);
    expect(staves[1][1]).toEqual([{ notes: [], value: 1, dotted: false }]);
  });

  it('keeps at most two notes at a time on the violin', () => {
    const options = arrangementOptions(INSTRUMENTS.violin, INSTRUMENTS.violin.tunings[0], timing);
    const chord = [67, 71, 74, 79].map((p, i) => note(0, p, 1, 0.9 - i * 0.1));
    const { staves, droppedNotes } = arrange(chord, options);
    expect(staves).toHaveLength(1);
    expect(staves[0][0][0].notes.map((n) => n.pitch)).toEqual([67, 71]);
    expect(droppedNotes).toBe(2);
  });

  it('moves notes below the violin range up an octave', () => {
    const options = arrangementOptions(INSTRUMENTS.violin, INSTRUMENTS.violin.tunings[0], timing);
    expect(arrange([note(0, 48, 1)], options).staves[0][0][0].notes[0].pitch).toBe(60);
  });
});

describe('detectCapo', () => {
  // Open chord shapes in standard tuning.
  const G = [43, 47, 50, 55, 59, 67];
  const C = [48, 52, 55, 60, 64];
  const D = [50, 57, 62, 66];
  const Em = [40, 47, 52, 55, 59, 64];
  const strum = (chords: number[][], transpose: number) =>
    chords.flatMap((chord, bar) => chord.map((p, i) => note(bar * 2 + i * 0.01, p + transpose, 1.9)));
  const options = { kind: 'fretted' as const, tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };

  it('finds a capo when open shapes are played higher up', () => {
    expect(detectCapo(strum([G, C, D, Em, G, C, D, G], 3), options, 9)).toBe(3);
    expect(detectCapo(strum([C, G, Em, D, C, G, D, C], 2), options, 9)).toBe(2);
  });

  it('suggests no capo for open chords or for parts using the low strings', () => {
    expect(detectCapo(strum([G, C, D, Em, G, C, D, G], 0), options, 9)).toBe(0);
    expect(detectCapo(strum([G, C, D, G], 0), options, 9)).toBe(0);
  });

  it('suggests no capo for a high melody, even though a capo would put it on open strings', () => {
    const melody = [60, 64, 67, 72, 67, 64, 60, 64, 67, 72].map((p, i) => note(i * 0.5, p, 0.5));
    expect(detectCapo(melody, options, 9)).toBe(0);
  });
});

describe('export', () => {
  it('produces valid alphaTex for random input on every instrument, tuning and key', () => {
    const rand = random(42);
    for (const instrument of Object.values(INSTRUMENTS)) {
      for (const tuning of instrument.tunings) {
        for (let tonic = 0; tonic < 12; tonic++) {
          for (const mode of ['major', 'minor'] as const) {
            const notes = Array.from({ length: 40 }, () =>
              note(rand() * 20, 20 + Math.floor(rand() * 80), 0.05 + rand() * 2, rand()),
            );
            const bpm = 60 + rand() * 120;
            const capo = instrument.notation === 'tab' ? Math.floor(rand() * 6) : 0;
            const arrangement = arrange(notes, arrangementOptions(instrument, tuning, { bpm, offset: rand() }, capo));
            for (const bar of arrangement.staves.flat()) {
              expect(bar.reduce((sum, b) => sum + slots(b), 0)).toBe(SLOTS_PER_BAR);
            }

            const tex = toAlphaTex(arrangement, {
              title: 'Test "song"', bpm, key: makeKey(tonic, mode), instrument, tuning: tuning.strings, capo,
            });
            const track = parseAlphaTex(tex).tracks[0];
            expect(track.playbackInfo.program).toBe(instrument.midiProgram);
            expect(track.staves).toHaveLength(arrangement.staves.length);
            track.staves.forEach((staff, i) => expect(staff.bars).toHaveLength(arrangement.staves[i].length));
            if (instrument.notation === 'tab') {
              expect(track.staves[0].stringTuning.tunings).toEqual([...tuning.strings].reverse());
              expect(track.staves[0].capo).toBe(capo);
            }
          }
        }
      }
    }
  });

  it('writes notes by pitch, with ties, for notation-only instruments', () => {
    const violin = INSTRUMENTS.violin;
    const arrangement = arrange([note(0, 72, 0.4), note(1.5, 76, 1.0)], arrangementOptions(violin, violin.tunings[0], { bpm: 120, offset: 0 }));
    const tex = toAlphaTex(arrangement, { title: 'Ties', bpm: 120, key: makeKey(0, 'major'), instrument: violin, tuning: [] });
    const [bar1, bar2] = parseAlphaTex(tex).tracks[0].staves[0].bars;
    expect(bar1.voices[0].beats[0].notes[0].realValue).toBe(72);
    expect(bar2.voices[0].beats[0].notes[0]).toMatchObject({ realValue: 76, isTieDestination: true });
  });

  it('writes a MIDI file with tempo and all notes', () => {
    const notes = [note(0, 60), note(0.5, 64), note(1, 67)];
    const bytes = toMidi(notes, { title: 'Test', bpm: 96, instrument: guitar });
    const midi = new Midi(bytes);
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(96);
    expect(midi.tracks[0].notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(midi.tracks[0].instrument.number).toBe(guitar.midiProgram);
  });
});

describe('Guitar Pro export', () => {
  it('round-trips through alphaTab', async () => {
    const { toGuitarPro } = await import('./guitarPro');
    const notes = [40, 45, 50, 55].map((p, i) => note(i * 0.5, p, 0.45));
    const options = arrangementOptions(guitar, guitar.tunings[0], { bpm: 120, offset: 0 });
    const tex = toAlphaTex(arrange(notes, options), {
      title: 'Round trip', bpm: 120, key: makeKey(4, 'minor'), instrument: guitar, tuning: standard,
    });
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(toGuitarPro(tex));
    expect(score.title).toBe('Round trip');
    const frets = score.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.notes[0].fret);
    expect(frets).toEqual([0, 0, 0, 0]);
  });
});
