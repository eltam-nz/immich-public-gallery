-- City-level places. Photos are published only as "nearest city"; exact or
-- rounded coordinates are never published any more.

-- Nearest city to the photo's GPS, computed at sync time (null without GPS).
ALTER TABLE assets ADD COLUMN place jsonb;
CREATE INDEX assets_place_id_idx ON assets ((place->>'id'));

-- Per-photo location choice, managed in the admin app:
--   auto   = nearest city from GPS (default)
--   place  = a place chosen in the admin app (stored whole, so it does not
--            depend on the gazetteer version)
--   hidden = no location published
ALTER TABLE photos_meta
  ADD COLUMN location_mode text NOT NULL DEFAULT 'auto' CHECK (location_mode IN ('auto', 'place', 'hidden')),
  ADD COLUMN location_place jsonb,
  ADD CONSTRAINT photos_meta_location_place CHECK ((location_mode = 'place') = (location_place IS NOT NULL));
CREATE INDEX photos_meta_location_place_idx ON photos_meta ((location_place->>'id'));

-- Replaced by city-level places.
ALTER TABLE photos_meta DROP COLUMN gps_precision;
