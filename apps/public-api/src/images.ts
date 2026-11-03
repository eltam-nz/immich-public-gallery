/**
 * Image cache. Images are re-encoded with sharp, which drops ALL metadata
 * (EXIF, GPS, XMP, IPTC, maker notes) because we never call withMetadata().
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const SIZES = {
  thumb: { box: 720, quality: 78 },
  preview: { box: 2048, quality: 85 },
} as const;
export type SizeName = keyof typeof SIZES;
export const isSizeName = (s: string): s is SizeName => Object.hasOwn(SIZES, s);

export function imagePath(cacheDir: string, publicId: string, version: string, size: SizeName): string {
  return join(cacheDir, publicId, `${version}-${size}.webp`);
}

/** Re-encode the source into every size; returns the preview's dimensions. */
export async function writeImages(
  cacheDir: string,
  publicId: string,
  version: string,
  source: Buffer,
): Promise<{ width: number; height: number }> {
  const dir = join(cacheDir, publicId);
  await rm(dir, { recursive: true, force: true }); // drop older versions
  await mkdir(dir, { recursive: true });
  let dims = { width: 0, height: 0 };
  for (const [name, { box, quality }] of Object.entries(SIZES) as [SizeName, (typeof SIZES)[SizeName]][]) {
    const { data, info } = await sharp(source, { limitInputPixels: 100_000_000 })
      .rotate() // apply any EXIF orientation before metadata is discarded
      .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    const final = imagePath(cacheDir, publicId, version, name);
    const tmp = `${final}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, final);
    if (name === 'preview') dims = { width: info.width, height: info.height };
  }
  return dims;
}

export async function removeImages(cacheDir: string, publicId: string): Promise<void> {
  await rm(join(cacheDir, publicId), { recursive: true, force: true });
}
