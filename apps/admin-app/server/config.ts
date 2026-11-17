import { z } from 'zod';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const schema = z.object({
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().min(1),
  /** Zero Trust team domain, e.g. "myteam.cloudflareaccess.com". */
  CF_ACCESS_TEAM_DOMAIN: z
    .string()
    .transform((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    .pipe(z.string().regex(/^[a-z0-9.-]+$/i, 'CF_ACCESS_TEAM_DOMAIN must be a hostname like myteam.cloudflareaccess.com')),
  /** Application Audience (AUD) tag(s) of the Access application. Comma-separated. */
  CF_ACCESS_AUD: z.string().transform(list).pipe(z.array(z.string()).min(1, 'CF_ACCESS_AUD is required')),
  /** Emails allowed into the admin app, in addition to the Access policy. Comma-separated. */
  ADMIN_EMAILS: z
    .string()
    .transform((s) => list(s.toLowerCase()))
    .pipe(z.array(z.string().email()).min(1, 'ADMIN_EMAILS is required')),
  /** Override for the signing-keys URL (tests only). Defaults to the team's Access certs. */
  CF_ACCESS_JWKS_URL: z.string().url().optional(),
  CACHE_DIR: z.string().default('/cache'),
  PUBLIC_SITE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  DEFAULT_GPS_PRECISION: z.coerce.number().int().min(-1).max(4).default(-1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof schema> & { issuer: string; jwksUrl: string };

/** Fails closed: the admin app refuses to start without complete Access settings. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ');
    throw new Error(`Invalid admin configuration: ${msg}`);
  }
  const issuer = `https://${parsed.data.CF_ACCESS_TEAM_DOMAIN}`;
  return {
    ...parsed.data,
    issuer,
    jwksUrl: parsed.data.CF_ACCESS_JWKS_URL ?? `${issuer}/cdn-cgi/access/certs`,
  };
}
