// Tiny stand-in for Immich's shared-link API, for end-to-end tests only.
// Records every request so the test can assert public-api only calls allowed endpoints.
//
// MOCK_IMMICH_MODE=current (default): like current Immich, the album response has
//   assetCount but no assets; assets are listed via /timeline/* and /assets/:id.
// MOCK_IMMICH_MODE=legacy: like older Immich, the album response includes assets.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const KEY = 'test-shared-link-key';
const ALBUM = '11111111-1111-4111-8111-111111111111';
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`;

const exif = (extra) => ({
  make: 'Canon', model: 'Canon EOS R5', lensModel: 'RF24-70mm F2.8 L IS USM',
  fNumber: 2.8, focalLength: 35, iso: 200, exposureTime: '1/250',
  latitude: 51.500729, longitude: -0.124625, city: 'London', state: 'England', country: 'United Kingdom',
  serialNumber: 'SHOULD-NOT-LEAK', fileSizeInByte: 123456, ...extra,
});
let assets = [
  { id: id(1), type: 'IMAGE', checksum: 'c1', localDateTime: '2024-06-01T14:03:22.000Z', exifInfo: exif({ description: 'Westminster at dusk' }), file: 'a.jpg' },
  { id: id(2), type: 'IMAGE', checksum: 'c2', localDateTime: '2024-06-02T09:00:00.000Z', exifInfo: exif({}), file: 'b.jpg' },
  { id: id(3), type: 'IMAGE', checksum: 'c3', localDateTime: '2023-12-24T18:30:00.000Z', exifInfo: exif({ city: 'Bath' }), file: 'c.jpg' },
  { id: id(4), type: 'VIDEO', checksum: 'c4', localDateTime: '2024-01-01T00:00:00.000Z', exifInfo: null, file: 'a.jpg' },
];
let revoked = false;
let brokenTimeline = false; // simulate an API change: timeline lists nothing
let detail404 = null; // asset id whose /assets/:id returns 404
const MODE = process.env.MOCK_IMMICH_MODE === 'legacy' ? 'legacy' : 'current';
const monthOf = (a) => `${a.localDateTime.slice(0, 7)}-01T00:00:00.000Z`;
const requests = [];

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const strip = ({ file, ...a }) => a;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/__control/')) {
    if (url.pathname === '/__control/requests') return json(res, 200, requests);
    if (url.pathname === '/__control/revoke') { revoked = true; return json(res, 200, { ok: true }); }
    if (url.pathname === '/__control/remove-one') { assets = assets.filter((a) => a.id !== id(3)); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__control/detail-404') { detail404 = id(2); return json(res, 200, { ok: true }); }
    if (url.pathname === '/__control/mode') return json(res, 200, { mode: MODE });
    if (url.pathname === '/__control/break-timeline') { brokenTimeline = true; return json(res, 200, { ok: true }); }
  }
  requests.push(`${req.method} ${url.pathname}${url.searchParams.has('size') ? `?size=${url.searchParams.get('size')}` : ''}`);
  if (url.pathname === '/api/server/version') return json(res, 200, { major: MODE === 'legacy' ? 1 : 2, minor: 0, patch: 0 });
  if (url.searchParams.get('key') !== KEY || revoked) return json(res, 401, { message: 'Invalid share key' });

  if (url.pathname === '/api/shared-links/me') {
    return json(res, 200, {
      id: 'link-1', type: 'ALBUM', key: KEY, showMetadata: true, allowDownload: false,
      album: { id: ALBUM, albumName: 'Summer in England' }, assets: [],
    });
  }
  if (url.pathname === `/api/albums/${ALBUM}`) {
    const album = { id: ALBUM, albumName: 'Summer in England', assetCount: assets.length };
    return json(res, 200, MODE === 'legacy' ? { ...album, assets: assets.map(strip) } : album);
  }
  if (MODE === 'current' && url.pathname === '/api/timeline/buckets' && url.searchParams.get('albumId') === ALBUM) {
    const counts = new Map();
    for (const a of assets) counts.set(monthOf(a), (counts.get(monthOf(a)) ?? 0) + 1);
    return json(res, 200, [...counts].map(([timeBucket, count]) => ({ timeBucket, count })));
  }
  if (MODE === 'current' && url.pathname === '/api/timeline/bucket' && url.searchParams.get('albumId') === ALBUM) {
    const inBucket = brokenTimeline ? [] : assets.filter((a) => monthOf(a) === url.searchParams.get('timeBucket'));
    return json(res, 200, {
      id: inBucket.map((a) => a.id),
      isImage: inBucket.map((a) => a.type === 'IMAGE'),
      isTrashed: inBucket.map(() => false),
      visibility: inBucket.map(() => 'timeline'),
      ratio: inBucket.map(() => 1.5),
    });
  }
  const detail = url.pathname.match(/^\/api\/assets\/([0-9a-f-]{36})$/);
  if (MODE === 'current' && detail) {
    const a = assets.find((x) => x.id === detail[1]);
    if (!a || a.id === detail404) return json(res, 404, { message: 'Not found' });
    return json(res, 200, { ...strip(a), visibility: 'timeline', isTrashed: false });
  }
  const m = url.pathname.match(/^\/api\/assets\/([0-9a-f-]{36})\/thumbnail$/);
  const asset = m && assets.find((a) => a.id === m[1]);
  if (asset) {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    return res.end(await readFile(join(fixtures, asset.file)));
  }
  json(res, 404, { message: 'Not found' });
}).listen(2283, () => console.log('mock immich on :2283'));
