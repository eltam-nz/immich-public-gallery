import { mkdir } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { connect } from './db.js';
import { buildServer } from './server.js';
import { Syncer } from './sync.js';

const cfg = loadConfig();
await mkdir(cfg.CACHE_DIR, { recursive: true });
const sql = connect(cfg.DATABASE_URL);
const app = await buildServer(cfg, sql);
const syncer = new Syncer(cfg, sql, app.log);

const runSync = () => syncer.run().catch((err) => app.log.error({ err }, 'sync crashed'));
await app.listen({ host: '0.0.0.0', port: cfg.PORT });
void runSync();
const timer = setInterval(runSync, cfg.SYNC_INTERVAL_MINUTES * 60_000);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, async () => {
    clearInterval(timer);
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
