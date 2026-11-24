-- Video support. Videos are re-encoded to 720p (metadata stripped) by the
-- public API's background video worker; a video is published only once its
-- file is ready (video_version = cached_version).
ALTER TABLE assets
  ADD COLUMN media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  ADD COLUMN duration_ms integer,
  ADD COLUMN video_version text,
  ADD COLUMN video_bytes bigint,
  ADD COLUMN source_bytes bigint,
  ADD COLUMN video_error text,
  ADD COLUMN video_error_version text,
  ADD COLUMN video_error_at timestamptz;
CREATE INDEX assets_video_pending_idx ON assets (media_type) WHERE media_type = 'video';
