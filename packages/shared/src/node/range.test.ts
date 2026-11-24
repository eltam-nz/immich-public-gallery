import { describe, expect, it } from 'vitest';
import { parseRange } from './range.js';

describe('parseRange', () => {
  it('no header -> whole file', () => expect(parseRange(undefined, 100)).toBeNull());
  it('bytes=0-', () => expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 }));
  it('bytes=10-19', () => expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 }));
  it('clamps the end to the file', () => expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 }));
  it('suffix: last 10 bytes', () => expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 }));
  it('start past the end -> 416', () => expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable'));
  it('reversed -> 416', () => expect(parseRange('bytes=50-10', 100)).toBe('unsatisfiable'));
  it('multi-range / junk -> whole file', () => {
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
  });
});
