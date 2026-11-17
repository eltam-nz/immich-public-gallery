/**
 * Shared types and the metadata allowlist.
 *
 * Everything that leaves the server passes through `toPublicPhoto`. A field
 * that is not explicitly copied here can never reach the public site.
 */

/** Raw EXIF fields as returned by Immich (all optional / nullable). */
export interface ImmichExif {
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  fNumber?: number | null;
  focalLength?: number | null;
  iso?: number | null;
  exposureTime?: string | null;
  dateTimeOriginal?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  description?: string | null;
}

/** Metadata stored server-side after sync (allowlisted, but GPS still exact). */
export interface StoredMeta {
  make?: string;
  model?: string;
  lens?: string;
  aperture?: number;
  focalLength?: number;
  iso?: number;
  shutter?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  country?: string;
  description?: string;
}

export interface PublicCollection {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  count: number;
}

export interface PublicPhoto {
  id: string;
  width: number;
  height: number;
  /** Local capture time without zone, e.g. "2024-06-01T14:03:22". */
  takenAt: string | null;
  camera: string | null;
  lens: string | null;
  exposure: {
    aperture?: number;
    shutter?: string;
    iso?: number;
    focalLength?: number;
  };
  location: {
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lon?: number;
  } | null;
  description: string | null;
  caption: string | null;
  tags: string[];
  featured: boolean;
  collection: { id: string; slug: string | null; title: string } | null;
  custom: Record<string, unknown>;
  src: { thumb: string; preview: string };
}

export interface SiteInfo {
  title: string;
}

const MAX_TEXT = 500;

function cleanText(v: unknown, max = 120): string | undefined {
  if (typeof v !== 'string') return undefined;
  // Strip control characters, collapse whitespace.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function cleanNum(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

/** Reduce Immich EXIF to the allowlisted fields we are willing to store. */
export function sanitizeExif(exif: ImmichExif | null | undefined): StoredMeta {
  if (!exif) return {};
  const out: StoredMeta = {
    make: cleanText(exif.make),
    model: cleanText(exif.model),
    lens: cleanText(exif.lensModel),
    aperture: cleanNum(exif.fNumber, 0.5, 128),
    focalLength: cleanNum(exif.focalLength, 1, 5000),
    iso: cleanNum(exif.iso, 1, 10_000_000),
    shutter: /^\d+(\/\d+)?(\.\d+)?$/.test(exif.exposureTime ?? '') ? exif.exposureTime! : undefined,
    latitude: cleanNum(exif.latitude, -90, 90),
    longitude: cleanNum(exif.longitude, -180, 180),
    city: cleanText(exif.city),
    state: cleanText(exif.state),
    country: cleanText(exif.country),
    description: cleanText(exif.description, MAX_TEXT),
  };
  // Drop undefined keys so the stored JSON stays compact.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as StoredMeta;
}

/** Round a coordinate to `precision` decimals; precision < 0 hides it. */
export function roundCoord(v: number | undefined, precision: number): number | undefined {
  if (v === undefined || precision < 0) return undefined;
  const p = Math.min(Math.floor(precision), 4);
  const f = 10 ** p;
  return Math.round(v * f) / f;
}

/** Camera label without duplicated brand, e.g. "Canon Canon EOS R5" -> "Canon EOS R5". */
export function cameraLabel(make?: string, model?: string): string | null {
  if (!make && !model) return null;
  if (!make) return model!;
  if (!model) return make;
  return model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]!) ? model : `${make} ${model}`;
}

export interface PhotoRow {
  public_id: string;
  version: string;
  width: number;
  height: number;
  taken_at: string | null;
  meta: StoredMeta;
  collection_id: string | null;
  collection_slug: string | null;
  collection_title: string | null;
  caption: string | null;
  tags: string[] | null;
  featured: boolean | null;
  gps_precision: number | null;
  custom: Record<string, unknown> | null;
}

/** The single gate between stored data and the public API. */
export function toPublicPhoto(row: PhotoRow, defaultGpsPrecision: number): PublicPhoto {
  const m = row.meta ?? {};
  const precision = row.gps_precision ?? defaultGpsPrecision;
  const lat = roundCoord(m.latitude, precision);
  const lon = roundCoord(m.longitude, precision);
  const location =
    m.city || m.state || m.country || lat !== undefined
      ? {
          ...(m.city && { city: m.city }),
          ...(m.state && { state: m.state }),
          ...(m.country && { country: m.country }),
          ...(lat !== undefined && lon !== undefined && { lat, lon }),
        }
      : null;
  const exposure: PublicPhoto['exposure'] = {};
  if (m.aperture !== undefined) exposure.aperture = m.aperture;
  if (m.shutter !== undefined) exposure.shutter = m.shutter;
  if (m.iso !== undefined) exposure.iso = m.iso;
  if (m.focalLength !== undefined) exposure.focalLength = m.focalLength;

  const base = `/img/${row.public_id}/${row.version}`;
  return {
    id: row.public_id,
    width: row.width,
    height: row.height,
    takenAt: row.taken_at,
    camera: cameraLabel(m.make, m.model),
    lens: m.lens ?? null,
    exposure,
    location,
    description: m.description ?? null,
    caption: row.caption,
    tags: row.tags ?? [],
    featured: row.featured ?? false,
    collection: row.collection_id
      ? { id: row.collection_id, slug: row.collection_slug, title: row.collection_title ?? '' }
      : null,
    custom: row.custom ?? {},
    src: { thumb: `${base}/thumb.webp`, preview: `${base}/preview.webp` },
  };
}
