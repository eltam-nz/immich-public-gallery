// Generates JPEG fixtures that carry GPS + camera EXIF, so the e2e test can
// prove the served images have had all metadata stripped.
// Usage: node test/mock-immich/make-fixtures.mjs  (run from repo root after pnpm install)
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'apps/public-api/package.json'));
const sharp = require('sharp');
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
await mkdir(out, { recursive: true });

const specs = [
  { name: 'a', w: 1440, h: 960, color: '#c2410c' },
  { name: 'b', w: 960, h: 1440, color: '#0369a1' },
  { name: 'c', w: 1440, h: 1080, color: '#15803d' },
];
for (const s of specs) {
  const buf = await sharp({ create: { width: s.w, height: s.h, channels: 3, background: s.color } })
    .withExif({
      IFD0: { Make: 'Canon', Model: 'Canon EOS R5', Copyright: 'SECRET-OWNER' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
    })
    .jpeg()
    .toBuffer();
  await writeFile(join(out, `${s.name}.jpg`), buf);
}
// A 3-second 1080p video with audio, carrying the metadata that must never be
// published: GPS (two formats), creation time, device and a rotation flag.
const { execFileSync } = await import('node:child_process');
try {
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    '-metadata', 'location=+51.5007-000.1246/',
    '-metadata', 'com.apple.quicktime.location.ISO6709=+51.5007-000.1246+010.000/',
    '-metadata', 'creation_time=2024-06-01T14:03:22Z',
    '-metadata', 'make=Apple', '-metadata', 'model=iPhone 15 Pro',
    '-metadata', 'com.apple.quicktime.make=Apple', '-metadata', 'com.apple.quicktime.model=iPhone 15 Pro',
    '-metadata:s:v:0', 'rotate=90',
    '-movflags', 'use_metadata_tags',
    join(out, 'v.mp4'),
  ]);
} catch (err) {
  console.error('ffmpeg is needed on this machine to make the test video:', err.message);
  process.exit(1);
}
// A "video" that can't be decoded, to test failure handling.
await writeFile(join(out, 'bad.mp4'), Buffer.from('this is not a video'.repeat(100)));

console.log('fixtures written to', out);
