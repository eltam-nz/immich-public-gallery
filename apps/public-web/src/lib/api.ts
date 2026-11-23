import type { PublicCollection, PublicPhoto, PublicPlace, SiteInfo } from '@showcase/shared';

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
