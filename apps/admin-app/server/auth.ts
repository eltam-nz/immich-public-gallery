/**
 * Cloudflare Access verification.
 *
 * Cloudflare Access sits in front of the admin hostname and adds a signed JWT
 * (Cf-Access-Jwt-Assertion) to every request it lets through. We verify that
 * JWT ourselves, so a request that reaches this container any other way (another
 * container on a shared network, a misconfigured route, Access switched off) is
 * rejected. Defence in depth: the email must also be in ADMIN_EMAILS.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

export interface Verifier {
  (token: string | undefined): Promise<{ email: string }>;
}

export function createVerifier(opts: {
  issuer: string;
  audience: string[];
  emails: string[];
  keys: JWTVerifyGetKey;
}): Verifier {
  const allowed = new Set(opts.emails.map((e) => e.toLowerCase()));
  return async (token) => {
    if (!token) throw new AuthError(401, 'missing Cloudflare Access token');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, opts.keys, {
        issuer: opts.issuer,
        audience: opts.audience,
        algorithms: ['RS256'],
        clockTolerance: 30,
      }));
    } catch {
      throw new AuthError(401, 'invalid Cloudflare Access token');
    }
    // Service tokens have no email; only people are admins.
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!email || !allowed.has(email)) throw new AuthError(403, 'not an admin');
    return { email };
  };
}

export function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
}
