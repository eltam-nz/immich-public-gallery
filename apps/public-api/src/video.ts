/**
 * Background video worker. Videos are processed one at a time, separately from
 * the sync, so a long encode never holds up syncing:
 *   1. stream Immich's web-ready playback file to disk (never into memory)
 *   2. re-encode to 720p H.264/AAC with ALL metadata removed (GPS, dates,
 *      device, rotation tags; rotation is applied to the pixels instead)
 *   3. verify the result with ffprobe, then move it into the cache
 * A video is published only once step 3 succeeds. Failures are recorded and
 * retried after 24 hours, or when the video changes in Immich.
 */
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { ImmichClient } from './immich.js';

const RETRY_AFTER_HOURS = 24;

export function videoPath(cacheDir: string, publicId: string, version: string): string {
  return join(cacheDir, publicId, `${version}-video.mp4`);
}

/** ffmpeg arguments: 720p (short side, never upscaled), no metadata, web-friendly. */
export function ffmpegArgs(input: string, output: string, threads: number): string[] {
  // Short side capped at 720; -2 keeps the other side even. Autorotation is on
  // by default, so phone rotation is baked into the pixels before scaling.
  const scale =
    "scale=w='if(gte(iw,ih),-2,min(720,iw))':h='if(gte(iw,ih),min(720,ih),-2)':flags=lanczos";
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-map_metadata', '-1', '-map_metadata:s', '-1', '-map_chapters', '-1',
    '-vf', scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '2500k', '-bufsize', '5000k',
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
    '-threads', String(threads),
    '-f', 'mp4', output,
  ];
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d));
    p.stderr.on('data', (d: Buffer) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-400)}`)),
    );
  });
}

/** Check the encoded file really is a playable H.264 video. */
async function probe(file: string): Promise<{ width: number; height: number }> {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file,
  ]);
  const s = (JSON.parse(out) as { streams?: { codec_name?: string; width?: number; height?: number }[] }).streams?.[0];
  if (!s || s.codec_name !== 'h264' || !s.width || !s.height) throw new Error('encoded file failed verification');
  return { width: s.width, height: s.height };
}

interface Job {
  public_id: string;
  immich_asset_id: string;
  version: string;
}

export class VideoWorker {
  private running = false;
  private again = false;
  private readonly immich: ImmichClient;

  constructor(
    private readonly cfg: Config,
    private readonly sql: Sql,
    private readonly log: FastifyBaseLogger,
    /** Which shared-link key can read a given asset (set by the sync). */
    private readonly keyFor: (immichAssetId: string) => string | undefined,
  ) {
    this.immich = new ImmichClient(cfg.IMMICH_URL);
  }

  /** Process all pending videos; safe to call often (runs one pass at a time). */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.drain()
      .catch((err) => this.log.error({ err }, 'video worker crashed'))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  private async next(): Promise<Job | null> {
    // Videos whose poster is ready but whose 720p file isn't, skipping recent
    // failures of the same version.
    const [job] = await this.sql<Job[]>`
      SELECT public_id, immich_asset_id, version FROM assets
      WHERE media_type = 'video' AND cached_version = version
        AND video_version IS DISTINCT FROM version
        AND NOT (video_error_version IS NOT DISTINCT FROM version
                 AND video_error_at > now() - make_interval(hours => ${RETRY_AFTER_HOURS}))
      ORDER BY taken_at DESC NULLS LAST
      LIMIT 1`;
    return job ?? null;
  }

  private async drain(): Promise<void> {
    const tmpDir = join(this.cfg.CACHE_DIR, '.tmp');
    await mkdir(tmpDir, { recursive: true });
    for (let job = await this.next(); job; job = await this.next()) {
      const key = this.keyFor(job.immich_asset_id);
      if (!key) {
        // Not in any current shared link (yet); the next sync will tell us.
        await this.fail(job, 'not available through the shared link');
        continue;
      }
      const src = join(tmpDir, `${job.public_id}-${job.version}.src`);
      const tmpOut = join(tmpDir, `${job.public_id}-${job.version}.mp4`);
      const started = Date.now();
      try {
        const sourceBytes = await this.immich.downloadVideo(job.immich_asset_id, key, src);
        await run('nice', ['-n', '10', 'ffmpeg', ...ffmpegArgs(src, tmpOut, this.cfg.VIDEO_THREADS)]);
        const dims = await probe(tmpOut);
        const final = videoPath(this.cfg.CACHE_DIR, job.public_id, job.version);
        await rename(tmpOut, final);
        const { size } = await stat(final);
        await this.sql`
          UPDATE assets SET video_version = ${job.version}, video_bytes = ${size}, source_bytes = ${sourceBytes},
                 video_error = NULL, video_error_version = NULL, video_error_at = NULL
          WHERE public_id = ${job.public_id} AND version = ${job.version}`;
        this.log.info(
          { publicId: job.public_id, sourceMB: +(sourceBytes / 1e6).toFixed(1), outMB: +(size / 1e6).toFixed(1), ...dims, s: Math.round((Date.now() - started) / 1000) },
          'video ready',
        );
      } catch (err) {
        this.log.error({ err, publicId: job.public_id }, 'video processing failed');
        await this.fail(job, (err as Error).message);
      } finally {
        await rm(src, { force: true });
        await rm(tmpOut, { force: true });
      }
    }
  }

  private async fail(job: Job, message: string): Promise<void> {
    await this.sql`
      UPDATE assets SET video_error = ${message.slice(0, 500)}, video_error_version = ${job.version}, video_error_at = now()
      WHERE public_id = ${job.public_id}`;
  }
}
