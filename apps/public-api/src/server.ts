/**
 * Read-only public HTTP API. There are deliberately no write routes and no
 * route that forwards to Immich: everything is served from the DB and the
 * local image cache populated by the sync job.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import rateLimit from '@fastify/rate-limit';
import { imageUrl, toPublicPhoto, type PhotoRow, type PublicCollection, type SiteInfo } from '@showcase/shared';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { PUBLIC_ID_RE, VERSION_RE } from './ids.js';
import { imagePath, isSizeName } from './images.js';

const COLLECTION_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Visible, fully-cached photos joined with admin overrides and their visible
 * collections. With `collectionId`, only that collection's photos, in the
 * collection's own order.
 */
function photoQuery(sql: Sql, opts: { publicId?: string; collection?: string } = {}) {
  const inCollection = opts.collection
    ? sql`JOIN collection_photos fcp ON fcp.immich_asset_id = a.immich_asset_id
          JOIN collections fc ON fc.id = fcp.collection_id AND fc.visible
               AND (fc.public_id = ${opts.collection} OR fc.slug = ${opts.collection})`
    : sql``;
  return sql<PhotoRow[]>`
    SELECT a.public_id, a.cached_version AS version, a.width, a.height,
           to_char(a.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS taken_at,
           a.meta,
           (SELECT COALESCE(json_agg(json_build_object('id', c.public_id, 'slug', c.slug, 'title', c.title)
                                     ORDER BY c.sort, c.title), '[]'::json)
              FROM collection_photos cp JOIN collections c ON c.id = cp.collection_id
             WHERE cp.immich_asset_id = a.immich_asset_id AND c.visible) AS collections,
           pm.caption, pm.tags, pm.featured, pm.gps_precision, pm.custom
    FROM assets a
    ${inCollection}
    LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
    WHERE a.cached_version IS NOT NULL
      AND COALESCE(pm.visible, true)
      ${opts.publicId ? sql`AND a.public_id = ${opts.publicId}` : sql``}
    ORDER BY ${opts.collection ? sql`fcp.sort ASC NULLS LAST,` : sql``}
             pm.sort ASC NULLS LAST, a.taken_at DESC NULLS LAST, a.public_id`;
}

export async function buildServer(cfg: Config, sql: Sql): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: cfg.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    // Only reachable through nginx, which sets X-Real-IP from CF-Connecting-IP.
    trustProxy: false,
    logController: new LogController({
      disableRequestLogging: cfg.LOG_LEVEL !== 'debug' && cfg.LOG_LEVEL !== 'trace',
    }),
    bodyLimit: 1024,
  });

  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers['x-real-ip'] as string | undefined) ?? req.ip,
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'public, max-age=60');
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    reply.header('cache-control', 'no-store').code(status).send({ error: status === 429 ? 'rate_limited' : 'error' });
  });

  app.get('/healthz', async (_req, reply) => {
    await sql`SELECT 1`;
    reply.header('cache-control', 'no-store');
    return { ok: true };
  });

  app.get('/api/site', async (): Promise<SiteInfo> => ({ title: cfg.SITE_TITLE }));

  app.get<{ Querystring: { collection?: string } }>('/api/photos', async (req, reply) => {
    const c = req.query.collection;
    if (c !== undefined && !COLLECTION_PARAM_RE.test(c)) return reply.code(400).send({ error: 'bad_request' });
    const rows = await photoQuery(sql, { collection: c });
    return rows.map((r) => toPublicPhoto(r, cfg.DEFAULT_GPS_PRECISION));
  });

  app.get<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    if (!PUBLIC_ID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const [row] = await photoQuery(sql, { publicId: req.params.id });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return toPublicPhoto(row, cfg.DEFAULT_GPS_PRECISION);
  });

  // Visible collections that contain at least one visible photo.
  app.get('/api/collections', async (): Promise<PublicCollection[]> => {
    const rows = await sql<(Omit<PublicCollection, 'cover'> & { cover_id: string | null; cover_version: string | null })[]>`
      SELECT c.public_id AS id, c.slug, c.title, c.description,
             COUNT(a.public_id)::int AS count,
             COALESCE(ca.public_id, (ARRAY_AGG(a.public_id ORDER BY cp.sort NULLS LAST, a.taken_at DESC))[1]) AS cover_id,
             COALESCE(ca.cached_version, (ARRAY_AGG(a.cached_version ORDER BY cp.sort NULLS LAST, a.taken_at DESC))[1]) AS cover_version
      FROM collections c
      JOIN collection_photos cp ON cp.collection_id = c.id
      JOIN assets a ON a.immich_asset_id = cp.immich_asset_id AND a.cached_version IS NOT NULL
      LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
      -- Explicit cover, only if it is itself published and visible.
      LEFT JOIN assets ca ON ca.immich_asset_id = c.cover_asset_id AND ca.cached_version IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM photos_meta cpm WHERE cpm.immich_asset_id = ca.immich_asset_id AND NOT cpm.visible)
      WHERE c.visible AND COALESCE(pm.visible, true)
      GROUP BY c.id, ca.public_id, ca.cached_version
      ORDER BY c.sort, c.title`;
    return rows.map(({ cover_id, cover_version, ...c }) => ({
      ...c,
      cover: cover_id && cover_version ? imageUrl(cover_id, cover_version, 'thumb') : null,
    }));
  });

  // /img/<publicId>/<version>/<size>.webp — served only from the local cache.
  app.get<{ Params: { id: string; version: string; file: string } }>(
    '/img/:id/:version/:file',
    async (req, reply) => {
      const { id, version, file } = req.params;
      const size = file.endsWith('.webp') ? file.slice(0, -5) : '';
      if (!PUBLIC_ID_RE.test(id) || !VERSION_RE.test(version) || !isSizeName(size)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // Must be a currently visible photo at exactly this version.
      const [row] = await sql`
        SELECT 1 FROM assets a
        LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
        WHERE a.public_id = ${id} AND a.cached_version = ${version}
          AND COALESCE(pm.visible, true)`;
      if (!row) return reply.code(404).send({ error: 'not_found' });

      const path = imagePath(cfg.CACHE_DIR, id, version, size);
      const st = await stat(path).catch(() => null);
      if (!st) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', 'image/webp')
        .header('content-length', st.size)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(createReadStream(path));
    },
  );

  return app;
}
