/**
 * Pulls the contents of every configured shared link from Immich, stores the
 * allowlisted metadata, and caches metadata-free images. This is the only code
 * path that talks to Immich; public HTTP requests are served from DB + cache.
 */
import { sanitizeExif } from '@showcase/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { assetVersion, publicId } from './ids.js';
import { removeImages, writeImages } from './images.js';
import { ImmichClient, LinkRevokedError, type ImmichAsset } from './immich.js';

interface Seen {
  asset: ImmichAsset;
  key: string;
  album: { id: string; name: string } | null;
}

export interface SyncResult {
  ok: boolean;
  links: number;
  assets: number;
  imagesUpdated: number;
  removed: number;
  errors: string[];
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  });
  await Promise.all(workers);
}

export class Syncer {
  private running: Promise<SyncResult> | null = null;
  private readonly immich: ImmichClient;

  constructor(
    private readonly cfg: Config,
    private readonly sql: Sql,
    private readonly log: FastifyBaseLogger,
  ) {
    this.immich = new ImmichClient(cfg.IMMICH_URL);
  }

  /** Runs a sync, or joins the one already in progress. */
  run(): Promise<SyncResult> {
    this.running ??= this.doSync().finally(() => (this.running = null));
    return this.running;
  }

  private async linkKeys(): Promise<string[]> {
    const rows = await this.sql<{ link_key: string }[]>`SELECT link_key FROM shared_links WHERE enabled`;
    return [...new Set([...this.cfg.sharedLinkKeys, ...rows.map((r) => r.link_key)])];
  }

  private async doSync(): Promise<SyncResult> {
    const started = Date.now();
    const errors: string[] = [];
    const seen = new Map<string, Seen>();
    let transientFailure = false;

    const keys = await this.linkKeys();
    for (const [idx, key] of keys.entries()) {
      const label = `link #${idx + 1}`; // never log the key itself
      try {
        const contents = await this.immich.getLinkContents(key);
        if (!contents.showMetadata) {
          this.log.warn(`${label}: "Show metadata" is off in Immich, so EXIF features will be empty`);
        }
        for (const asset of contents.assets) {
          if (!seen.has(asset.id)) seen.set(asset.id, { asset, key, album: contents.album });
        }
      } catch (err) {
        if (err instanceof LinkRevokedError) {
          this.log.warn(`${label}: link is no longer valid (${err.message}); its photos will be removed`);
        } else {
          transientFailure = true;
          errors.push(`${label}: ${(err as Error).message}`);
          this.log.error({ err }, `${label}: sync failed`);
        }
      }
    }

    // Upsert metadata.
    const existing = new Map(
      (
        await this.sql<{ immich_asset_id: string; public_id: string; cached_version: string | null }[]>`
          SELECT immich_asset_id, public_id, cached_version FROM assets`
      ).map((r) => [r.immich_asset_id, r]),
    );
    const needImages: Seen[] = [];
    for (const s of seen.values()) {
      const { asset, album } = s;
      const pid = publicId(this.cfg.PUBLIC_ID_SECRET, 'asset', asset.id);
      const version = assetVersion(asset.checksum);
      const takenAt = (asset.localDateTime ?? asset.fileCreatedAt ?? null)?.slice(0, 19) ?? null;
      const meta = sanitizeExif(asset.exifInfo);
      await this.sql`
        INSERT INTO assets ${this.sql({
          public_id: pid,
          immich_asset_id: asset.id,
          album_id: album?.id ?? null,
          album_public_id: album ? publicId(this.cfg.PUBLIC_ID_SECRET, 'album', album.id) : null,
          album_name: album?.name.slice(0, 200) ?? null,
          checksum: asset.checksum,
          version,
          taken_at: takenAt,
          meta: this.sql.json(meta as never),
        })}
        ON CONFLICT (immich_asset_id) DO UPDATE SET
          album_id = EXCLUDED.album_id,
          album_public_id = EXCLUDED.album_public_id,
          album_name = EXCLUDED.album_name,
          checksum = EXCLUDED.checksum,
          version = EXCLUDED.version,
          taken_at = EXCLUDED.taken_at,
          meta = EXCLUDED.meta,
          synced_at = now()`;
      if (existing.get(asset.id)?.cached_version !== version) needImages.push(s);
    }

    // Cache images for new/changed assets.
    let imagesUpdated = 0;
    await mapLimit(needImages, 4, async ({ asset, key }) => {
      const pid = publicId(this.cfg.PUBLIC_ID_SECRET, 'asset', asset.id);
      const version = assetVersion(asset.checksum);
      try {
        const source = await this.immich.getPreview(asset.id, key);
        const { width, height } = await writeImages(this.cfg.CACHE_DIR, pid, version, source);
        await this.sql`
          UPDATE assets SET cached_version = ${version}, width = ${width}, height = ${height}
          WHERE public_id = ${pid}`;
        imagesUpdated++;
      } catch (err) {
        errors.push(`image ${pid}: ${(err as Error).message}`);
        this.log.error({ err, publicId: pid }, 'image processing failed');
      }
    });

    // Remove assets no longer shared. Skipped if any link failed transiently,
    // so a temporary Immich outage never wipes the site.
    let removed = 0;
    if (!transientFailure) {
      const gone = [...existing.values()].filter((r) => !seen.has(r.immich_asset_id));
      for (const r of gone) {
        await this.sql`DELETE FROM assets WHERE public_id = ${r.public_id}`;
        await removeImages(this.cfg.CACHE_DIR, r.public_id);
        removed++;
      }
    }

    const result: SyncResult = {
      ok: errors.length === 0,
      links: keys.length,
      assets: seen.size,
      imagesUpdated,
      removed,
      errors: errors.slice(0, 20),
    };
    await this.sql`
      INSERT INTO sync_state (key, value) VALUES ('last_sync', ${this.sql.json({ ...result, at: new Date().toISOString() } as never)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    this.log.info({ ...result, ms: Date.now() - started }, 'sync complete');
    return result;
  }
}
