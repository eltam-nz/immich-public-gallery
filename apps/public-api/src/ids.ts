import { createHash, createHmac } from 'node:crypto';

/** Bump to force every cached image to be regenerated (e.g. after changing SIZES). */
export const PROCESSING_VERSION = '1';

export const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const VERSION_RE = /^[a-f0-9]{12}$/;

/** Opaque, stable ID derived from an Immich UUID. Immich IDs never leave the server. */
export function publicId(secret: string, kind: 'asset' | 'album', immichId: string): string {
  return createHmac('sha256', secret).update(`${kind}:${immichId}`).digest('base64url').slice(0, 16);
}

/** Content version for cache-busting image URLs. */
export function assetVersion(checksum: string): string {
  return createHash('sha256').update(`${PROCESSING_VERSION}:${checksum}`).digest('hex').slice(0, 12);
}
