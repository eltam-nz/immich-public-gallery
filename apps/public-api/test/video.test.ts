import { describe, expect, it } from 'vitest';
import { encodeTimeoutMs, ffmpegArgs } from '../src/video.js';

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

describe('encodeTimeoutMs', () => {
  it('10 minutes plus 4x the length', () => expect(encodeTimeoutMs(60_000)).toBe(14 * 60_000));
  it('2 hours when the length is unknown', () => expect(encodeTimeoutMs(null)).toBe(2 * 60 * 60_000));
});
