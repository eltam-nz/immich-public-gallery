/**
 * Serving cached files with HTTP Range support (Node only; used by both
 * servers). Browsers (Safari on iPhone in particular) fetch video in byte
 * ranges and won't play it without 206 replies.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export type ByteRange = { start: number; end: number };

/**
 * Parse a single "bytes=a-b" range for a file of `size` bytes.
 * null = no usable Range header (send the whole file); 'unsatisfiable' = 416.
 * Multi-range requests are answered with the whole file, which RFC 9110 allows.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** The parts of a Fastify reply used here (kept structural so this package needs no Fastify). */
interface Reply {
  code(statusCode: number): Reply;
  header(key: string, value: string | number): Reply;
  send(payload?: unknown): Reply;
}

/** Send a file (whole or the requested range); 404 if it's missing. */
export async function sendFile<R extends Reply>(
  reply: R,
  path: string,
  opts: { type: string; cacheControl: string; range?: string },
): Promise<R> {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return reply.code(404).send({ error: 'not_found' }) as R;
  reply.header('content-type', opts.type).header('accept-ranges', 'bytes').header('cache-control', opts.cacheControl);
  const range = parseRange(opts.range, st.size);
  if (range === 'unsatisfiable') {
    return reply.code(416).header('content-range', `bytes */${st.size}`).send() as R;
  }
  if (range) {
    return reply
      .code(206)
      .header('content-range', `bytes ${range.start}-${range.end}/${st.size}`)
      .header('content-length', range.end - range.start + 1)
      .send(createReadStream(path, { start: range.start, end: range.end })) as R;
  }
  return reply.header('content-length', st.size).send(createReadStream(path)) as R;
}
