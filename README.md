# Immich Showcase

A self-hosted public photo site built from one shared Immich album. It runs as a Portainer stack and is published through a Cloudflare Tunnel. Immich itself is never exposed.

**Status:** foundation, admin app, backups and the visitor-facing site are done. One Immich album is shared through a link key. Everything else is managed inside the gallery, from a private admin app: collections (sub-albums), captions, tags, visibility and each photo's place.

**The public site** is built for phones and older visitors: large text, high contrast, big labelled buttons and simple navigation (Home, collections, All photos, Map).
- **Home page:**
  - The site title, from `SITE_TITLE` (e.g. `SITE_TITLE=Matt's Photo Diary`).
  - A distinct **Photography** panel first, holding every photo ticked Featured.
  - Collection cards in the order you set in the admin app. Each card shows a 2×2 tile of four random photos spread across the collection, which changes between visits, plus the photo count and date range. A cover chosen in the admin app is always one of the four.
  - **Browse** links at the bottom (All photos, Map).
- **Collection page:** a large header photo with the title, dates and places, then a small fixed map of the towns where its photos were taken (with "Taken in" links), then the photos.
- **Map:** photos grouped by town or city, plus a plain list of places.
- **Photo viewer:** large Previous / Close / Next buttons and swipe support.

Every page has its own URL, so the browser's Back button always works.

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
- **Fixed Immich calls only.** public-api only ever calls `shared-links/me`, `albums/:id`, `timeline/buckets` and `timeline/bucket` (to list an album's assets on current Immich), `assets/:id` (date and EXIF), `assets/:id/thumbnail`, `assets/:id/video/playback` (videos), and the public `server/version` (logged for diagnostics). All of them use the shared-link key, never an API key. The e2e test checks this list against both current and older Immich API shapes.
- **Video metadata removed.** Videos are re-encoded with all container and stream metadata dropped, so no GPS, dates or device details are published. The e2e test checks the served file with ffprobe.
- **Metadata allowlist.** Everything sent to the public API passes through `toPublicPhoto` in `packages/shared/src/index.ts`. Fields not copied there can't leak.
- **Only the town or city is published.** Photo GPS is snapped to the nearest city with an offline GeoNames gazetteer, and only that city's name and its own map position are published, never a photo's coordinates. Per photo, the admin app can choose another place or hide the location.
- **Least-privilege database.** The public role can read the admin tables but not write them. The admin role can edit the admin tables (photo overrides, collections) but can only read synced data.
- **Admin app behind two locks.** Cloudflare Access must let you in, and the app then verifies Access's signed token itself (issuer, audience, expiry, signature) and checks your email against `ADMIN_EMAILS`. A request that reaches the container any other way is rejected. Without these settings the app refuses to start. Changes also need a custom request header and a same-origin request, which blocks cross-site request forgery.
- **The admin app never talks to Immich.** It has no Immich key and no route to Immich. "Sync now" is a database notification that the public API acts on.
- **Isolated networks (bundled-tunnel mode).**
  - cloudflared can only reach `public-web` and `admin-app`.
  - Only cloudflared and `admin-app` have outbound internet, through the `egress` network. The admin app needs it only to fetch Cloudflare Access's signing keys.
  - `public-web`, `public-api`, the backup service and the database sit on `internal` networks with no internet access through this stack.
  - `public-api` also joins your Immich network to reach Immich.
  - No host ports are published.
- **Shared-tunnel mode weakens isolation.** With `docker-compose.shared-tunnel.yml`, `public-web` and `admin-app` join your existing tunnel network. It can reach, and be reached by, every other container on that network, and it gains outbound internet access through it. Use bundled-tunnel mode if you want strict isolation.
- **Read-only web container.** nginx rejects anything except GET/HEAD and sets a strict CSP (no inline scripts or styles). Containers run read-only, non-root, with all capabilities dropped.
- **Outage-safe.** If Immich is unreachable during a sync, nothing is deleted. Photos are only removed when Immich says they're gone or the link has been revoked.

```
Bundled tunnel:
Internet → Cloudflare → cloudflared ─(edge)→ public-web (nginx) ─(backend)→ public-api ─(immich net)→ Immich
                │                  └─(edge)→ admin-app ─(backend)→ Postgres ←─ public-api, backup
                └─ Cloudflare Access in front of the admin hostname

Shared tunnel: your existing cloudflared ─(TUNNEL_NETWORK)→ public-web (alias immich-showcase-web)
                                                          → admin-app  (alias immich-showcase-admin)
```

## Setup

### 1. In Immich
1. Create an album with the photos you want to publish.
2. Share it → **Create link**. Turn **Show metadata** on, leave the password empty, and set no expiry (or one you'll renew).
3. Copy the key, which is the part after `/share/` in the link.

### 2. Choose a tunnel mode

**Bundled tunnel (default, strictest isolation).** The stack runs its own cloudflared.
1. In Cloudflare Zero Trust, go to **Networks → Tunnels → Create tunnel** (cloudflared) and copy the token.
2. In the stack's variables (step 4), set `COMPOSE_PROFILES=bundled-tunnel` and `TUNNEL_TOKEN`.

**Shared tunnel.** Use a cloudflared container you already run.
1. Note the Docker network that cloudflared container is on (`docker network ls`), e.g. `proxy`.
2. In Portainer (step 4), add `docker-compose.shared-tunnel.yml` under **Additional paths** and set `TUNNEL_NETWORK` to that network. Do **not** set `COMPOSE_PROFILES` or `TUNNEL_TOKEN`.
3. Read the shared-tunnel caveat under "How it stays secure".

**In either mode, recommended Cloudflare settings:**
- A rate-limiting rule on `/api/*`.
- Bot Fight Mode on.
- No cache rule is needed for images. They're `.webp` files sent with a one-year immutable cache header, so Cloudflare caches them by default (check with `curl -sI … | grep cf-cache-status`, which should show `HIT`).

### 3. Cloudflare Access for the admin app (`gallery-admin` hostname)
1. In Cloudflare Zero Trust, go to **Access → Applications → Add an application → Self-hosted**.
   - Set the domain to your admin hostname (e.g. `gallery-admin.example.com`).
   - Add an **Allow** policy with **Emails** set to your address.
   - Use one-time PIN as the only login method, with **Instant Auth** on.
2. On that application's **Overview**, copy the **Application Audience (AUD) Tag**. Your team domain (`<team>.cloudflareaccess.com`) is under **Settings → Custom Pages**.

### 4. In Portainer
1. **Stacks → Add stack → Repository.** Point it at this repo, with compose path `docker-compose.yml`. For a shared tunnel, also add `docker-compose.shared-tunnel.yml` under **Additional paths**.
2. Add the variables from `.env.example` for your tunnel mode, including `ADMIN_DB_PASSWORD`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_EMAILS` (your email) and, optionally, `PUBLIC_SITE_URL`.
   - Generate secrets with `openssl rand -hex 32`. Use hex because the passwords go into connection URLs, where base64's `/` and `+` break them.
   - Without the admin settings, the admin container refuses to start, and the rest of the stack still runs.
3. Set `IMMICH_NETWORK` to your Immich stack's network (run `docker network ls`; it's usually `immich_default`). Set `IMMICH_URL` to `http://immich_server:2283`.
4. Deploy. Portainer builds the images on the server. The first sync runs at startup and then every `SYNC_INTERVAL_MINUTES`.

### 5. Tunnel routes
- **Public site:** `photos.example.com` → `http://immich-showcase-web:8080` (shared tunnel) or `http://public-web:8080` (bundled).
- **Admin:** `gallery-admin.example.com` → `http://immich-showcase-admin:3001` (shared) or `http://admin-app:3001` (bundled).
- Create the Access application (step 3) **before** the admin route. Even if the route goes live first, the app rejects everyone, because no valid Access token exists yet.

In the admin app:
- **Photos:** show or hide photos, and edit captions, tags and sort order. Ticking **Featured** adds a photo to the home page's **Photography** section.
- **Copy to a group:** select photos, then open the photo to copy from (on a phone: **Actions → Copy from a photo…** and tap it). In its editor, **Copy to other photos** copies its caption and/or place to the selected ones. **Set caption…** in the bulk actions gives every selected photo the same caption, or clears them. Bulk-select to hide, show or feature photos, or add them to (or remove them from) a collection.
- **Location:** each photo shows its town or city, worked out from its GPS. You can choose another place (search any town or city, or pick one already in the gallery), switch back to GPS, or hide the location.
  - **Copy a place to other photos:** tick the photos that need it, open a photo that already has the right place, and click **Apply \<place\> to N selected photos**.
  - **Find photos without a place:** use the **No location** filter.
  - **Bulk:** the bulk bar's **Set location…** does the same for all ticked photos at once.
- **Collections:** sub-albums inside the gallery. A photo can be in several. Each has a title, an optional URL name (`/?c=<name>`), a description, visibility and a cover photo. Their **public order** on the home page is set with ↑ ↓ (or by dragging on desktop).
- **Sync:** last sync result, Immich version, and **Sync now**.

**On a phone** the admin app has bottom tabs (Photos, Collections, Sync).
- **Select several photos:** tap **Select**, tap the photos, then **Actions** for show/hide, collections and location.
- **Edit photos one after another:** in the editor, use **‹ ›** (or swipe on the photo) and **Save & next**. The phone's **Back** button closes the editor.
- **Reorder collections:** use the **↑ ↓** buttons, or drag ⠿ on desktop.
- **On desktop:** Ctrl/⌘-click or Shift-click to select, and **J** / **K** for the previous / next photo and **Ctrl+S** to save in the editor.

If the admin container keeps restarting, check its logs. It refuses to start with a clear message when an Access setting is missing.

### Data and backups
Everything the stack stores lives in bind mounts under `DATA_DIR` (default `/srv/docker/immich-showcase`). Docker creates the folders on first deploy.

| Folder | Contents | Owner |
|---|---|---|
| `postgres/` | Database: sync state plus your admin edits (collections, captions, tags, visibility) | uid 70 (Postgres in the container) |
| `cache/` | Metadata-free WebP images; rebuilt automatically from Immich if deleted | uid 1000 (set by the one-shot `init-dirs` service) |
| `backups/` | Database backups (default location; see below) | uid 1000 |

#### Backups
The `backup` service writes a verified `pg_dump` of the database every `BACKUP_INTERVAL_HOURS` (default 24) and keeps the newest `BACKUP_KEEP` (default 14). Each dump is checked with `pg_restore --list` before it counts. Files are named `showcase-<UTC date>-<time>.dump` and are owned by uid 1000. The first backup runs as soon as the stack starts. If backups stop working, the container shows **unhealthy** in Portainer.

- **Where:** `BACKUP_DIR`, which defaults to `$DATA_DIR/backups`. Put it on a different drive from the database, e.g. `/mnt/hdd1-main/files/backups/immich-showcase`, so one failed disk can't take both. If Syncthing syncs that folder to another device, you also get an off-server copy.
- **What to back up:** only the database. `cache/` rebuilds itself from Immich.
- **Back up now:**
  ```bash
  docker exec immich-showcase-backup-1 backup.sh once
  ```
- **Restore** (replaces the current gallery database with the dump):
  ```bash
  docker stop immich-showcase-admin-app-1 immich-showcase-public-api-1 immich-showcase-backup-1
  ```
  ```bash
  docker exec -i immich-showcase-db-1 pg_restore -U showcase_owner -d showcase --clean --if-exists < /path/to/showcase-YYYYMMDD-HHMMSS.dump
  ```
  ```bash
  docker start immich-showcase-public-api-1 immich-showcase-admin-app-1 immich-showcase-backup-1
  ```
  The next sync brings photos up to date with Immich. Your collections, captions and settings come from the dump.

**Moving from the old named volumes:** redeploy, then confirm the site shows photos. The first sync rebuilds everything, and `PUBLIC_ID_SECRET` keeps the URLs the same. Then remove the old `immich-showcase_db-data` and `immich-showcase_image-cache` volumes (Portainer → Volumes).

**Troubleshooting an empty site.** Check the `public-api` logs. Each sync logs the Immich version and, for each link, how many publishable images it found. If Immich reports assets for a link but none could be read, the log says `Immich reports N assets but none were parsed`. That usually means an Immich API change, and the sync keeps the photos already published rather than emptying the site.

The gallery shares one Immich album through `SHARED_LINK_KEYS`. Several comma-separated keys also work.

### Videos
Videos in the shared album are published as well as photos.
- **Processing:** the public API downloads Immich's web-ready version of each video (using the shared-link key, like photos) and re-encodes it to **720p H.264/AAC**.
  - It **removes all metadata**: GPS, recording date, device and rotation tags. Rotation is applied to the picture itself.
  - It checks the result before publishing.
  - This runs in the background, one video at a time and at low priority (`VIDEO_THREADS`, default 2), so syncing and the site stay responsive.
  - The first sync of an album with many videos can keep the CPU busy for a while.
- **Publishing:** a video appears on the site once its 720p file is ready. Until then the admin app shows it as **Processing…**. If one can't be processed, the admin app marks it **Not published** with a ⚠ and the reason, and it's retried after 24 hours or when the video changes in Immich.
- **Size warnings:** every video is published, whatever its size. The admin app shows a ⚠ on videos larger than `VIDEO_WARN_MB` (default 500 MB, measured as received from Immich). The **Videos with warnings** filter lists them.
- **Disk:** 720p files take roughly 20 MB per minute of video, in `cache/`. Like images, they're rebuilt from Immich if deleted, so they don't need backing up.
- **Playback:** the site plays videos with the browser's own player. Files are served with byte-range support, which iPhones need.
- **Cloudflare:** its free-plan terms say the CDN shouldn't be used to serve a disproportionate amount of video. A personal site with modest, 720p-capped video is the kind of use that's typically fine, but check the current terms if you publish a lot of video.

### Map and places: what visitors' browsers contact
- **Map tiles:** the Map page and the small map on collection pages load tiles from OpenStreetMap (`tile.openstreetmap.org`). That's the only third-party host the site uses, and only on those pages. Tile requests carry only the site's origin as the referrer, as OpenStreetMap's usage policy asks.
- **Place lookups:** done offline on the server, using GeoNames data built into the image. Credit: map © OpenStreetMap contributors; places © GeoNames (CC BY 4.0), shown on the map.

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

The last command runs an end-to-end test of the full stack against a mock Immich. It needs Docker and ffmpeg (for the test video).

Optional browser checks run against a seeded test stack. They take screenshots at phone and desktop sizes, run an accessibility scan, check tap-target and text sizes, and walk through the main admin phone workflows. They need Playwright with Chromium installed and `npm install --prefix test/ui`:

```bash
./test/ui/run.sh
```

Admin-managed data:
- `photos_meta`: visibility, caption, tags, featured, sort, location choice (`location_mode`, `location_place`), and `custom` jsonb for future inputs.
- `collections` and `collection_photos`: gallery sub-albums and their photos.

To run the admin UI locally against the test stack, use `KEEP=1 ./test/e2e.sh`. The admin app is then on `127.0.0.1:8089` and needs a `Cf-Access-Jwt-Assertion` header. The mock issues test tokens at `http://127.0.0.1:2283/__control/sign`.

## Layout

```
apps/public-api    Fastify: sync job + read-only JSON/image API
apps/public-web    Svelte 5 + Vite gallery, served by nginx
apps/admin-app     Fastify API + Svelte 5 admin UI (Cloudflare Access protected)
packages/shared    Public types + metadata allowlist (shared by API and web)
packages/geo       Offline gazetteer: nearest city + place search (GeoNames data)
db/                Migrations + one-shot migrator image
deploy/nginx       nginx config (CSP, headers, proxy to API)
test/              Mock Immich, end-to-end test, optional browser checks (test/ui)
```

## Roadmap

- **Phase 2 (partly done):** home page, collection cards and city-level maps are done. Still to do:
  - a date timeline
  - camera/lens and tag filters
  - paging for large libraries
- **Phase 3 (done):** admin app.
- **Phase 4:** extra inputs (the `custom` fields).
- **Phase 5:**
  - Prebuilt images on GHCR, so Portainer doesn't build on the server.
  - A pinned-version update policy.
