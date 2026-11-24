-- Gallery-defined collections (sub-albums), managed in the admin app.
-- Replaces the Immich-album-based `collections` table from 001, which was
-- never written to (there was no admin app yet).
DROP TABLE collections;

CREATE TABLE collections (
  id              serial PRIMARY KEY,
  public_id       text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{16}$'),
  slug            text UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description     text CHECK (length(description) <= 2000),
  visible         boolean NOT NULL DEFAULT true,
  sort            integer NOT NULL DEFAULT 0,
  cover_asset_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Photo membership. No FK to `assets`: that table is sync-managed and rows can
-- disappear and come back; membership should survive that.
CREATE TABLE collection_photos (
  collection_id    integer NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  immich_asset_id  uuid NOT NULL,
  sort             integer,
  added_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, immich_asset_id)
);
CREATE INDEX collection_photos_asset_idx ON collection_photos (immich_asset_id);

-- Bound free-text fields on photo overrides.
ALTER TABLE photos_meta
  ADD CONSTRAINT photos_meta_caption_len CHECK (length(caption) <= 2000),
  ADD CONSTRAINT photos_meta_tags_len CHECK (cardinality(tags) <= 50);

-- Public API: read-only on admin data.
GRANT SELECT ON collections, collection_photos TO showcase_public;

-- Admin app (role created by migrate.sh): edits admin tables, reads sync data.
GRANT USAGE ON SCHEMA public TO showcase_admin;
GRANT SELECT ON assets, sync_state TO showcase_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON photos_meta, collections, collection_photos, shared_links TO showcase_admin;
GRANT USAGE, SELECT ON SEQUENCE collections_id_seq TO showcase_admin;
