import type { PublicCollection, PublicFeatured, PublicPhoto, PublicPlace, SiteInfo } from '@showcase/shared';

const cache = new Map<string, Promise<unknown>>();

/** GET with a short-lived in-memory cache, so Back/forward doesn't refetch. */
function get<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit) return hit as Promise<T>;
  const p = fetch(path, { headers: { accept: 'application/json' } }).then(async (res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json() as Promise<T>;
  });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  setTimeout(() => cache.delete(path), 5 * 60_000);
  return p;
}

export const api = {
  site: () => get<SiteInfo>('/api/site'),
  collections: () => get<PublicCollection[]>('/api/collections'),
  featured: () => get<PublicFeatured>('/api/featured'),
  places: (collection?: string) =>
    get<PublicPlace[]>(collection ? `/api/places?collection=${encodeURIComponent(collection)}` : '/api/places'),
  photos: (filter: { collection?: string; place?: string; featured?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (filter.collection) q.set('collection', filter.collection);
    if (filter.place) q.set('place', filter.place);
    if (filter.featured) q.set('featured', '1');
    const s = q.toString();
    return get<PublicPhoto[]>(`/api/photos${s ? `?${s}` : ''}`);
  },
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const monthYear = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Jun 2024", "Jun – Aug 2024" or "Jun 2024 – Jan 2025" for a YYYY-MM-DD range. */
export function formatRange(r: { from: string; to: string } | null): string | null {
  if (!r) return null;
  const a = new Date(`${r.from}T00:00:00Z`);
  const b = new Date(`${r.to}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return monthYear(a);
  if (a.getUTCFullYear() === b.getUTCFullYear()) {
    return `${a.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })} – ${monthYear(b)}`;
  }
  return `${monthYear(a)} – ${monthYear(b)}`;
}

/** The larger version of a thumbnail URL (for hero images). */
export const previewOf = (thumbUrl: string) => thumbUrl.replace(/\/thumb\.webp$/, '/preview.webp');
