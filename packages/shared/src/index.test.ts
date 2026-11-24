import { describe, expect, it } from 'vitest';
import { cameraLabel, formatDuration, sanitizeExif, toPublicPhoto, type PhotoRow } from './index.js';

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

describe('cameraLabel', () => {
  it('dedupes brand', () => expect(cameraLabel('Canon', 'Canon EOS R5')).toBe('Canon EOS R5'));
  it('joins', () => expect(cameraLabel('FUJIFILM', 'X-T4')).toBe('FUJIFILM X-T4'));
  it('null when both missing', () => expect(cameraLabel()).toBeNull());
});

describe('toPublicPhoto', () => {
  const london = { id: 'g2643743', name: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.50853, lon: -0.12574 };
  const row: PhotoRow = {
    public_id: 'abcdefghijklmnop',
    version: 'v1',
    width: 100,
    height: 50,
    taken_at: '2024-01-01T10:00:00',
    meta: { latitude: 51.123456, longitude: -0.98765, city: 'Westminster', state: 'England' },
    collections: null,
    caption: null,
    tags: null,
    featured: null,
    place: london,
    custom: null,
  };

  it('publishes only the city-level place', () => {
    expect(toPublicPhoto(row).location).toEqual({ placeId: 'g2643743', name: 'London', country: 'United Kingdom' });
  });

  it('never publishes coordinates, photo or city', () => {
    const json = JSON.stringify(toPublicPhoto(row));
    expect(json).not.toMatch(/51\.12|0\.987|51\.508|lat|lon/);
    expect(json).not.toMatch(/Westminster|England/); // Immich's own place text is not published
  });

  it('no place -> no location', () => {
    expect(toPublicPhoto({ ...row, place: null }).location).toBeNull();
  });

  it('never exposes internal ids', () => {
    expect(JSON.stringify(toPublicPhoto(row))).not.toMatch(/immich/i);
  });
});

describe('videos', () => {
  const base: PhotoRow = {
    public_id: 'abcdefghijklmnop', version: 'abcdef123456', width: 1280, height: 720, taken_at: null, meta: {},
    collections: null, caption: null, tags: null, featured: null, place: null, custom: null,
  };
  it('photos have no video', () => {
    const p = toPublicPhoto(base);
    expect(p.type).toBe('image');
    expect(p.video).toBeNull();
  });
  it('videos get the 720p file URL and duration', () => {
    const p = toPublicPhoto({ ...base, media_type: 'video', duration_ms: 42_000 });
    expect(p.type).toBe('video');
    expect(p.video).toEqual({ src: '/video/abcdefghijklmnop/abcdef123456.mp4', duration: 42_000 });
  });
  it('formats durations', () => {
    expect(formatDuration(42_000)).toBe('0:42');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
  });
});
