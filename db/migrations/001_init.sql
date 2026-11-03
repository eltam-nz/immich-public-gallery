-- Admin-managed tables. public-api may only READ these.

-- Shared-link keys to sync. (Phase 1 can also pass keys via SHARED_LINK_KEYS env.)
CREATE TABLE shared_links (
  id          serial PRIMARY KEY,
  label       text NOT NULL,
  link_key    text NOT NULL UNIQUE,
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-album overrides (title, slug, visibility, order).
CREATE TABLE collections (
  immich_album_id uuid PRIMARY KEY,
  slug            text UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
  title           text,
  description     text,
  visible         boolean NOT NULL DEFAULT true,
  sort            integer NOT NULL DEFAULT 0
);

-- Per-photo overrides and "extra inputs".
CREATE TABLE photos_meta (
  immich_asset_id uuid PRIMARY KEY,
  visible         boolean NOT NULL DEFAULT true,
  -- NULL = use DEFAULT_GPS_PRECISION; -1 = hide coordinates; 0..4 = decimals kept
  gps_precision   smallint CHECK (gps_precision BETWEEN -1 AND 4),
  caption         text,
  tags            text[] NOT NULL DEFAULT '{}',
  featured        boolean NOT NULL DEFAULT false,
  sort            integer,
  custom          jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Sync-managed tables. public-api reads and writes these.

CREATE TABLE assets (
  public_id         text PRIMARY KEY,
  immich_asset_id   uuid NOT NULL UNIQUE,
  album_id          uuid,
  album_public_id   text,
  album_name        text,
  checksum          text NOT NULL,
  version           text NOT NULL,
  taken_at          timestamp,          -- local time as shot (no zone)
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  width             integer NOT NULL DEFAULT 0,
  height            integer NOT NULL DEFAULT 0,
  cached_version    text,               -- version whose images are on disk
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  synced_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_album_idx ON assets (album_public_id);
CREATE INDEX assets_taken_idx ON assets (taken_at DESC);

CREATE TABLE sync_state (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Least-privilege grants for the public API role (created by migrate.sh).
GRANT USAGE ON SCHEMA public TO showcase_public;
GRANT SELECT ON shared_links, collections, photos_meta TO showcase_public;
GRANT SELECT, INSERT, UPDATE, DELETE ON assets, sync_state TO showcase_public;
