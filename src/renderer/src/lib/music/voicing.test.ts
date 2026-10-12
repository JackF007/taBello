import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../../../../shared/instruments';
import { chordVoicing } from './voicing';

const guitar = INSTRUMENTS.guitar;
const ukulele = INSTRUMENTS.ukulele;
const MAJOR = [0, 4, 7];
const MINOR = [0, 3, 7];
const DOM7 = [0, 4, 7, 10];
/** Diagram as chord charts write it, lowest string first: "x02210". */
const shape = (frets: (number | null)[] | null) => frets?.map((f) => (f === null ? 'x' : f.toString(36))).join('');

describe('chordVoicing', () => {
  const standard = { tuning: guitar.tunings[0].strings, frets: guitar.frets };

  it('finds the open shapes every guitarist knows', () => {
    expect(shape(chordVoicing({ root: 9, intervals: MINOR, bass: 9, ...standard }))).toBe('x02210'); // Am
    expect(shape(chordVoicing({ root: 0, intervals: MAJOR, bass: 0, ...standard }))).toBe('x32010'); // C
    expect(shape(chordVoicing({ root: 4, intervals: MAJOR, bass: 4, ...standard }))).toBe('022100'); // E
    expect(shape(chordVoicing({ root: 4, intervals: MINOR, bass: 4, ...standard }))).toBe('022000'); // Em
    expect(shape(chordVoicing({ root: 2, intervals: MAJOR, bass: 2, ...standard }))).toBe('xx0232'); // D
    expect(shape(chordVoicing({ root: 7, intervals: MAJOR, bass: 7, ...standard }))?.startsWith('320')).toBe(true); // G
    expect(shape(chordVoicing({ root: 9, intervals: DOM7, bass: 9, ...standard }))).toBe('x02020'); // A7
  });

  it('uses a barre when there is no open shape', () => {
    // F: the classic barre at the 1st fret.
    expect(shape(chordVoicing({ root: 5, intervals: MAJOR, bass: 5, ...standard }))).toBe('133211');
    // B minor: barre at the 2nd fret.
    expect(shape(chordVoicing({ root: 11, intervals: MINOR, bass: 11, ...standard }))).toBe('x24432');
  });

  it('puts a slash chord bass on the lowest string', () => {
    expect(shape(chordVoicing({ root: 0, intervals: MAJOR, bass: 7, ...standard }))).toBe('332010'); // C/G
  });

  it('works on other tunings and on ukulele', () => {
    // Drop D: a D chord with the low D.
    const dropD = { tuning: guitar.tunings[1].strings, frets: guitar.frets };
    expect(shape(chordVoicing({ root: 2, intervals: MAJOR, bass: 2, ...dropD }))?.startsWith('0')).toBe(true);
    // Ukulele (G C E A), no bass constraint: C = 0003, Am = 2000, F = 2010, G7 = 0212.
    const uke = { tuning: ukulele.tunings[0].strings, frets: ukulele.frets, bass: -1 };
    expect(shape(chordVoicing({ root: 0, intervals: MAJOR, ...uke }))).toBe('0003');
    expect(shape(chordVoicing({ root: 9, intervals: MINOR, ...uke }))).toBe('2000');
    expect(shape(chordVoicing({ root: 5, intervals: MAJOR, ...uke }))).toBe('2010');
    expect(shape(chordVoicing({ root: 7, intervals: DOM7, ...uke }))).toBe('0212');
  });
});
