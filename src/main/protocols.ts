import { net, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { MEDIA_SCHEME } from '../shared/ipc';
import { getProjectSourcePath } from './projects';

// In production the renderer is served from a custom `app://` scheme rather than file://,
// so it gets a real origin (needed by alphaTab's workers/worklets) and a CSP header we control.
export const APP_SCHEME = 'app';
export const APP_HOST = 'tabello';
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const RENDERER_DIR = path.join(import.meta.dirname, '../renderer');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `media-src 'self' blob: ${MEDIA_SCHEME}:`,
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MEDIA_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
};

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

function handleAppRequest(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    const filePath = path.join(RENDERER_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(RENDERER_DIR, filePath);
    if (host !== APP_HOST || relative.startsWith('..') || path.isAbsolute(relative)) return notFound();

    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Serves the original audio/video of a saved project, so the renderer can play it back.
 * Only files the user previously chose for transcription are reachable (looked up by project id).
 * Supports HTTP range requests, which <audio>/<video> need for seeking.
 */
function handleMediaRequest(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== 'project') return notFound();
    const sourcePath = await getProjectSourcePath(decodeURIComponent(pathname.slice(1)));
    if (!sourcePath) return notFound();

    let size: number;
    try {
      size = (await stat(sourcePath)).size;
    } catch {
      return notFound();
    }
    const headers = new Headers({
      'Content-Type': MEDIA_TYPES[path.extname(sourcePath).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    });

    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else {
        start = Math.max(0, size - Number(range[2])); // suffix range: last N bytes
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      status = 206;
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('Content-Length', String(end - start + 1));

    const body = Readable.toWeb(createReadStream(sourcePath, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status, headers });
  });
}

/** Must run after the app is ready. */
export function handleProtocols(): void {
  handleAppRequest();
  handleMediaRequest();
}
