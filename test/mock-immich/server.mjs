// Tiny stand-in for Immich's shared-link API, for end-to-end tests only.
// Records every request so the test can assert public-api only calls allowed endpoints.
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
  }
  requests.push(`${req.method} ${url.pathname}${url.searchParams.has('size') ? `?size=${url.searchParams.get('size')}` : ''}`);
  if (url.searchParams.get('key') !== KEY || revoked) return json(res, 401, { message: 'Invalid share key' });

  if (url.pathname === '/api/shared-links/me') {
    return json(res, 200, {
      id: 'link-1', type: 'ALBUM', key: KEY, showMetadata: true, allowDownload: false,
      album: { id: ALBUM, albumName: 'Summer in England' }, assets: [],
    });
  }
  if (url.pathname === `/api/albums/${ALBUM}`) {
    return json(res, 200, { id: ALBUM, albumName: 'Summer in England', assets: assets.map(strip) });
  }
  const m = url.pathname.match(/^\/api\/assets\/([0-9a-f-]{36})\/thumbnail$/);
  const asset = m && assets.find((a) => a.id === m[1]);
  if (asset) {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    return res.end(await readFile(join(fixtures, asset.file)));
  }
  json(res, 404, { message: 'Not found' });
}).listen(2283, () => console.log('mock immich on :2283'));
