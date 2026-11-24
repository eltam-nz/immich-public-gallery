import { describe, expect, it } from 'vitest';
import { parseDuration, publishableIds } from '../src/immich.js';

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

describe('publishableIds', () => {
  it('zips columns and keeps only visible, untrashed photos and videos', () => {
    const ids = publishableIds({
      id: [id(1), id(2), id(3), id(4), id(5), id(6)],
      isImage: [true, false, true, true, true, true],
      isTrashed: [false, false, true, false, false, false],
      visibility: ['timeline', 'timeline', 'timeline', 'hidden', 'locked', 'archive'],
    });
    expect(ids).toEqual([id(1), id(2), id(6)]); // id(2) is a video
  });

  it('works without a visibility column', () => {
    expect(publishableIds({ id: [id(1)], isImage: [true], isTrashed: [false] })).toEqual([id(1)]);
  });

  it('drops malformed ids so they never reach a URL path', () => {
    expect(publishableIds({ id: ['../../etc', id(2)], isImage: [true, true], isTrashed: [false, false] })).toEqual([id(2)]);
  });
});

describe('parseDuration', () => {
  it('reads milliseconds (current Immich)', () => expect(parseDuration(42_500)).toBe(42_500));
  it('reads H:MM:SS.ffffff (older Immich)', () => expect(parseDuration('0:01:02.500000')).toBe(62_500));
  it('null for photos, zero and junk', () => {
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration(0)).toBeNull();
    expect(parseDuration('0:00:00.00000')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });
});
