/**
 * Minimal Immich client that ONLY uses shared-link keys (the same access model
 * as Immich Public Proxy). It never holds an API key, so it can only see what a
 * shared link exposes.
 *
 * Only these fixed endpoints are ever called:
 *   GET /server/version                    (public, no key; logging only)
 *   GET /shared-links/me
 *   GET /albums/:id                        (album name/count; older Immich also lists assets)
 *   GET /timeline/buckets?albumId=         (current Immich: list album assets)
 *   GET /timeline/bucket?albumId=&timeBucket=
 *   GET /assets/:id                        (checksum, date, EXIF)
 *   GET /assets/:id/thumbnail?size=preview  (photo, or a video's poster frame)
 *   GET /assets/:id/video/playback          (videos: Immich's web-ready file)
 * IDs and time buckets taken from Immich responses are validated before they
 * are placed in a URL.
 */
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { z } from 'zod';
import { mapLimit } from './util.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_BUCKET_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

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
  // Milliseconds (current Immich) or "H:MM:SS.ffffff" (older Immich).
  duration: z.union([z.number(), z.string()]).nullish(),
  localDateTime: z.string().nullish(),
  fileCreatedAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
  isTrashed: z.boolean().nullish(),
  visibility: z.string().nullish(),
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

// Immich removed `assets` from the album response; older versions still send it.
// No default here: "missing" must stay distinguishable from "empty".
const albumSchema = albumRefSchema.extend({
  assets: z.array(assetSchema).optional(),
  assetCount: z.number().int().nullish(),
});

const bucketsSchema = z.array(z.object({ timeBucket: z.string().regex(TIME_BUCKET_RE), count: z.number().int() }));

const bucketSchema = z.object({
  id: z.array(z.string()),
  isImage: z.array(z.boolean()),
  isTrashed: z.array(z.boolean()),
  visibility: z.array(z.string()).optional(),
});
export type TimelineBucket = z.infer<typeof bucketSchema>;

const versionSchema = z.object({ major: z.number(), minor: z.number(), patch: z.number() });

const HIDDEN_VISIBILITY = new Set(['hidden', 'locked']);

/** Zip a columnar timeline bucket into the IDs of publishable photos and videos. */
export function publishableIds(bucket: TimelineBucket): string[] {
  const out: string[] = [];
  bucket.id.forEach((id, i) => {
    if (!UUID_RE.test(id)) return;
    if (bucket.isTrashed[i] === true) return;
    if (HIDDEN_VISIBILITY.has(bucket.visibility?.[i] ?? '')) return;
    out.push(id);
  });
  return out;
}

const isPublishable = (a: ImmichAsset) =>
  (a.type === 'IMAGE' || a.type === 'VIDEO') && !a.isTrashed && !HIDDEN_VISIBILITY.has(a.visibility ?? '');

/** Video duration in milliseconds from either Immich format; null if absent or zero. */
export function parseDuration(d: number | string | null | undefined): number | null {
  if (typeof d === 'number') return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
  const m = typeof d === 'string' ? /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(d.trim()) : null;
  if (!m) return null;
  const ms = Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  return ms > 0 ? ms : null;
}

export interface LinkContents {
  album: { id: string; name: string } | null;
  showMetadata: boolean;
  /** Assets Immich says the link holds (all types), when it reports a count. */
  expectedCount: number | null;
  /** How the asset list was obtained, for diagnostics. */
  source: 'link' | 'album' | 'timeline';
  assets: ImmichAsset[];
}

/** Thrown when Immich says the link is gone/invalid (revoked, expired, wrong key). */
export class LinkRevokedError extends Error {}

class HttpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Immich returned ${status} for ${path}`);
  }
}

export class ImmichClient {
  private readonly base: string;

  constructor(immichUrl: string, private readonly timeoutMs = 30_000) {
    this.base = immichUrl.replace(/\/+$/, '') + '/api';
  }

  private async raw(path: string, query: Record<string, string>, timeoutMs = this.timeoutMs): Promise<Response> {
    const qs = new URLSearchParams(query);
    const res = await fetch(`${this.base}${path}${qs.size ? `?${qs}` : ''}`, {
      headers: { accept: '*/*' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new HttpError(res.status, path);
    return res;
  }

  /** Link-level request: 401/403/404 mean the link itself is no longer valid. */
  private async request(path: string, key: string, extra: Record<string, string> = {}): Promise<Response> {
    try {
      return await this.raw(path, { ...extra, key });
    } catch (err) {
      if (err instanceof HttpError && [401, 403, 404].includes(err.status)) {
        throw new LinkRevokedError(err.message);
      }
      throw err;
    }
  }

  /** Immich version string, or null if unavailable. Logging only. */
  async getServerVersion(): Promise<string | null> {
    try {
      const v = versionSchema.parse(await (await this.raw('/server/version', {})).json());
      return `${v.major}.${v.minor}.${v.patch}`;
    } catch {
      return null;
    }
  }

  /** Resolve a shared link to its album (if any) and publishable image assets. */
  async getLinkContents(key: string): Promise<LinkContents> {
    const link = sharedLinkSchema.parse(await (await this.request('/shared-links/me', key)).json());
    const showMetadata = link.showMetadata !== false;

    if (link.type !== 'ALBUM' || !link.album) {
      return {
        album: null,
        showMetadata,
        expectedCount: link.assets.length,
        source: 'link',
        assets: link.assets.filter(isPublishable),
      };
    }

    const albumId = link.album.id;
    const full = albumSchema.parse(await (await this.request(`/albums/${albumId}`, key)).json());
    const album = { id: albumId, name: full.albumName };

    if (full.assets) {
      // Older Immich: the album response carries its assets.
      return {
        album,
        showMetadata,
        expectedCount: full.assetCount ?? full.assets.length,
        source: 'album',
        assets: full.assets.filter(isPublishable),
      };
    }

    // Current Immich: list the album through the timeline, then fetch each asset.
    const { ids, total } = await this.listAlbumAssetIds(albumId, key);
    const assets = await this.getAssets(ids, key);
    return {
      album,
      showMetadata,
      expectedCount: full.assetCount ?? total,
      source: 'timeline',
      assets: assets.filter(isPublishable),
    };
  }

  private async listAlbumAssetIds(albumId: string, key: string): Promise<{ ids: string[]; total: number }> {
    const buckets = bucketsSchema.parse(await (await this.request('/timeline/buckets', key, { albumId })).json());
    const ids: string[] = [];
    for (const b of buckets) {
      const bucket = bucketSchema.parse(
        await (await this.request('/timeline/bucket', key, { albumId, timeBucket: b.timeBucket })).json(),
      );
      ids.push(...publishableIds(bucket));
    }
    return { ids: [...new Set(ids)], total: buckets.reduce((n, b) => n + b.count, 0) };
  }

  /**
   * Fetch full asset details. A 403/404 for one asset only drops that asset;
   * it must never be mistaken for a revoked link (which unpublishes everything).
   * Other failures propagate, so the sync treats them as transient.
   */
  private async getAssets(ids: string[], key: string): Promise<ImmichAsset[]> {
    const out: ImmichAsset[] = [];
    await mapLimit(ids, 4, async (id) => {
      if (!UUID_RE.test(id)) return;
      try {
        out.push(assetSchema.parse(await (await this.raw(`/assets/${id}`, { key })).json()));
      } catch (err) {
        if (err instanceof HttpError && (err.status === 403 || err.status === 404)) return;
        throw err;
      }
    });
    return out;
  }

  /**
   * Stream a video's web-ready file (Immich's playback version) to `dest` on
   * disk. Returns the number of bytes written. Large files never sit in memory.
   */
  async downloadVideo(assetId: string, key: string, dest: string, timeoutMs = 60 * 60_000): Promise<number> {
    if (!UUID_RE.test(assetId)) throw new Error('invalid asset id');
    const res = await this.raw(`/assets/${assetId}/video/playback`, { key }, timeoutMs);
    if (!res.body) throw new Error('empty video response');
    let bytes = 0;
    const counted = Readable.fromWeb(res.body as WebReadableStream).on('data', (c: Buffer) => (bytes += c.length));
    await pipeline(counted, createWriteStream(dest));
    return bytes;
  }

  /** Download Immich's server-generated preview (already oriented, ~1440px). */
  async getPreview(assetId: string, key: string): Promise<Buffer> {
    if (!UUID_RE.test(assetId)) throw new Error('invalid asset id');
    const res = await this.request(`/assets/${assetId}/thumbnail`, key, { size: 'preview' });
    return Buffer.from(await res.arrayBuffer());
  }
}
