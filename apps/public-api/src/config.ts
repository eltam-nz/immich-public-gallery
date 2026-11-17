import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Internal URL of the Immich server, e.g. http://immich_server:2283 */
  IMMICH_URL: z.string().url(),
  /** Comma-separated shared-link keys (in addition to enabled rows in shared_links). */
  SHARED_LINK_KEYS: z.string().default(''),
  /** Secret used to derive opaque public IDs. Changing it changes every public URL. */
  PUBLIC_ID_SECRET: z.string().min(32, 'PUBLIC_ID_SECRET must be at least 32 characters'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().min(1).default(15),
  /** -1 hides coordinates; 0-4 keeps that many decimals (1 ≈ 11 km, 2 ≈ 1.1 km). */
  DEFAULT_GPS_PRECISION: z.coerce.number().int().min(-1).max(4).default(-1),
  CACHE_DIR: z.string().default('/cache'),
  SITE_TITLE: z.string().default('Photos'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof schema> & { sharedLinkKeys: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const sharedLinkKeys = parsed.data.SHARED_LINK_KEYS.split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return { ...parsed.data, sharedLinkKeys };
}
