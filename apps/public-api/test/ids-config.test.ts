import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { PUBLIC_ID_RE, VERSION_RE, assetVersion, publicId } from '../src/ids.js';
import { isSizeName } from '../src/images.js';

const secret = 'x'.repeat(32);
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';

describe('ids', () => {
  it('public ids are stable, opaque and match the route regex', () => {
    const id = publicId(secret, 'asset', uuid);
    expect(id).toBe(publicId(secret, 'asset', uuid));
    expect(id).toMatch(PUBLIC_ID_RE);
    expect(id).not.toContain('aaaa');
  });
  it('asset and album namespaces differ', () => {
    expect(publicId(secret, 'asset', uuid)).not.toBe(publicId(secret, 'album', uuid));
  });
  it('version changes with checksum', () => {
    expect(assetVersion('a')).toMatch(VERSION_RE);
    expect(assetVersion('a')).not.toBe(assetVersion('b'));
  });
});

describe('images', () => {
  it('only known sizes are accepted', () => {
    expect(isSizeName('thumb')).toBe(true);
    expect(isSizeName('original')).toBe(false);
    expect(isSizeName('__proto__')).toBe(false);
  });
});

describe('config', () => {
  const base = { DATABASE_URL: 'postgres://x', IMMICH_URL: 'http://immich:2283', PUBLIC_ID_SECRET: secret };
  it('parses keys and defaults', () => {
    const c = loadConfig({ ...base, SHARED_LINK_KEYS: ' a, b ,,' });
    expect(c.sharedLinkKeys).toEqual(['a', 'b']);
    expect(c.DEFAULT_GPS_PRECISION).toBe(-1);
  });
  it('rejects a short secret', () => {
    expect(() => loadConfig({ ...base, PUBLIC_ID_SECRET: 'short' })).toThrow(/PUBLIC_ID_SECRET/);
  });
});
