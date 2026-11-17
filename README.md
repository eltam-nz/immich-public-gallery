# Immich Showcase

A self-hosted public photo site built from selected Immich albums. It runs as a Portainer stack and is published through a Cloudflare Tunnel. Immich itself is never exposed.

**Status:** Phase 1 (foundation) and Phase 3 (admin app) are done. One Immich album is shared through a link key. Everything else is managed inside the gallery, from a private admin app: sub-album collections, captions, tags, visibility and location precision.

## How it stays secure

It uses the same access model as Immich Public Proxy, with a few things tightened:

| | Immich Public Proxy | This project |
|---|---|---|
| Credential used to reach Immich | Shared-link key | Shared-link key (no API key on the public side) |
| Where the key lives | In the public URL | Server-side only (env/DB) |
| Public request reaches Immich? | Yes, proxied per request | No. Served from DB plus local cache; only the sync job talks to Immich |
| Image metadata | Passed through | Re-encoded with sharp; all EXIF/GPS/XMP removed |
| IDs in URLs | Immich UUIDs | Opaque HMAC-derived IDs |

Other guarantees:
- **Fixed Immich calls only.** public-api only ever calls `shared-links/me`, `albums/:id`, `timeline/buckets` and `timeline/bucket` (to list an album's assets on current Immich), `assets/:id` (date and EXIF), `assets/:id/thumbnail`, and the public `server/version` (logged for diagnostics). All of them use the shared-link key, never an API key. The e2e test checks this list against both current and older Immich API shapes.
- **Metadata allowlist.** Everything sent to the public API passes through `toPublicPhoto` in `packages/shared/src/index.ts`. Fields not copied there can't leak.
- **GPS hidden by default.** `DEFAULT_GPS_PRECISION=-1` hides coordinates. City, state and country are still shown. You can override this per photo (`photos_meta.gps_precision`).
- **Least-privilege database.** The public role can read the admin tables but not write them. The admin role can edit the admin tables (photo overrides, collections) but can only read synced data.
- **Admin app behind two locks.** Cloudflare Access must let you in, and the app then verifies Access's signed token itself (issuer, audience, expiry, signature) and checks your email against `ADMIN_EMAILS`. A request that reaches the container any other way is rejected. Without these settings the app refuses to start. Changes also need a custom request header and a same-origin request, which blocks cross-site request forgery.
- **The admin app never talks to Immich.** It has no Immich key and no route to Immich. "Sync now" is a database notification that the public API acts on.
- **Isolated networks (bundled-tunnel mode).** cloudflared can only reach `public-web`, and only cloudflared has outbound internet (its own `egress` network). `public-web`, `public-api` and the database sit on `internal` networks with no internet access through this stack; `public-api` also joins your Immich network to reach Immich. No host ports are published.
- **Shared-tunnel mode weakens isolation.** With `docker-compose.shared-tunnel.yml`, `public-web` joins your existing tunnel network. It can reach, and be reached by, every other container on that network, and it gains outbound internet access through it. Use bundled-tunnel mode if you want strict isolation.
- **Read-only web container.** nginx rejects anything except GET/HEAD and sets a strict CSP (no inline scripts or styles). Containers run read-only, non-root, with all capabilities dropped.
- **Outage-safe.** If Immich is unreachable during a sync, nothing is deleted. Photos are only removed when Immich says they're gone or the link has been revoked.

```
Bundled tunnel:
Internet → Cloudflare → cloudflared ─(edge, internal)→ public-web (nginx) ─(backend)→ public-api ─(immich net)→ Immich
                          └─(egress)→ internet                                          └─(backend)→ Postgres

Shared tunnel: your existing cloudflared ─(TUNNEL_NETWORK)→ public-web (alias immich-showcase-web); the rest is unchanged.
```

## Setup

### 1. In Immich
1. Create an album with the photos you want to publish.
2. Share it → **Create link**. Turn **Show metadata** on, leave the password empty, and set no expiry (or one you'll renew).
3. Copy the key, which is the part after `/share/` in the link.

### 2. Choose a tunnel mode

**Bundled tunnel (default, strictest isolation).** The stack runs its own cloudflared.
1. In Cloudflare Zero Trust, go to **Networks → Tunnels → Create tunnel** (cloudflared) and copy the token.
2. Add the public hostname `photos.example.com` → service `http://public-web:8080`.
3. In the stack's variables, set `COMPOSE_PROFILES=bundled-tunnel` and `TUNNEL_TOKEN`.

**Shared tunnel.** Use a cloudflared container you already run.
1. Note the Docker network that cloudflared container is on (`docker network ls`), e.g. `proxy`.
2. In Portainer, add `docker-compose.shared-tunnel.yml` under **Additional paths** when creating the stack.
3. Set `TUNNEL_NETWORK` to that network. Do **not** set `COMPOSE_PROFILES` or `TUNNEL_TOKEN`.
4. In that tunnel's configuration, add the public hostname `photos.example.com` → service `http://immich-showcase-web:8080`.
5. Read the shared-tunnel caveat under "How it stays secure".

**In either mode, recommended Cloudflare settings:**
- A cache rule for `photos.example.com/img/*` (eligible for cache, long edge TTL).
- A rate-limiting rule on `/api/*`.
- Bot Fight Mode on.

### 3. In Portainer
1. **Stacks → Add stack → Repository.** Point it at this repo, with compose path `docker-compose.yml`.
2. Add the variables from `.env.example` for your tunnel mode. Generate secrets with `openssl rand -hex 32` (hex, because `PUBLIC_DB_PASSWORD` goes into a connection URL where base64's `/` and `+` break it).
3. Set `IMMICH_NETWORK` to your Immich stack's network (run `docker network ls`; it's usually `immich_default`). Set `IMMICH_URL` to `http://immich_server:2283`.
4. Deploy. Portainer builds the images on the server. The first sync runs at startup and then every `SYNC_INTERVAL_MINUTES`.

### 4. Admin app (`gallery-admin` hostname)
1. In Cloudflare Zero Trust, go to **Access → Applications → Add an application → Self-hosted**. Set the domain to your admin hostname (e.g. `gallery-admin.example.com`). Add an **Allow** policy with **Emails** set to your address, and use one-time PIN login.
2. On that application's **Overview**, copy the **Application Audience (AUD) Tag**. Your team domain (`<team>.cloudflareaccess.com`) is under **Settings → Custom Pages**.
3. Set the stack variables `ADMIN_DB_PASSWORD`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS` (your email) and, optionally, `PUBLIC_SITE_URL`. Then redeploy.
4. Add the tunnel's public hostname:
   - Shared tunnel: `gallery-admin.example.com` → `http://immich-showcase-admin:3001`.
   - Bundled tunnel: `gallery-admin.example.com` → `http://admin-app:3001`.

   Create the Access application **before** the route. If the route goes live first, the app still rejects everyone, because no valid Access token exists yet.

In the admin app:
- **Photos:** show or hide photos, feature them, and edit captions, tags, sort order and how precisely the location is published. Bulk-select to hide, show or feature photos, or add them to (or remove them from) a collection.
- **Collections:** sub-albums inside the gallery. A photo can be in several. Each has a title, an optional URL name (`/?c=<name>`), a description, visibility, order and a cover photo.
- **Sync:** last sync result, Immich version, and **Sync now**.

If the admin container keeps restarting, check its logs. It refuses to start with a clear message when an Access setting is missing.

### Data and backups
Everything the stack stores lives in bind mounts under `DATA_DIR` (default `/srv/docker/immich-showcase`). Docker creates the folders on first deploy.

| Folder | Contents | Owner |
|---|---|---|
| `postgres/` | Database: sync state, and later your admin edits (captions, visibility, etc.) | uid 70 (Postgres in the container) |
| `cache/` | Metadata-free WebP images; rebuilt automatically from Immich if deleted | uid 1000 (set by the one-shot `init-cache` service) |

Back up `postgres/`; `cache/` can be skipped. Back it up with the stack stopped, or with `pg_dump` while it runs, since copying the files of a running database can give an inconsistent copy.

**Moving from the old named volumes:** redeploy, then confirm the site shows photos. The first sync rebuilds everything, and `PUBLIC_ID_SECRET` keeps the URLs the same. Then remove the old `immich-showcase_db-data` and `immich-showcase_image-cache` volumes (Portainer → Volumes).

**Troubleshooting an empty site.** Check the `public-api` logs. Each sync logs the Immich version and, for each link, how many publishable images it found. If Immich reports assets for a link but none could be read, the log says `Immich reports N assets but none were parsed`. That usually means an Immich API change, and the sync keeps the photos already published rather than emptying the site.

To publish more albums, add their keys to `SHARED_LINK_KEYS` (comma-separated) and redeploy. The admin app will manage this later through the `shared_links` table.

## Development

```bash
pnpm install
```

```bash
pnpm build && pnpm test
```

```bash
./test/e2e.sh
```

The last command runs an end-to-end test of the full stack against a mock Immich. It needs Docker.

Admin-managed data:
- `photos_meta`: visibility, caption, tags, featured, sort, GPS precision, and `custom` jsonb for future inputs.
- `collections` and `collection_photos`: gallery sub-albums and their photos.

To run the admin UI locally against the test stack, use `KEEP=1 ./test/e2e.sh`. The admin app is then on `127.0.0.1:8089` and needs a `Cf-Access-Jwt-Assertion` header. The mock issues test tokens at `http://127.0.0.1:2283/__control/sign`.

## Layout

```
apps/public-api    Fastify: sync job + read-only JSON/image API
apps/public-web    Svelte 5 + Vite gallery, served by nginx
apps/admin-app     Fastify API + Svelte 5 admin UI (Cloudflare Access protected)
packages/shared    Public types + metadata allowlist (shared by API and web)
db/                Migrations + one-shot migrator image
deploy/nginx       nginx config (CSP, headers, proxy to API)
test/              Mock Immich + end-to-end test
```

## Roadmap

- **Phase 2:**
  - Metadata features: timeline, coarse map, camera/lens filters, tag filters.
  - Pagination for large libraries.
- **Phase 3 (done):** admin app.
- **Phase 4:** extra inputs (the `custom` fields).
- **Phase 5:**
  - Automated DB backups (`pg_dump` of `DATA_DIR/postgres`).
  - Prebuilt images on GHCR, so Portainer doesn't build on the server.
  - A pinned-version update policy.
