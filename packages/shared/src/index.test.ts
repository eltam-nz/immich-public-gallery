import { describe, expect, it } from 'vitest';
import { cameraLabel, roundCoord, sanitizeExif, toPublicPhoto, type PhotoRow } from './index.js';

describe('sanitizeExif', () => {
  it('keeps only allowlisted fields', () => {
    const out = sanitizeExif({
      make: 'Canon',
      model: 'EOS R5',
      fNumber: 2.8,
      latitude: 51.123456,
      longitude: -0.98765,
      // Fields Immich may send that we must never keep:
      ...({ serialNumber: 'ABC123', fileSizeInByte: 1234, projectionType: 'x' } as object),
    });
    expect(out).toEqual({ make: 'Canon', model: 'EOS R5', aperture: 2.8, latitude: 51.123456, longitude: -0.98765 });
  });

  it('rejects out-of-range and malformed values', () => {
    const out = sanitizeExif({ latitude: 999, iso: -5, exposureTime: '<script>', city: '  \n ' });
    expect(out).toEqual({});
  });

  it('handles null exif', () => {
    expect(sanitizeExif(null)).toEqual({});
  });
});

describe('roundCoord', () => {
  it('hides when precision < 0', () => expect(roundCoord(51.5, -1)).toBeUndefined());
  it('rounds', () => expect(roundCoord(51.123456, 1)).toBe(51.1));
  it('caps precision at 4', () => expect(roundCoord(51.123456, 9)).toBe(51.1235));
});

describe('cameraLabel', () => {
  it('dedupes brand', () => expect(cameraLabel('Canon', 'Canon EOS R5')).toBe('Canon EOS R5'));
  it('joins', () => expect(cameraLabel('FUJIFILM', 'X-T4')).toBe('FUJIFILM X-T4'));
  it('null when both missing', () => expect(cameraLabel()).toBeNull());
});

describe('toPublicPhoto', () => {
  const row: PhotoRow = {
    public_id: 'abcdefghijklmnop',
    version: 'v1',
    width: 100,
    height: 50,
    taken_at: '2024-01-01T10:00:00',
    meta: { latitude: 51.123456, longitude: -0.98765, city: 'London' },
    collection_id: null,
    collection_slug: null,
    collection_title: null,
    caption: null,
    tags: null,
    featured: null,
    gps_precision: null,
    custom: null,
  };

  it('hides GPS by default', () => {
    expect(toPublicPhoto(row, -1).location).toEqual({ city: 'London' });
  });

  it('applies per-photo precision override', () => {
    expect(toPublicPhoto({ ...row, gps_precision: 2 }, -1).location).toEqual({ city: 'London', lat: 51.12, lon: -0.99 });
  });

  it('never exposes internal ids', () => {
    expect(JSON.stringify(toPublicPhoto(row, 4))).not.toMatch(/immich/i);
  });
});
