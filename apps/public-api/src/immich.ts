/**
 * Minimal Immich client that ONLY uses shared-link keys (the same access model
 * as Immich Public Proxy). It never holds an API key, so it can only see what a
 * shared link exposes.
 *
 * Only these fixed endpoints are ever called; no caller-supplied path segment
 * reaches Immich except asset/album UUIDs validated against UUID_RE.
 */
import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nullableStr = z.string().nullish();
const nullableNum = z.number().nullish();

const exifSchema = z
  .object({
    make: nullableStr,
    model: nullableStr,
    lensModel: nullableStr,
    fNumber: nullableNum,
    focalLength: nullableNum,
    iso: nullableNum,
    exposureTime: nullableStr,
    dateTimeOriginal: nullableStr,
    latitude: nullableNum,
    longitude: nullableNum,
    city: nullableStr,
    state: nullableStr,
    country: nullableStr,
    description: nullableStr,
  })
  .nullish();

const assetSchema = z.object({
  id: z.string().regex(UUID_RE),
  type: z.string(),
  checksum: z.string(),
  localDateTime: z.string().nullish(),
  fileCreatedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  isTrashed: z.boolean().nullish(),
  exifInfo: exifSchema,
});
export type ImmichAsset = z.infer<typeof assetSchema>;

const albumRefSchema = z.object({ id: z.string().regex(UUID_RE), albumName: z.string() });

const sharedLinkSchema = z.object({
  id: z.string(),
  type: z.enum(['ALBUM', 'INDIVIDUAL']),
  showMetadata: z.boolean().nullish(),
  album: albumRefSchema.nullish(),
  assets: z.array(assetSchema).default([]),
});

const albumSchema = albumRefSchema.extend({ assets: z.array(assetSchema).default([]) });

export interface LinkContents {
  album: { id: string; name: string } | null;
  showMetadata: boolean;
  assets: ImmichAsset[];
}

/** Thrown when Immich says the link is gone/invalid (revoked, expired, wrong key). */
export class LinkRevokedError extends Error {}

export class ImmichClient {
  private readonly base: string;

  constructor(immichUrl: string, private readonly timeoutMs = 30_000) {
    this.base = immichUrl.replace(/\/+$/, '') + '/api';
  }

  private url(path: string, key: string, extra: Record<string, string> = {}): string {
    const qs = new URLSearchParams({ ...extra, key });
    return `${this.base}${path}?${qs}`;
  }

  private async request(path: string, key: string, extra?: Record<string, string>): Promise<Response> {
    const res = await fetch(this.url(path, key, extra), {
      headers: { accept: '*/*' },
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new LinkRevokedError(`Immich returned ${res.status} for ${path}`);
    }
    if (!res.ok) throw new Error(`Immich returned ${res.status} for ${path}`);
    return res;
  }

  /** Resolve a shared link to its album (if any) and image assets. */
  async getLinkContents(key: string): Promise<LinkContents> {
    const link = sharedLinkSchema.parse(await (await this.request('/shared-links/me', key)).json());
    let assets = link.assets;
    let album: LinkContents['album'] = null;
    if (link.type === 'ALBUM' && link.album) {
      album = { id: link.album.id, name: link.album.albumName };
      const full = albumSchema.parse(await (await this.request(`/albums/${link.album.id}`, key)).json());
      assets = full.assets;
    }
    return {
      album,
      showMetadata: link.showMetadata !== false,
      assets: assets.filter((a) => a.type === 'IMAGE' && !a.isTrashed),
    };
  }

  /** Download Immich's server-generated preview (already oriented, ~1440px). */
  async getPreview(assetId: string, key: string): Promise<Buffer> {
    if (!UUID_RE.test(assetId)) throw new Error('invalid asset id');
    const res = await this.request(`/assets/${assetId}/thumbnail`, key, { size: 'preview' });
    return Buffer.from(await res.arrayBuffer());
  }
}
