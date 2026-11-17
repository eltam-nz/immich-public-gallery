import {
  cameraLabel,
  imageUrl,
  type AdminCollection,
  type AdminPhoto,
  type StoredMeta,
} from '@showcase/shared';
import type postgres from 'postgres';

export type Sql = postgres.Sql;

interface PhotoDbRow {
  public_id: string;
  version: string;
  width: number;
  height: number;
  taken_at: string | null;
  meta: StoredMeta;
  visible: boolean;
  caption: string | null;
  tags: string[];
  featured: boolean;
  sort: number | null;
  gps_precision: number | null;
  collections: string[];
}

function toAdminPhoto(r: PhotoDbRow): AdminPhoto {
  const m = r.meta ?? {};
  const place = [m.city, m.state, m.country].filter(Boolean).join(', ');
  return {
    id: r.public_id,
    width: r.width,
    height: r.height,
    takenAt: r.taken_at,
    camera: cameraLabel(m.make, m.model),
    lens: m.lens ?? null,
    place: place || null,
    exactLocation:
      m.latitude !== undefined && m.longitude !== undefined ? { lat: m.latitude, lon: m.longitude } : null,
    description: m.description ?? null,
    visible: r.visible,
    caption: r.caption,
    tags: r.tags,
    featured: r.featured,
    sort: r.sort,
    gpsPrecision: r.gps_precision,
    collections: r.collections,
    src: { thumb: imageUrl(r.public_id, r.version, 'thumb'), preview: imageUrl(r.public_id, r.version, 'preview') },
  };
}

/** All synced photos (including hidden ones), newest first. */
export async function listPhotos(sql: Sql, publicId?: string): Promise<AdminPhoto[]> {
  const rows = await sql<PhotoDbRow[]>`
    SELECT a.public_id, a.cached_version AS version, a.width, a.height,
           to_char(a.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS taken_at, a.meta,
           COALESCE(pm.visible, true) AS visible, pm.caption,
           COALESCE(pm.tags, '{}') AS tags, COALESCE(pm.featured, false) AS featured,
           pm.sort, pm.gps_precision,
           (SELECT COALESCE(array_agg(c.public_id ORDER BY c.sort, c.title), '{}')
              FROM collection_photos cp JOIN collections c ON c.id = cp.collection_id
             WHERE cp.immich_asset_id = a.immich_asset_id) AS collections
    FROM assets a
    LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
    WHERE a.cached_version IS NOT NULL
      ${publicId ? sql`AND a.public_id = ${publicId}` : sql``}
    ORDER BY pm.sort ASC NULLS LAST, a.taken_at DESC NULLS LAST, a.public_id`;
  return rows.map(toAdminPhoto);
}

export async function listCollections(sql: Sql, publicId?: string): Promise<AdminCollection[]> {
  const rows = await sql<
    (Omit<AdminCollection, 'cover'> & { cover_id: string | null; cover_version: string | null })[]
  >`
    SELECT c.public_id AS id, c.slug, c.title, c.description, c.visible, c.sort,
           COUNT(a.public_id)::int AS count,
           ca.public_id AS "coverPhotoId",
           COALESCE(ca.public_id, (ARRAY_AGG(a.public_id ORDER BY cp.sort NULLS LAST, a.taken_at DESC)
                                   FILTER (WHERE a.public_id IS NOT NULL))[1]) AS cover_id,
           COALESCE(ca.cached_version, (ARRAY_AGG(a.cached_version ORDER BY cp.sort NULLS LAST, a.taken_at DESC)
                                        FILTER (WHERE a.public_id IS NOT NULL))[1]) AS cover_version
    FROM collections c
    LEFT JOIN collection_photos cp ON cp.collection_id = c.id
    LEFT JOIN assets a ON a.immich_asset_id = cp.immich_asset_id AND a.cached_version IS NOT NULL
    LEFT JOIN assets ca ON ca.immich_asset_id = c.cover_asset_id AND ca.cached_version IS NOT NULL
    ${publicId ? sql`WHERE c.public_id = ${publicId}` : sql``}
    GROUP BY c.id, ca.public_id, ca.cached_version
    ORDER BY c.sort, c.title`;
  return rows.map(({ cover_id, cover_version, ...c }) => ({
    ...c,
    cover: cover_id && cover_version ? imageUrl(cover_id, cover_version, 'thumb') : null,
  }));
}

/** Map public photo IDs to Immich asset IDs (unknown IDs are dropped). */
export async function assetIds(sql: Sql, publicIds: string[]): Promise<string[]> {
  if (!publicIds.length) return [];
  const rows = await sql<{ immich_asset_id: string }[]>`
    SELECT immich_asset_id FROM assets WHERE public_id = ANY(${publicIds})`;
  return rows.map((r) => r.immich_asset_id);
}
