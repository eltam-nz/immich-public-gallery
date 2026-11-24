/**
 * Offline gazetteer: snaps coordinates to the nearest city and searches places.
 * Data: GeoNames (CC BY 4.0) via the `all-the-cities` package, built into
 * dist/cities.tsv at build time. No network access at runtime.
 */
import { readFileSync } from 'node:fs';

export interface Place {
  /** Stable id: "g" + GeoNames id. */
  id: string;
  name: string;
  /** Country name in English. */
  country: string;
  countryCode: string;
  /** The place's own coordinates (never a photo's). */
  lat: number;
  lon: number;
}

interface Gazetteer {
  ids: Int32Array;
  names: string[];
  search: string[];
  cc: string[];
  pop: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  grid: Map<number, number[]>;
  byId: Map<number, number>;
}

let gaz: Gazetteer | null = null;
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

const R = 6371; // km
const rad = (d: number) => (d * Math.PI) / 180;
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const cellLat = (lat: number) => Math.min(179, Math.floor(lat + 90));
const cellLon = (lon: number) => ((Math.floor(lon + 180) % 360) + 360) % 360;
const cellKey = (la: number, lo: number) => la * 360 + lo;

/** Load the gazetteer (once). Pass a path to use another data file (tests). */
export function loadGazetteer(path: string | URL = new URL('./cities.tsv', import.meta.url)): void {
  if (gaz && typeof path !== 'string') return;
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const n = rows.length;
  const g: Gazetteer = {
    ids: new Int32Array(n),
    names: new Array(n),
    search: new Array(n),
    cc: new Array(n),
    pop: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    grid: new Map(),
    byId: new Map(),
  };
  rows.forEach((row, i) => {
    const [id, name, cc, pop, lat, lon] = row.split('\t');
    g.ids[i] = Number(id);
    g.names[i] = name!;
    g.search[i] = normalize(name!);
    g.cc[i] = cc!;
    g.pop[i] = Number(pop) || 0;
    g.lat[i] = Number(lat);
    g.lon[i] = Number(lon);
    g.byId.set(g.ids[i]!, i);
    const key = cellKey(cellLat(g.lat[i]!), cellLon(g.lon[i]!));
    let cell = g.grid.get(key);
    if (!cell) g.grid.set(key, (cell = []));
    cell.push(i);
  });
  gaz = g;
}

function g(): Gazetteer {
  if (!gaz) loadGazetteer();
  return gaz!;
}

function toPlace(i: number): Place {
  const z = g();
  const cc = z.cc[i]!;
  let country = cc;
  try {
    country = countryNames.of(cc) ?? cc;
  } catch {
    /* unknown code: keep it */
  }
  return { id: `g${z.ids[i]}`, name: z.names[i]!, country, countryCode: cc, lat: z.lat[i]!, lon: z.lon[i]! };
}

/** Indexes of places within `km` of a point (grid lookup). */
function within(lat: number, lon: number, km: number): number[] {
  const z = g();
  const dLat = Math.ceil(km / 111) + 1;
  const cosLat = Math.max(0.01, Math.cos(rad(Math.min(89, Math.abs(lat) + dLat))));
  const dLon = Math.min(180, Math.ceil(km / (111 * cosLat)) + 1);
  const la0 = cellLat(lat);
  const lo0 = cellLon(lon);
  const out: number[] = [];
  const seenLon = new Set<number>();
  for (let dl = -dLon; dl <= dLon; dl++) {
    const lo = (((lo0 + dl) % 360) + 360) % 360;
    if (seenLon.has(lo)) continue;
    seenLon.add(lo);
    for (let la = Math.max(0, la0 - dLat); la <= Math.min(179, la0 + dLat); la++) {
      for (const i of z.grid.get(cellKey(la, lo)) ?? []) {
        if (distanceKm(lat, lon, z.lat[i]!, z.lon[i]!) <= km) out.push(i);
      }
    }
  }
  return out;
}

/**
 * The "city" a point belongs to. Among places within 50 km, picks the lowest
 * distance / sqrt(population), so a big city wins over its own suburbs while a
 * real town still wins when you are in it. Falls back to the nearest place.
 */
export function nearestPlace(lat: number, lon: number): Place | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const z = g();
  let best = -1;
  let bestScore = Infinity;
  for (const i of within(lat, lon, 50)) {
    const d = Math.max(1, distanceKm(lat, lon, z.lat[i]!, z.lon[i]!));
    const score = d / Math.sqrt(Math.max(1000, z.pop[i]!));
    if (score < bestScore) [best, bestScore] = [i, score];
  }
  if (best < 0) {
    // Remote location: widen the search and take the plain nearest place.
    for (const km of [200, 1000, 5000, 20040]) {
      let bestD = Infinity;
      for (const i of within(lat, lon, km)) {
        const d = distanceKm(lat, lon, z.lat[i]!, z.lon[i]!);
        if (d < bestD) [best, bestD] = [i, d];
      }
      if (best >= 0) break;
    }
  }
  return best >= 0 ? toPlace(best) : null;
}

/** Look a place up by id ("g<geonameId>"). */
export function placeById(id: string): Place | null {
  const m = /^g(\d{1,10})$/.exec(id);
  if (!m) return null;
  const i = g().byId.get(Number(m[1]));
  return i === undefined ? null : toPlace(i);
}

/** Search by name: exact, then starts-with, then word starts-with; bigger places first. */
export function searchPlaces(query: string, limit = 20): Place[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const z = g();
  const hits: { i: number; rank: number }[] = [];
  for (let i = 0; i < z.search.length; i++) {
    const s = z.search[i]!;
    let rank = -1;
    if (s === q) rank = 0;
    else if (s.startsWith(q)) rank = 1;
    else if (s.includes(` ${q}`)) rank = 2;
    if (rank >= 0) hits.push({ i, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || z.pop[b.i]! - z.pop[a.i]!);
  return hits.slice(0, Math.max(1, Math.min(50, limit))).map((h) => toPlace(h.i));
}
