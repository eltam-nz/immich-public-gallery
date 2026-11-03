/**
 * Read-only public HTTP API. There are deliberately no write routes and no
 * route that forwards to Immich: everything is served from the DB and the
 * local image cache populated by the sync job.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import rateLimit from '@fastify/rate-limit';
import { toPublicPhoto, type PhotoRow, type PublicCollection, type SiteInfo } from '@showcase/shared';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { PUBLIC_ID_RE, VERSION_RE } from './ids.js';
import { imagePath, isSizeName } from './images.js';

const COLLECTION_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Visible, fully-cached photos joined with admin overrides. */
function photoQuery(sql: Sql, where: ReturnType<Sql>) {
  return sql<PhotoRow[]>`
    SELECT a.public_id, a.cached_version AS version, a.width, a.height,
           to_char(a.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS taken_at,
           a.meta,
           a.album_public_id AS collection_id,
           c.slug AS collection_slug,
           COALESCE(c.title, a.album_name) AS collection_title,
           pm.caption, pm.tags, pm.featured, pm.gps_precision, pm.custom
    FROM assets a
    LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
    LEFT JOIN collections c ON c.immich_album_id = a.album_id
    WHERE a.cached_version IS NOT NULL
      AND COALESCE(pm.visible, true)
      AND COALESCE(c.visible, true)
      ${where}
    ORDER BY pm.sort ASC NULLS LAST, a.taken_at DESC NULLS LAST, a.public_id`;
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
    const rows = await photoQuery(sql, c ? sql`AND (a.album_public_id = ${c} OR c.slug = ${c})` : sql``);
    return rows.map((r) => toPublicPhoto(r, cfg.DEFAULT_GPS_PRECISION));
  });

  app.get<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    if (!PUBLIC_ID_RE.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const [row] = await photoQuery(sql, sql`AND a.public_id = ${req.params.id}`);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return toPublicPhoto(row, cfg.DEFAULT_GPS_PRECISION);
  });

  app.get('/api/collections', async (): Promise<PublicCollection[]> => {
    return sql<PublicCollection[]>`
      SELECT a.album_public_id AS id, c.slug,
             COALESCE(c.title, MAX(a.album_name)) AS title,
             c.description, COUNT(*)::int AS count
      FROM assets a
      LEFT JOIN photos_meta pm ON pm.immich_asset_id = a.immich_asset_id
      LEFT JOIN collections c ON c.immich_album_id = a.album_id
      WHERE a.album_public_id IS NOT NULL
        AND a.cached_version IS NOT NULL
        AND COALESCE(pm.visible, true)
        AND COALESCE(c.visible, true)
      GROUP BY a.album_public_id, c.slug, c.title, c.description, c.sort
      ORDER BY COALESCE(c.sort, 0), title`;
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
        LEFT JOIN collections c ON c.immich_album_id = a.album_id
        WHERE a.public_id = ${id} AND a.cached_version = ${version}
          AND COALESCE(pm.visible, true) AND COALESCE(c.visible, true)`;
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
