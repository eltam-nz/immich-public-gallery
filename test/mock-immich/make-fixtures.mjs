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
console.log('fixtures written to', out);
