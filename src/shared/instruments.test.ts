import { describe, expect, it } from 'vitest';
import { samePart } from './instruments';

describe('samePart', () => {
  it('lets guitar and ukulele share their notes, not the bass', () => {
    expect(samePart('guitar', 'ukulele')).toBe(true);
    expect(samePart('ukulele', 'guitar')).toBe(true);
    expect(samePart('bass', 'bass')).toBe(true);
    expect(samePart('guitar', 'bass')).toBe(false);
    expect(samePart('bass', 'ukulele')).toBe(false);
  });
});
