import { describe, expect, it } from 'vitest';
import { parseRange } from '../src/range.js';
import { ffmpegArgs } from '../src/video.js';

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

describe('ffmpegArgs', () => {
  const args = ffmpegArgs('in', 'out.mp4', 2);
  it('strips all metadata and chapters', () => {
    expect(args.join(' ')).toContain('-map_metadata -1 -map_metadata:s -1 -map_chapters -1');
  });
  it('720p short side, H.264/AAC, fast start', () => {
    const s = args.join(' ');
    expect(s).toMatch(/min\(720,ih\)/);
    expect(s).toContain('-c:v libx264');
    expect(s).toContain('-c:a aac');
    expect(s).toContain('+faststart');
  });
});
