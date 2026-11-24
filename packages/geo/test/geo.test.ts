import { describe, expect, it } from 'vitest';
import { distanceKm, nearestPlace, placeById, searchPlaces } from '../src/index.js';
import { loadGazetteer } from '../src/index.js';

loadGazetteer(new URL('../dist/cities.tsv', import.meta.url).pathname);

describe('nearestPlace', () => {
  it('snaps central London (Westminster) to London, not a borough', () => {
    const p = nearestPlace(51.500729, -0.124625)!;
    expect(p.name).toBe('London');
    expect(p.country).toBe('United Kingdom');
    expect(p.countryCode).toBe('GB');
  });
  it('snaps Auckland suburbs to Auckland', () => {
    expect(nearestPlace(-36.8485, 174.7633)!.name).toBe('Auckland');
    expect(nearestPlace(-36.9, 174.8)!.name).toBe('Auckland');
  });
  it('keeps a real town when you are in it', () => {
    expect(nearestPlace(-43.53, 172.63)!.name).toBe('Christchurch');
    expect(nearestPlace(51.3811, -2.359)!.name).toBe('Bath');
  });
  it('returns the place coordinates, never the input coordinates', () => {
    const p = nearestPlace(51.500729, -0.124625)!;
    expect([p.lat, p.lon]).not.toEqual([51.500729, -0.124625]);
    expect(distanceKm(p.lat, p.lon, 51.500729, -0.124625)).toBeLessThan(5);
  });
  it('works across the antimeridian (Fiji/Taveuni)', () => {
    const p = nearestPlace(-16.8, 179.99)!;
    expect(p.countryCode).toBe('FJ');
  });
  it('finds something for remote places', () => {
    expect(nearestPlace(-45.0, -140.0)).not.toBeNull(); // middle of the Pacific
  });
  it('rejects invalid input', () => {
    expect(nearestPlace(NaN, 0)).toBeNull();
    expect(nearestPlace(95, 0)).toBeNull();
  });
});

describe('placeById', () => {
  it('round-trips ids', () => {
    const p = nearestPlace(-36.8485, 174.7633)!;
    expect(placeById(p.id)).toEqual(p);
  });
  it('rejects unknown or malformed ids', () => {
    expect(placeById('g0')).toBeNull();
    expect(placeById('x123')).toBeNull();
    expect(placeById('g1; drop table')).toBeNull();
  });
});

describe('searchPlaces', () => {
  it('ranks exact matches first, biggest place first', () => {
    const r = searchPlaces('bath');
    expect(r[0]!.name).toBe('Bath');
    expect(r[0]!.countryCode).toBe('GB');
  });
  it('ignores accents and case', () => {
    expect(searchPlaces('zurich')[0]!.name).toBe('Zürich');
  });
  it('needs at least two characters', () => {
    expect(searchPlaces('a')).toEqual([]);
  });
});
