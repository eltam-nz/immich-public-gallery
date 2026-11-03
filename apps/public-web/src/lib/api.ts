import type { PublicCollection, PublicPhoto, SiteInfo } from '@showcase/shared';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  site: () => get<SiteInfo>('/api/site'),
  collections: () => get<PublicCollection[]>('/api/collections'),
  photos: (collection?: string) =>
    get<PublicPhoto[]>(collection ? `/api/photos?collection=${encodeURIComponent(collection)}` : '/api/photos'),
};
