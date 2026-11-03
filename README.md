# Immich Showcase

A self-hosted public photo site built from selected Immich albums. It runs as a Portainer stack and is published through a Cloudflare Tunnel. Immich itself is never exposed.

**Status:** Phase 1 (foundation) is done: sync from Immich shared links, image caching with metadata stripped, the public gallery, and the stack. The admin app (Phase 3) is next.

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
- **Fixed Immich calls only.** public-api only ever calls `shared-links/me`, `albums/:id` and `assets/:id/thumbnail`. The e2e test checks this.
- **Metadata allowlist.** Everything sent to the public API passes through `toPublicPhoto` in `packages/shared/src/index.ts`. Fields not copied there can't leak.
- **GPS hidden by default.** `DEFAULT_GPS_PRECISION=-1` hides coordinates. City, state and country are still shown. You can override this per photo (`photos_meta.gps_precision`).
- **Least-privilege database.** The public role can read the admin tables but not write them.
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

Per-photo overrides live in `photos_meta` and per-album overrides in `collections`:
- `photos_meta`: visibility, caption, tags, featured, sort, GPS precision, and `custom` jsonb for future inputs.
- `collections`: title, slug, visibility, order.

Until the admin app exists, you can edit these with `psql` as the owner role.

## Layout

```
apps/public-api    Fastify: sync job + read-only JSON/image API
apps/public-web    Svelte 5 + Vite gallery, served by nginx
packages/shared    Public types + metadata allowlist (shared by API and web)
db/                Migrations + one-shot migrator image
deploy/nginx       nginx config (CSP, headers, proxy to API)
test/              Mock Immich + end-to-end test
```

## Roadmap

- **Phase 2:**
  - Metadata features: timeline, coarse map, camera/lens filters, tag filters.
  - Pagination for large libraries.
- **Phase 3:** `admin-app` on `admin.example.com`, behind Cloudflare Access (allow only your email). The app verifies the `Cf-Access-Jwt-Assertion` JWT, uses a scoped Immich API key, and covers:
  - album and shared-link management
  - per-photo visibility, caption and GPS settings
  - a "sync now" button
- **Phase 4:** extra inputs (the `custom` fields).
- **Phase 5:**
  - DB backups.
  - Prebuilt images on GHCR, so Portainer doesn't build on the server.
  - A pinned-version update policy.
