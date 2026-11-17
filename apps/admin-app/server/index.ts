import postgres from 'postgres';
import { createVerifier, remoteKeys } from './auth.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (err) {
  // Fail closed with a readable message (shown in Portainer's container logs).
  console.error(`${(err as Error).message}\nThe admin app needs Cloudflare Access settings; see README "Admin app".`);
  process.exit(1);
}
const sql = postgres(cfg.DATABASE_URL, { max: 5, idle_timeout: 30, connect_timeout: 10, onnotice: () => {} });
const verify = createVerifier({
  issuer: cfg.issuer,
  audience: cfg.CF_ACCESS_AUD,
  emails: cfg.ADMIN_EMAILS,
  keys: remoteKeys(cfg.jwksUrl),
});
const app = await buildServer(cfg, sql, verify);
await app.listen({ host: '0.0.0.0', port: cfg.PORT });
app.log.info({ issuer: cfg.issuer, admins: cfg.ADMIN_EMAILS.length }, 'admin app ready (Cloudflare Access required)');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
