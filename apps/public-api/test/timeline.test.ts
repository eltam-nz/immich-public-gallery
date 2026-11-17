import { describe, expect, it } from 'vitest';
import { publishableIds } from '../src/immich.js';

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

describe('publishableIds', () => {
  it('zips columns and keeps only visible, untrashed images', () => {
    const ids = publishableIds({
      id: [id(1), id(2), id(3), id(4), id(5), id(6)],
      isImage: [true, false, true, true, true, true],
      isTrashed: [false, false, true, false, false, false],
      visibility: ['timeline', 'timeline', 'timeline', 'hidden', 'locked', 'archive'],
    });
    expect(ids).toEqual([id(1), id(6)]);
  });

  it('works without a visibility column', () => {
    expect(publishableIds({ id: [id(1)], isImage: [true], isTrashed: [false] })).toEqual([id(1)]);
  });

  it('drops malformed ids so they never reach a URL path', () => {
    expect(publishableIds({ id: ['../../etc', id(2)], isImage: [true, true], isTrashed: [false, false] })).toEqual([id(2)]);
  });
});
