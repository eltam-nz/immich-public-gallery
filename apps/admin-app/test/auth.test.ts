import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthError, createVerifier, type Verifier } from '../server/auth.js';
import { loadConfig } from '../server/config.js';

const issuer = 'https://team.cloudflareaccess.com';
const aud = 'aud-tag-123';

let verify: Verifier;
let sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string }) => Promise<string>;
let signOther: typeof sign;

beforeAll(async () => {
  const good = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createVerifier({ issuer, audience: [aud], emails: ['Admin@Example.com'], keys: createLocalJWKSet({ keys: [jwk] }) });
  const make = (key: CryptoKey, kid: string) => (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(o.iss ?? issuer)
      .setAudience(o.aud ?? aud)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '5m')
      .sign(key);
  sign = make(good.privateKey, 'k1');
  signOther = make(other.privateKey, 'k1');
});

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof AuthError ? e.status : -1;
  }
};

describe('Cloudflare Access verifier', () => {
  it('accepts an allowed email (case-insensitive)', async () => {
    await expect(verify(await sign({ email: 'admin@example.com' }))).resolves.toEqual({ email: 'admin@example.com' });
  });
  it('rejects a missing token', async () => expect(await status(verify(undefined))).toBe(401));
  it('rejects a token signed by another key', async () =>
    expect(await status(verify(await signOther({ email: 'admin@example.com' })))).toBe(401));
  it('rejects the wrong audience', async () =>
    expect(await status(verify(await sign({ email: 'admin@example.com' }, { aud: 'other-app' })))).toBe(401));
  it('rejects the wrong issuer', async () =>
    expect(await status(verify(await sign({ email: 'admin@example.com' }, { iss: 'https://evil.cloudflareaccess.com' })))).toBe(401));
  it('rejects an expired token', async () =>
    expect(await status(verify(await sign({ email: 'admin@example.com' }, { exp: '-10m' })))).toBe(401));
  it('rejects an email that is not an admin', async () =>
    expect(await status(verify(await sign({ email: 'someone@example.com' })))).toBe(403));
  it('rejects service tokens (no email)', async () => expect(await status(verify(await sign({ common_name: 'svc' })))).toBe(403));
  it('rejects garbage', async () => expect(await status(verify('not.a.jwt'))).toBe(401));
});

describe('admin config', () => {
  const base = { DATABASE_URL: 'postgres://x', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', CF_ACCESS_AUD: 'a', ADMIN_EMAILS: 'a@b.co' };
  it('derives issuer and certs URL', () => {
    const c = loadConfig({ ...base, CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/' });
    expect(c.issuer).toBe(issuer);
    expect(c.jwksUrl).toBe(`${issuer}/cdn-cgi/access/certs`);
  });
  it('fails closed without Access settings', () => {
    expect(() => loadConfig({ ...base, CF_ACCESS_AUD: '' })).toThrow(/CF_ACCESS_AUD/);
    expect(() => loadConfig({ ...base, ADMIN_EMAILS: '' })).toThrow(/ADMIN_EMAILS/);
    expect(() => loadConfig({ DATABASE_URL: 'x', CF_ACCESS_AUD: 'a', ADMIN_EMAILS: 'a@b.co' })).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
  });
});
