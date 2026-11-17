import type { PublicPhoto } from '@showcase/shared';

export function formatDate(takenAt: string | null): string | null {
  if (!takenAt) return null;
  // takenAt is local shooting time without zone; format it as-is.
  const d = new Date(`${takenAt}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
}

export function formatExposure(e: PublicPhoto['exposure']): string[] {
  const parts: string[] = [];
  if (e.focalLength) parts.push(`${Math.round(e.focalLength)} mm`);
  if (e.aperture) parts.push(`ƒ/${e.aperture}`);
  if (e.shutter) parts.push(`${e.shutter} s`);
  if (e.iso) parts.push(`ISO ${e.iso}`);
  return parts;
}

export function formatPlace(l: PublicPhoto['location']): string | null {
  if (!l) return null;
  const s = [l.city, l.state, l.country].filter(Boolean).join(', ');
  return s || null;
}
