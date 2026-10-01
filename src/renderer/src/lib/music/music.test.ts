import * as alphaTab from '@coderline/alphatab';
import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import type { NoteEvent } from '../../../../shared/ipc';
import { INSTRUMENTS } from '../../../../shared/instruments';
import { METERS, type MeterId } from '../../../../shared/meters';
import { arrange, detectCapo, detectTuning, meterTicks, type ArrangeOptions, type TabBeat } from './arrange';
import { applyEdit, findNote } from './edit';
import { tempoMarks, toAlphaTex, toMidi } from './export';
import { detectTempoChanges } from './tempo';
import { alphaTexPitch, chordName, detectKey, detectMeter, estimateTempo, makeKey } from './theory';

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

const ticks = (beat: TabBeat) => (48 / beat.value) * (beat.dotted ? 1.5 : 1) * (beat.tuplet ? 2 / 3 : 1);
const METER_IDS = Object.keys(METERS) as MeterId[];

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
  const at120: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };
  const bars = (notes: NoteEvent[], options: ArrangeOptions = at120) => arrange(notes, options).bars;

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
    const { bars: [[beat]], droppedNotes } = arrange(cluster, at120);
    expect(droppedNotes).toBe(1);
    expect(beat.notes).toHaveLength(6);
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
    const fretted = bars(melody).flat().flatMap((b) => b.notes.filter((n) => n.fret > 0).map((n) => n.fret));
    const jumps = fretted.slice(1).map((f, i) => Math.abs(f - fretted[i]));
    expect(Math.max(...jumps)).toBeLessThanOrEqual(5);
  });

  it('keeps the hand in position across open strings', () => {
    // C5 G4 (open E) C4 (open E) C5...: C4 could be the 1st fret of the B string, but the hand is up the neck.
    const melody = [72, 67, 64, 60, 64, 72, 67, 64, 60, 64, 72].map((p, i) => note(i * 0.25, p, 0.25));
    const fretted = bars(melody).flat().flatMap((b) => b.notes.filter((n) => n.fret > 0).map((n) => n.fret));
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(5);
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

describe('arrange: ukulele (re-entrant tuning)', () => {
  const ukulele = INSTRUMENTS.ukulele;
  const [highG, lowG] = ukulele.tunings;
  const options: ArrangeOptions = { tuning: highG.strings, frets: ukulele.frets, bpm: 120, offset: 0 };

  it('plays an open C chord as 0-0-0-3', () => {
    // G4 C4 E4 C5: the 4th string (G) is higher than the 3rd (C).
    const [[beat]] = arrange([67, 60, 64, 72].map((p) => note(0, p, 2)), options).bars;
    expect(beat.notes.map((n) => [n.string, n.fret])).toEqual([[0, 0], [1, 0], [2, 0], [3, 3]]);
  });

  it('moves notes below the lowest string (C4, not the 4th string) up an octave', () => {
    const [[beat]] = arrange([note(0, 50, 2)], options).bars;
    expect(beat.notes[0].pitch).toBe(62);
    // With low G tuning the same D is playable as written.
    expect(arrange([note(0, 57, 2)], { ...options, tuning: lowG.strings }).bars[0][0].notes[0].pitch).toBe(57);
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
  const options = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };

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
            const capo = Math.floor(rand() * 6);
            const meter = METER_IDS[Math.floor(rand() * METER_IDS.length)];
            const barPhase = Math.floor(rand() * 4);
            const arrangement = arrange(notes, {
              tuning: tuning.strings, frets: instrument.frets, bpm, offset: rand(), capo, meter, barPhase,
            });
            for (const bar of arrangement.bars) {
              expect(bar.reduce((sum, b) => sum + ticks(b), 0)).toBe(meterTicks(METERS[meter]).bar);
            }

            const tex = toAlphaTex(arrangement, {
              title: 'Test "song"', bpm, key: makeKey(tonic, mode), instrument, tuning: tuning.strings, capo,
            });
            const track = parseAlphaTex(tex).tracks[0];
            const staff = track.staves[0];
            expect(track.playbackInfo.program).toBe(instrument.midiProgram);
            expect(staff.bars).toHaveLength(arrangement.bars.length);
            expect(staff.stringTuning.tunings).toEqual([...tuning.strings].reverse());
            expect(staff.capo).toBe(capo);
            // alphaTab agrees that every bar is complete, triplets included.
            for (const bar of staff.bars) {
              const length = bar.voices[0].beats.reduce((sum, b) => sum + b.playbackDuration, 0);
              expect(length).toBe(bar.masterBar.calculateDuration());
            }
          }
        }
      }
    }
  });

  it('plays back the pitches that were detected, on every tuning', () => {
    for (const instrument of Object.values(INSTRUMENTS)) {
      for (const tuning of instrument.tunings) {
        const lowest = Math.min(...tuning.strings);
        const pitches = [lowest, lowest + 4, lowest + 7, lowest + 12];
        const capo = 2;
        const arrangement = arrange(pitches.map((p, i) => note(i * 0.5, p + capo, 0.45)), {
          tuning: tuning.strings, frets: instrument.frets, bpm: 120, offset: 0, capo,
        });
        const tex = toAlphaTex(arrangement, { title: 't', bpm: 120, key: makeKey(0, 'major'), instrument, tuning: tuning.strings, capo });
        const played = parseAlphaTex(tex).tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.notes[0].realValue);
        expect(played).toEqual(pitches.map((p) => p + capo));
      }
    }
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
    const tex = toAlphaTex(arrange(notes, { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 }), {
      title: 'Round trip', bpm: 120, key: makeKey(4, 'minor'), instrument: guitar, tuning: standard,
    });
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(toGuitarPro(tex));
    expect(score.title).toBe('Round trip');
    const frets = score.tracks[0].staves[0].bars[0].voices[0].beats.map((b) => b.notes[0].fret);
    expect(frets).toEqual([0, 0, 0, 0]);
  });
});

describe('meters', () => {
  const options: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };

  it('writes a waltz in 3/4 bars', () => {
    const notes = [40, 55, 59, 45, 57, 60].map((p, i) => note(i * 0.5, p, 0.45));
    const { bars } = arrange(notes, { ...options, meter: '3/4' });
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.map((b) => b.value))).toEqual([[4, 4, 4], [4, 4, 4]]);
  });

  it('writes 6/8 as two dotted-quarter beats of three eighth notes', () => {
    // At 60 BPM (dotted quarters) the eighth notes are 1/3 s apart.
    const notes = Array.from({ length: 6 }, (_, i) => note(i / 3, 52 + i, 0.3));
    const { bars } = arrange(notes, { ...options, bpm: 60, meter: '6/8' });
    expect(bars).toHaveLength(1);
    expect(bars[0].map((b) => b.value)).toEqual([8, 8, 8, 8, 8, 8]);
  });

  it('writes swung eighths as triplets in a triplet feel', () => {
    // Long-short pairs: on the beat and on its last third.
    const notes = Array.from({ length: 8 }, (_, i) => note(Math.floor(i / 2) * 0.5 + (i % 2) * (1 / 3), 52 + i, 0.3));
    const [bar] = arrange(notes, { ...options, meter: '4/4-triplets' }).bars;
    expect(bar.map((b) => [b.value, b.tuplet])).toEqual(
      Array.from({ length: 4 }, () => [[4, true], [8, true]]).flat(),
    );
  });

  it('starts bars on the chosen downbeat, with the pickup in a bar of its own', () => {
    // One pickup beat, then a full bar.
    const notes = [0, 0.5, 1, 1.5, 2].map((t, i) => note(t, 52 + i, 0.45));
    const { bars, startTime } = arrange(notes, { ...options, barPhase: 1 });
    expect(bars).toHaveLength(2);
    expect(bars[0].at(-1)?.notes[0].pitch).toBe(52);
    expect(bars[1][0].notes[0].pitch).toBe(53);
    expect(startTime).toBeCloseTo(-1.5);
  });

  it('maps score time back to the recording', () => {
    const notes = [note(0.75, 52, 0.4), note(1.25, 55, 0.4)];
    const arrangement = arrange(notes, { ...options, offset: 0.25 });
    expect(arrangement.startTime).toBeCloseTo(0.75);
    expect(arrangement.tickSeconds * 12).toBeCloseTo(0.5);
  });
});

describe('detectMeter', () => {
  const rand = random(7);
  const jitter = () => (rand() - 0.5) * 0.02;

  it('recognizes a waltz from its accents', () => {
    // Bass note on 1, softer chords on 2 and 3, at 120 BPM.
    const notes = Array.from({ length: 48 }, (_, beat) =>
      beat % 3 === 0
        ? [note(beat * 0.5 + jitter(), 40, 0.45, 0.9)]
        : [55, 59, 64].map((p) => note(beat * 0.5 + jitter(), p, 0.45, 0.4)),
    ).flat();
    const tempo = estimateTempo(notes);
    expect(tempo.bpm).toBeCloseTo(120, -1);
    expect(detectMeter(notes, tempo)).toMatchObject({ meter: '3/4', barPhase: 0 });
  });

  it('keeps 4/4 for a rock pattern and finds its downbeat', () => {
    // A pickup beat, then bass on 1 and 3 with chords on every beat.
    const notes = Array.from({ length: 49 }, (_, beat) => {
      const time = beat * 0.5 + jitter();
      const chord = [55, 59, 64].map((p) => note(time, p, 0.45, 0.5));
      return (beat - 1) % 4 === 0 ? [...chord, note(time, 40, 0.45, 1)] : chord;
    }).flat();
    expect(detectMeter(notes, estimateTempo(notes))).toMatchObject({ meter: '4/4', barPhase: 1 });
  });

  it('recognizes a shuffle', () => {
    const notes = Array.from({ length: 64 }, (_, i) =>
      note(Math.floor(i / 2) * 0.5 + (i % 2) * (1 / 3) + jitter(), i % 2 ? 47 : 40, 0.2, i % 2 ? 0.6 : 0.9),
    );
    expect(detectMeter(notes, estimateTempo(notes)).meter).toBe('4/4-triplets');
  });

  it('keeps straight 16th notes in 4/4', () => {
    const notes = Array.from({ length: 64 }, (_, i) => note(i * 0.125 + jitter(), 52 + (i % 5), 0.1, i % 4 ? 0.5 : 0.9));
    expect(detectMeter(notes, estimateTempo(notes)).meter).toBe('4/4');
  });
});

describe('detectTuning', () => {
  const bass = INSTRUMENTS.bass;
  const ukulele = INSTRUMENTS.ukulele;
  const options = { frets: guitar.frets, bpm: 120, offset: 0 };
  const riff = (pitches: number[]) => pitches.map((p, i) => note(i * 0.25, p, 0.25));

  it('keeps standard tuning for ordinary parts', () => {
    expect(detectTuning(riff([40, 43, 45, 47, 50, 52, 55, 57]), guitar.tunings, options).id).toBe('standard');
  });

  it('finds drop D from notes below the low E', () => {
    expect(detectTuning(riff([38, 45, 50, 38, 45, 50, 41, 43, 38, 38]), guitar.tunings, options).id).toBe('drop-d');
  });

  it('finds a 5-string bass and a low-G ukulele', () => {
    expect(detectTuning(riff([23, 28, 30, 23, 35, 28]), bass.tunings, { ...options, frets: bass.frets }).id).toBe('five-string');
    expect(detectTuning(riff([55, 57, 60, 64, 55, 59]), ukulele.tunings, { ...options, frets: ukulele.frets }).id).toBe('low-g');
  });

  it('finds half step down from open chord shapes a semitone lower', () => {
    const shapes = [
      [40, 47, 52, 56, 59, 64],
      [45, 52, 57, 60, 64],
      [43, 47, 50, 55, 59, 67],
      [48, 52, 55, 60, 64],
    ];
    const notes = shapes.flatMap((chord, bar) => chord.map((p) => note(bar * 2, p - 1, 1.9)));
    expect(detectTuning(notes, guitar.tunings, options).id).toBe('half-down');
  });
});

describe('chords', () => {
  it('names common chords', () => {
    expect(chordName([45, 52, 57, 60, 64])).toBe('Am');
    expect(chordName([43, 47, 50, 55, 59, 65])).toBe('G7');
    expect(chordName([43, 48, 52, 55, 60])).toBe('C/G');
    expect(chordName([40, 47, 52])).toBe('E5');
    expect(chordName([50, 57, 62, 64])).toBe('Dsus2');
    // The fifth may be left out.
    expect(chordName([48, 52, 58])).toBe('C7');
    expect(chordName([46, 53, 58, 62, 65], true)).toBe('Bb');
    expect(chordName([46, 53, 58, 62, 65])).toBe('A#');
  });

  it('does not name clusters or single notes', () => {
    expect(chordName([60])).toBeNull();
    expect(chordName([60, 61, 62])).toBeNull();
  });

  it('spells keys with flats or sharps like their key signature', () => {
    expect(makeKey(5, 'major').flats).toBe(true);
    expect(makeKey(7, 'major').flats).toBe(false);
    expect(makeKey(2, 'minor').flats).toBe(true);
    expect(makeKey(4, 'minor').flats).toBe(false);
  });

  it('writes chord names and diagrams that alphaTab understands', () => {
    const Am = [45, 52, 57, 60, 64];
    const G = [43, 47, 50, 55, 59, 67];
    const strums = [Am, Am, G].flatMap((chord, i) => chord.map((p) => note(i * 2, p, 1.9)));
    const tex = toAlphaTex(arrange(strums, { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 }), {
      title: 't', bpm: 120, key: makeKey(9, 'minor'), instrument: guitar, tuning: standard,
    });
    const staff = parseAlphaTex(tex).tracks[0].staves[0];
    const names = staff.bars.flatMap((bar) => bar.voices[0].beats.map((b) => b.chord?.name ?? null)).filter(Boolean);
    // Repeated chords are named once.
    expect(names).toEqual(['Am', 'G']);
    const am = [...staff.chords!.values()].find((c) => c.name === 'Am')!;
    expect(am.strings).toEqual([0, 1, 2, 2, 0, -1]);
  });

  it('names the shapes relative to the capo', () => {
    // G shape with a capo on 2 sounds as A.
    const notes = [43, 47, 50, 55, 59, 67].map((p) => note(0, p + 2, 1.9));
    const tex = toAlphaTex(arrange(notes, { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0, capo: 2 }), {
      title: 't', bpm: 120, key: makeKey(9, 'major'), instrument: guitar, tuning: standard, capo: 2,
    });
    expect(tex).toContain('\\chord ("G" 3 0 0 0 2 3)');
  });

  it('can leave chord names out', () => {
    const notes = [45, 52, 57, 60, 64].map((p) => note(0, p, 1.9));
    const tex = toAlphaTex(arrange(notes, { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 }), {
      title: 't', bpm: 120, key: makeKey(9, 'minor'), instrument: guitar, tuning: standard, chords: false,
    });
    expect(tex).not.toContain('\\chord');
  });
});

describe('edits', () => {
  const options: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };

  it('tracks which detected notes each tab note comes from', () => {
    const notes = [note(0.5, 64), note(0, 60), note(0.01, 64)];
    const placed = arrange(notes, options).bars.flat().flatMap((b) => b.notes.filter((n) => !n.tied));
    expect(placed.map((n) => [n.pitch, n.sources])).toEqual([[60, [1]], [64, [2]], [64, [0]]]);
  });

  it('plays a note on the string the user chose', () => {
    // E4 is normally the open 1st string; the user moved it to the B string.
    const [[beat]] = arrange([{ ...note(0, 64, 1), string: 4 }], options).bars;
    expect(beat.notes[0]).toMatchObject({ string: 4, fret: 5 });
  });
});

describe('applyEdit', () => {
  const options: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };
  const context = { tuning: standard, capo: 0, frets: guitar.frets };
  // A C major arpeggio: C3 (A string, 3rd fret), E3, G3.
  const notes = [note(0, 48, 0.45), note(0.5, 52, 0.45), note(1, 55, 0.45)];
  const at = (beat: number) => {
    const arrangement = arrange(notes, options);
    const location = { bar: 0, beat, string: arrangement.bars[0][beat].notes[0].string };
    return { location, placed: findNote(arrangement, location)! };
  };

  it('deletes the detected notes behind a tab note', () => {
    const { placed, location } = at(1);
    const result = applyEdit(notes, placed, location, { type: 'delete' }, context)!;
    expect(result.notes.map((n) => n.pitch)).toEqual([48, 55]);
    expect(result.location).toBeNull();
  });

  it('changes the fret, keeping the string', () => {
    const { placed, location } = at(0);
    const result = applyEdit(notes, placed, location, { type: 'fret', fret: 5 }, context)!;
    expect(result.notes[0]).toMatchObject({ pitch: 50, string: placed.string });
    expect(findNote(arrange(result.notes, options), result.location!)).toMatchObject({ fret: 5, pitch: 50 });
  });

  it('moves a note to another string at the same pitch', () => {
    const { placed, location } = at(2);
    // G3: open 3rd string by default; move it to the 5th fret of the 4th string (D).
    const result = applyEdit(notes, placed, location, { type: 'string', string: 2 }, context)!;
    expect(findNote(arrange(result.notes, options), result.location!)).toMatchObject({ fret: 5, pitch: 55 });
  });

  it('moves the pitch by semitones', () => {
    const { placed, location } = at(0);
    const result = applyEdit(notes, placed, location, { type: 'pitch', delta: -1 }, context)!;
    expect(result.notes[0].pitch).toBe(47);
  });

  it('rejects unplayable edits', () => {
    const { placed, location } = at(0);
    expect(applyEdit(notes, placed, location, { type: 'fret', fret: 30 }, context)).toBeNull();
    // C3 cannot be played on the high E string.
    expect(applyEdit(notes, placed, location, { type: 'string', string: 5 }, context)).toBeNull();
    expect(applyEdit(notes, placed, location, { type: 'pitch', delta: -20 }, context)).toBeNull();
  });
});

describe('playing techniques', () => {
  const options: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };
  const header = { title: 't', bpm: 120, key: makeKey(9, 'minor'), instrument: guitar, tuning: standard };
  const played = (start: number, pitch: number, extra: Partial<NoteEvent> = {}, duration = 0.25): NoteEvent => ({
    ...note(start, pitch, duration), attack: 0.9, ...extra,
  });
  const tabNotes = (notes: NoteEvent[], extra: Partial<ArrangeOptions> = {}) => {
    const arrangement = arrange(notes, { ...options, ...extra });
    const staff = parseAlphaTex(toAlphaTex(arrangement, header)).tracks[0].staves[0];
    return staff.bars.flatMap((bar) => bar.voices[0].beats.flatMap((b) => b.notes));
  };

  // Picked notes before the phrase under test, as in real playing.
  const picked = [played(0, 64), played(0.25, 62), played(0.5, 60), played(0.75, 59)];
  const after = (notes: NoteEvent[]) => tabNotes([...picked, ...notes.map((n) => ({ ...n, start: n.start + 1 }))]).slice(picked.length);

  it('writes hammer-ons and pull-offs on one string', () => {
    // A picked, B hammered on, A pulled off.
    const [a, b, c] = after([played(0, 57), played(0.25, 59, { attack: 0.05 }), played(0.5, 57, { attack: 0.1 })]);
    expect(a.isHammerPullOrigin).toBe(true);
    expect(b.isHammerPullDestination).toBe(true);
    expect(b.isHammerPullOrigin).toBe(true);
    expect(c.isHammerPullDestination).toBe(true);
    expect(new Set([a.string, b.string, c.string]).size).toBe(1);
  });

  it('writes a slide when the pitch glides or the distance is too wide to hammer', () => {
    const [glide] = after([played(0, 57, { slideOut: 1.2 }), played(0.25, 60, { attack: 0.1 })]);
    expect(glide.slideOutType).toBe(alphaTab.model.SlideOutType.Legato);
    const [wide, target] = after([played(0, 57), played(0.25, 64, { attack: 0.1 })]);
    expect(wide.slideOutType).toBe(alphaTab.model.SlideOutType.Legato);
    expect(target.string).toBe(wide.string);
    // Picked again but glided into: a shift slide.
    const [shift] = tabNotes([played(0, 57, { slideOut: 2 }), played(0.25, 60, { slideIn: -1 })]);
    expect(shift.slideOutType).toBe(alphaTab.model.SlideOutType.Shift);
  });

  it('does not trust attacks when hardly any note sounds picked', () => {
    // Fingerstyle bass or heavy compression: every attack is soft.
    const soft = tabNotes([0, 0.25, 0.5, 0.75, 1].map((t, i) => played(t, [57, 59, 57, 59, 60][i], { attack: 0.1 })));
    expect(soft.some((n) => n.isHammerPullOrigin || n.slideOutType !== alphaTab.model.SlideOutType.None)).toBe(false);
  });

  it('leaves picked notes alone', () => {
    const notes = tabNotes([played(0, 57), played(0.25, 59), played(0.5, 60)]);
    expect(notes.some((n) => n.isHammerPullOrigin || n.slideOutType !== alphaTab.model.SlideOutType.None)).toBe(false);
  });

  it('writes bends, releases, vibrato and slides into or out of nowhere', () => {
    const [bend, release] = tabNotes([played(0, 64, { bend: 2 }, 0.5), played(1, 64, { bend: 1, release: true }, 0.5)]);
    expect(bend.bendType).toBe(alphaTab.model.BendType.Bend);
    expect(bend.bendPoints!.at(-1)!.value).toBe(4);
    expect(release.bendType).toBe(alphaTab.model.BendType.BendRelease);
    const [slideIn, slideOut] = tabNotes([played(0, 64, { slideIn: -2 }), played(1, 62, { slideOut: -3 })]);
    expect(slideIn.slideInType).toBe(alphaTab.model.SlideInType.IntoFromBelow);
    expect(slideOut.slideOutType).toBe(alphaTab.model.SlideOutType.OutDown);
    // A long vibrato note tied across the bar line: the vibrato is written where it starts.
    const [, ...vibrato] = tabNotes([played(0, 60), played(1.5, 64, { vibrato: true }, 1)]);
    expect(vibrato.map((n) => n.vibrato)).toEqual([alphaTab.model.VibratoType.Slight, alphaTab.model.VibratoType.None]);
  });

  it('can leave techniques out', () => {
    const [a] = tabNotes([...picked, played(1, 57), played(1.25, 59, { attack: 0.05 }), played(1.5, 64, { bend: 2 })], { techniques: false }).slice(picked.length);
    expect(a.isHammerPullOrigin).toBe(false);
  });
});

describe('tempo changes', () => {
  const rand = random(11);
  const jitter = () => (rand() - 0.5) * 0.02;
  /** Beat times of a piece speeding up from `from` to `to` BPM over `count` beats. */
  const accelerando = (from: number, to: number, count: number) => {
    const beats = [0.5];
    for (let i = 1; i < count; i++) beats.push(beats[i - 1] + 60 / (from + ((to - from) * i) / count));
    return beats;
  };
  // Quarter notes with accented downbeats, a chord on each beat.
  const playOn = (beats: number[]) =>
    beats.flatMap((t, i) => {
      const length = (beats[i + 1] ?? t + 0.5) - t - 0.03;
      return [52, 55, 59].map((p) => note(t + jitter(), p, length, i % 4 === 0 ? 0.9 : 0.6));
    });
  const options: ArrangeOptions = { tuning: standard, frets: guitar.frets, bpm: 120, offset: 0 };

  it('keeps a steady tempo constant', () => {
    const notes = playOn(Array.from({ length: 48 }, (_, i) => 0.5 + i * 0.5));
    expect(detectTempoChanges(notes, estimateTempo(notes).bpm).variable).toBe(false);
  });

  it('follows a piece that speeds up', () => {
    const truth = accelerando(90, 130, 64);
    const notes = playOn(truth);
    const tempo = estimateTempo(notes);
    const changes = detectTempoChanges(notes, tempo.bpm);
    expect(changes.variable).toBe(true);
    expect(changes.range[0]).toBeLessThan(100);
    expect(changes.range[1]).toBeGreaterThan(118);
    // Every tracked beat is close to a real one.
    for (const beat of changes.beats) expect(Math.min(...truth.map((t) => Math.abs(t - beat)))).toBeLessThan(0.04);

    // Following the beats, every chord lands on a beat: four quarter notes per bar.
    const followed = arrange(notes, { ...options, bpm: tempo.bpm, offset: tempo.offset, beats: changes.beats });
    expect(followed.bars.slice(0, -1).every((bar) => bar.length === 4 && bar.every((b) => b.value === 4))).toBe(true);
    // A constant tempo cannot do that.
    const constant = arrange(notes, { ...options, bpm: tempo.bpm, offset: tempo.offset });
    expect(constant.bars.flat().filter((b) => b.value !== 4).length).toBeGreaterThan(5);

    // The written tempo rises, and playback stays in time with the recording.
    const marks = tempoMarks(followed);
    expect(marks.filter((m) => m.visible).length).toBeGreaterThan(2);
    expect(marks.at(-1)!.bpm).toBeGreaterThan(marks[0].bpm * 1.2);
    const staff = parseAlphaTex(toAlphaTex(followed, { title: 't', bpm: tempo.bpm, key: makeKey(4, 'minor'), instrument: guitar, tuning: standard })).tracks[0].staves[0];
    let tempoNow = 0;
    let elapsed = 0;
    staff.bars.forEach((bar, i) => {
      tempoNow = bar.masterBar.tempoAutomations[0]?.value ?? tempoNow;
      elapsed += (4 * 60) / tempoNow;
      // Within the rounding of one shown tempo, and never drifting further.
      expect(Math.abs(elapsed - (followed.barTimes[i + 1] - followed.barTimes[0]))).toBeLessThan(0.02);
    });

    // The MIDI file carries the tempo changes too.
    const midi = new Midi(toMidi(notes, { title: 't', bpm: tempo.bpm, instrument: guitar }, followed));
    expect(midi.header.tempos.length).toBeGreaterThan(2);
  });

  it('hides the rounding of a fractional tempo', () => {
    const notes = playOn(Array.from({ length: 32 }, (_, i) => i * (60 / 99.9)));
    const arrangement = arrange(notes, { ...options, bpm: 99.9, offset: 0 });
    const marks = tempoMarks(arrangement);
    expect(marks[0]).toEqual({ bar: 0, bpm: 100, visible: true });
    expect(marks.slice(1).every((m) => !m.visible)).toBe(true);
    expect(marks.length).toBeLessThanOrEqual(3);
  });
});
