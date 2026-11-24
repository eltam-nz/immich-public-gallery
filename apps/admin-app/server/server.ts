/**
 * Admin app. Every route except /healthz requires a valid Cloudflare Access JWT
 * for an allowed email. State-changing routes also require a custom header,
 * which a cross-site form or fetch cannot send without a CORS preflight that
 * this server never approves (CSRF protection).
 */
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminStatus } from '@showcase/shared';
import Fastify, { LogController, type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthError, type Verifier } from './auth.js';
import { sendFile } from './range.js';
import type { Config } from './config.js';
import { placeById, searchPlaces } from '@showcase/geo';
import { assetIds, knownPlace, listCollections, listPhotos, listPlaces, type Sql } from './queries.js';

export const CSRF_HEADER = 'x-showcase-admin';

const PUBLIC_ID = z.string().regex(/^[A-Za-z0-9_-]{16}$/);
const VERSION_RE = /^[a-f0-9]{12}$/;
const SIZES = new Set(['thumb', 'preview']);

const tag = z
  .string()
  .transform((t) => t.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(1).max(40));

const PLACE_ID = z.string().regex(/^g\d{1,10}$/);

// Location choice. A chosen place is sent by id only; the server looks it up,
// so a client cannot invent names or coordinates.
const locationBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }).strict(),
  z.object({ mode: z.literal('hidden') }).strict(),
  z.object({ mode: z.literal('place'), placeId: PLACE_ID }).strict(),
]);

const photoPatch = z
  .object({
    visible: z.boolean(),
    caption: z.string().max(2000).transform((s) => s.trim() || null).nullable(),
    tags: z.array(tag).max(50).transform((t) => [...new Set(t)]),
    featured: z.boolean(),
    sort: z.number().int().min(-1_000_000).max(1_000_000).nullable(),
    location: locationBody,
  })
  .partial()
  .strict();

const bulkBody = z
  .object({
    ids: z.array(PUBLIC_ID).min(1).max(5000),
    set: z
      .object({
        visible: z.boolean(),
        featured: z.boolean(),
        // Copy one caption to a group of photos (null clears it).
        caption: z.string().max(2000).transform((v) => v.trim() || null).nullable(),
      })
      .partial()
      .strict()
      .optional(),
    location: locationBody.optional(),
    addTo: PUBLIC_ID.optional(),
    removeFrom: PUBLIC_ID.optional(),
  })
  .strict();

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,64}$/, 'slug may only contain a-z, 0-9 and -');

const collectionBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.union([slug, z.literal('').transform(() => null), z.null()]),
    description: z.string().max(2000).transform((s) => s.trim() || null).nullable(),
    visible: z.boolean(),
    sort: z.number().int().min(-1_000_000).max(1_000_000),
    coverPhotoId: PUBLIC_ID.nullable(),
  })
  .partial()
  .strict();

const idsBody = z.object({ ids: z.array(PUBLIC_ID).min(1).max(5000) }).strict();

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; " +
  "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ error: 'bad_request', issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
}

const uniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

export async function buildServer(cfg: Config, sql: Sql, verify: Verifier): Promise<FastifyInstance> {
  const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
  const app = Fastify({
    logger: { level: cfg.LOG_LEVEL, redact: ['req.headers["cf-access-jwt-assertion"]', 'req.headers.cookie'] },
    logController: new LogController({ disableRequestLogging: cfg.LOG_LEVEL !== 'debug' && cfg.LOG_LEVEL !== 'trace' }),
    bodyLimit: 512 * 1024,
  });

  app.decorateRequest('adminEmail', '');

  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('x-robots-tag', 'noindex, nofollow');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    try {
      const header = req.headers['cf-access-jwt-assertion'];
      const { email } = await verify(Array.isArray(header) ? header[0] : header);
      (req as unknown as { adminEmail: string }).adminEmail = email;
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 401;
      req.log.warn({ status, ip: req.headers['cf-connecting-ip'] ?? req.ip }, 'admin auth rejected');
      return reply.code(status).type('text/plain').send(status === 403 ? 'Forbidden' : 'Unauthorized');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const site = req.headers['sec-fetch-site'];
      if (req.headers[CSRF_HEADER] !== '1' || (site && site !== 'same-origin')) {
        return reply.code(403).send({ error: 'csrf' });
      }
    }
  });

  app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    reply.code(status).send({ error: status === 404 ? 'not_found' : 'error' });
  });

  app.get('/healthz', async () => {
    await sql`SELECT 1`;
    return { ok: true };
  });

  // ---- Status & sync ----
  app.get('/api/status', async (req): Promise<AdminStatus> => {
    const [state] = await sql<{ value: AdminStatus['lastSync'] }[]>`
      SELECT value FROM sync_state WHERE key = 'last_sync'`;
    const [counts] = await sql<{ photos: number; hidden: number; collections: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM assets WHERE cached_version IS NOT NULL) AS photos,
             (SELECT COUNT(*)::int FROM assets a JOIN photos_meta pm USING (immich_asset_id)
               WHERE a.cached_version IS NOT NULL AND NOT pm.visible) AS hidden,
             (SELECT COUNT(*)::int FROM collections) AS collections`;
    const [videoCounts] = await sql<{ ready: number; processing: number; failed: number; large: number }[]>`
      SELECT (COUNT(*) FILTER (WHERE video_version = version))::int AS ready,
             (COUNT(*) FILTER (WHERE video_version IS DISTINCT FROM version
                               AND video_error_version IS DISTINCT FROM version))::int AS processing,
             (COUNT(*) FILTER (WHERE video_version IS DISTINCT FROM version
                               AND video_error_version = version))::int AS failed,
             (COUNT(*) FILTER (WHERE source_bytes > ${cfg.VIDEO_WARN_MB * 1e6}))::int AS large
      FROM assets WHERE media_type = 'video' AND cached_version IS NOT NULL`;
    const s = state?.value as (AdminStatus['lastSync'] & { immichVersion?: string | null }) | undefined;
    return {
      email: (req as unknown as { adminEmail: string }).adminEmail,
      lastSync: s
        ? {
            at: s.at,
            ok: s.ok,
            assets: s.assets,
            imagesUpdated: s.imagesUpdated,
            removed: s.removed,
            errors: s.errors ?? [],
            immichVersion: s.immichVersion ?? null,
          }
        : null,
      counts: counts!,
      videos: videoCounts!,
      videoWarnMB: cfg.VIDEO_WARN_MB,
      publicSiteUrl: cfg.PUBLIC_SITE_URL ?? null,
    };
  });

  app.post('/api/sync', async () => {
    await sql`SELECT pg_notify('showcase_sync', '')`;
    return { ok: true };
  });

  /** photos_meta columns for a location choice, or null if the place is unknown. */
  async function locationFields(loc: z.infer<typeof locationBody>) {
    if (loc.mode !== 'place') return { location_mode: loc.mode, location_place: null };
    const place = placeById(loc.placeId) ?? (await knownPlace(sql, loc.placeId));
    return place ? { location_mode: 'place', location_place: sql.json(place as never) } : null;
  }

  // ---- Places ----
  app.get('/api/places', async () => listPlaces(sql));

  app.get<{ Querystring: { q?: string } }>('/api/places/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 100) return reply.code(400).send({ error: 'bad_request', issues: ['q: 2-100 characters'] });
    return searchPlaces(q, 20);
  });

  // ---- Photos ----
  app.get('/api/photos', async () => listPhotos(sql, undefined, cfg.VIDEO_WARN_MB));

  app.patch<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    const id = PUBLIC_ID.safeParse(req.params.id);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    const body = photoPatch.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    const b = body.data;
    const fields: Record<string, unknown> = {};
    if (b.visible !== undefined) fields.visible = b.visible;
    if (b.caption !== undefined) fields.caption = b.caption;
    if (b.tags !== undefined) fields.tags = b.tags;
    if (b.featured !== undefined) fields.featured = b.featured;
    if (b.sort !== undefined) fields.sort = b.sort;
    if (b.location) {
      const loc = await locationFields(b.location);
      if (!loc) return reply.code(400).send({ error: 'bad_request', issues: ['location.placeId: unknown place'] });
      Object.assign(fields, loc);
    }

    const [asset] = await sql<{ immich_asset_id: string }[]>`
      SELECT immich_asset_id FROM assets WHERE public_id = ${id.data}`;
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    if (Object.keys(fields).length) {
      await sql`
        INSERT INTO photos_meta ${sql({ immich_asset_id: asset.immich_asset_id, ...fields })}
        ON CONFLICT (immich_asset_id) DO UPDATE SET ${sql(fields)}, updated_at = now()`;
    }
    const [photo] = await listPhotos(sql, id.data, cfg.VIDEO_WARN_MB);
    return photo;
  });

  app.post('/api/photos/bulk', async (req, reply) => {
    const body = bulkBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    const { addTo, removeFrom } = body.data;
    let set: Record<string, unknown> | undefined = body.data.set;
    if (body.data.location) {
      const loc = await locationFields(body.data.location);
      if (!loc) return reply.code(400).send({ error: 'bad_request', issues: ['location.placeId: unknown place'] });
      set = { ...set, ...loc };
    }
    const assets = await assetIds(sql, body.data.ids);
    if (!assets.length) return { updated: 0 };
    await sql.begin(async (tx) => {
      if (set && Object.keys(set).length) {
        for (const asset of assets) {
          await tx`
            INSERT INTO photos_meta ${tx({ immich_asset_id: asset, ...set })}
            ON CONFLICT (immich_asset_id) DO UPDATE SET ${tx(set)}, updated_at = now()`;
        }
      }
      if (addTo) {
        await tx`
          INSERT INTO collection_photos (collection_id, immich_asset_id)
          SELECT c.id, x FROM collections c, unnest(${assets}::uuid[]) AS x
          WHERE c.public_id = ${addTo}
          ON CONFLICT DO NOTHING`;
      }
      if (removeFrom) {
        await tx`
          DELETE FROM collection_photos cp USING collections c
          WHERE c.id = cp.collection_id AND c.public_id = ${removeFrom}
            AND cp.immich_asset_id = ANY(${assets}::uuid[])`;
      }
    });
    return { updated: assets.length };
  });

  // ---- Collections ----
  app.get('/api/collections', async () => listCollections(sql));

  const writeCollection = async (
    reply: FastifyReply,
    data: z.infer<typeof collectionBody>,
    publicId: string | null,
  ) => {
    const fields: Record<string, unknown> = {};
    if (data.title !== undefined) fields.title = data.title;
    if (data.slug !== undefined) fields.slug = data.slug;
    if (data.description !== undefined) fields.description = data.description;
    if (data.visible !== undefined) fields.visible = data.visible;
    if (data.sort !== undefined) fields.sort = data.sort;
    if (data.coverPhotoId !== undefined) {
      const [cover] = data.coverPhotoId ? await assetIds(sql, [data.coverPhotoId]) : [null];
      if (data.coverPhotoId && !cover) return reply.code(400).send({ error: 'bad_request', issues: ['coverPhotoId: unknown photo'] });
      fields.cover_asset_id = cover;
    }
    try {
      if (publicId === null) {
        if (!fields.title) return reply.code(400).send({ error: 'bad_request', issues: ['title: required'] });
        const newId = randomBytes(12).toString('base64url');
        await sql`INSERT INTO collections ${sql({ public_id: newId, ...fields })}`;
        reply.code(201);
        return (await listCollections(sql, newId))[0];
      }
      if (Object.keys(fields).length) {
        const res = await sql`
          UPDATE collections SET ${sql(fields)}, updated_at = now() WHERE public_id = ${publicId}`;
        if (res.count === 0) return reply.code(404).send({ error: 'not_found' });
      }
      const [c] = await listCollections(sql, publicId);
      return c ?? reply.code(404).send({ error: 'not_found' });
    } catch (err) {
      if (uniqueViolation(err)) return reply.code(409).send({ error: 'conflict', issues: ['slug: already used'] });
      throw err;
    }
  };

  app.post('/api/collections', async (req, reply) => {
    const body = collectionBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    return writeCollection(reply, body.data, null);
  });

  app.patch<{ Params: { id: string } }>('/api/collections/:id', async (req, reply) => {
    const id = PUBLIC_ID.safeParse(req.params.id);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    const body = collectionBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    return writeCollection(reply, body.data, id.data);
  });

  // Set the order of all collections at once (ids first to last), in one
  // transaction, so a failure can't leave the order half-changed.
  app.put('/api/collections/order', async (req, reply) => {
    const body = idsBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    await sql.begin(async (tx) => {
      for (const [i, id] of body.data.ids.entries()) {
        await tx`UPDATE collections SET sort = ${(i + 1) * 10}, updated_at = now() WHERE public_id = ${id}`;
      }
    });
    return listCollections(sql);
  });

  app.delete<{ Params: { id: string } }>('/api/collections/:id', async (req, reply) => {
    const id = PUBLIC_ID.safeParse(req.params.id);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    const res = await sql`DELETE FROM collections WHERE public_id = ${id.data}`;
    if (res.count === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // Order photos within a collection: ids in the desired order.
  app.put<{ Params: { id: string } }>('/api/collections/:id/order', async (req, reply) => {
    const id = PUBLIC_ID.safeParse(req.params.id);
    const body = idsBody.safeParse(req.body);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    if (!body.success) return badRequest(reply, body.error);
    const rows = await sql<{ public_id: string; immich_asset_id: string }[]>`
      SELECT public_id, immich_asset_id FROM assets WHERE public_id = ANY(${body.data.ids})`;
    const byPublic = new Map(rows.map((r) => [r.public_id, r.immich_asset_id]));
    await sql.begin(async (tx) => {
      for (const [i, pid] of body.data.ids.entries()) {
        const asset = byPublic.get(pid);
        if (!asset) continue;
        await tx`
          UPDATE collection_photos cp SET sort = ${i}
          FROM collections c
          WHERE c.id = cp.collection_id AND c.public_id = ${id.data} AND cp.immich_asset_id = ${asset}`;
      }
    });
    return { ok: true };
  });

  // ---- Images (any synced photo, including hidden ones) ----
  app.get<{ Params: { id: string; version: string; file: string } }>('/img/:id/:version/:file', async (req, reply) => {
    const { id, version, file } = req.params;
    const size = file.endsWith('.webp') ? file.slice(0, -5) : '';
    if (!PUBLIC_ID.safeParse(id).success || !VERSION_RE.test(version) || !SIZES.has(size)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const [row] = await sql`SELECT 1 FROM assets WHERE public_id = ${id} AND cached_version = ${version}`;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const path = join(cfg.CACHE_DIR, id, `${version}-${size}.webp`);
    const st = await stat(path).catch(() => null);
    if (!st) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', 'image/webp')
      .header('content-length', st.size)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  // ---- Videos (any synced video, including hidden ones), with Range support ----
  app.get<{ Params: { id: string; file: string } }>('/video/:id/:file', async (req, reply) => {
    const { id, file } = req.params;
    const version = file.endsWith('.mp4') ? file.slice(0, -4) : '';
    if (!PUBLIC_ID.safeParse(id).success || !VERSION_RE.test(version)) return reply.code(404).send({ error: 'not_found' });
    const [row] = await sql`SELECT 1 FROM assets WHERE public_id = ${id} AND media_type = 'video' AND video_version = ${version}`;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return sendFile(reply, join(cfg.CACHE_DIR, id, `${version}-video.mp4`), {
      type: 'video/mp4',
      cacheControl: 'private, max-age=31536000, immutable',
      range: req.headers.range,
    });
  });

  // ---- Static admin UI ----
  const indexHtml = await readFile(join(webRoot, 'index.html')).catch(() => null);
  app.get('/assets/*', async (req, reply) => {
    const rel = normalize((req.params as { '*': string })['*']).replace(/^(\.\.(\/|\\|$))+/, '');
    if (rel.includes('..') || !/^[\w.-]+$/.test(rel)) return reply.code(404).send({ error: 'not_found' });
    const path = join(webRoot, 'assets', rel);
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', CONTENT_TYPES[extname(path)] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !/^\/(api|img|video)\//.test(req.url) && indexHtml) {
      return reply.type('text/html; charset=utf-8').send(indexHtml);
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
