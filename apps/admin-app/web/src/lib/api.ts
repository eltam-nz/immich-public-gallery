import type { AdminCollection, AdminPhoto, AdminPlace, AdminStatus, PlaceRef } from '@showcase/shared';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      // Required on every change; blocks cross-site request forgery.
      'x-showcase-admin': '1',
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(res.status, 'Your Cloudflare Access session has expired or is not allowed. Reload the page to sign in again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const issues = (data as { issues?: string[] }).issues;
    throw new ApiError(res.status, issues?.join('; ') || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type LocationChoice = { mode: 'auto' } | { mode: 'hidden' } | { mode: 'place'; placeId: string };
export type PhotoPatch = Partial<Pick<AdminPhoto, 'visible' | 'caption' | 'tags' | 'featured' | 'sort'>> & {
  location?: LocationChoice;
};
export type CollectionPatch = Partial<
  Pick<AdminCollection, 'title' | 'slug' | 'description' | 'visible' | 'sort' | 'coverPhotoId'>
>;

export const api = {
  status: () => call<AdminStatus>('GET', '/api/status'),
  sync: () => call<{ ok: boolean }>('POST', '/api/sync'),
  photos: () => call<AdminPhoto[]>('GET', '/api/photos'),
  updatePhoto: (id: string, patch: PhotoPatch) => call<AdminPhoto>('PATCH', `/api/photos/${id}`, patch),
  bulk: (body: {
    ids: string[];
    set?: { visible?: boolean; featured?: boolean; caption?: string | null };
    location?: LocationChoice;
    addTo?: string;
    removeFrom?: string;
  }) =>
    call<{ updated: number }>('POST', '/api/photos/bulk', body),
  places: () => call<AdminPlace[]>('GET', '/api/places'),
  searchPlaces: (q: string) => call<PlaceRef[]>('GET', `/api/places/search?q=${encodeURIComponent(q)}`),
  collections: () => call<AdminCollection[]>('GET', '/api/collections'),
  createCollection: (body: CollectionPatch & { title: string }) =>
    call<AdminCollection>('POST', '/api/collections', body),
  updateCollection: (id: string, patch: CollectionPatch) =>
    call<AdminCollection>('PATCH', `/api/collections/${id}`, patch),
  deleteCollection: (id: string) => call<void>('DELETE', `/api/collections/${id}`),
  orderCollections: (ids: string[]) => call<AdminCollection[]>('PUT', '/api/collections/order', { ids }),
};

export const placeLabel = (p: PlaceRef | null) => (p ? `${p.name}, ${p.country}` : 'No location');

export function formatDate(takenAt: string | null): string {
  if (!takenAt) return 'Unknown date';
  const d = new Date(`${takenAt}Z`);
  return Number.isNaN(d.getTime())
    ? takenAt
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}
