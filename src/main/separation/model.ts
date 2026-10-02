// The source-separation model (htdemucs, 174 MB) is not shipped with TaBello: Meta provides the
// weights for personal and research use only, which a GPL program cannot pass on. Users download
// it once, on demand, from the npm registry (inside the demucs-js package), or import the file.
// Either way its SHA-256 is checked before use.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const MODEL_SOURCE = {
  url: 'https://registry.npmjs.org/demucs/-/demucs-1.0.0.tgz',
  entry: 'package/htdemucs.onnx',
  sha256: 'da9e5101ee0804d04933974b59d8aae9c862e80e14f2f24e7c74cae76bdbe748',
  bytes: 174_263_526,
  downloadBytes: 98_176_342,
};

export const MODEL_FILE = 'htdemucs.onnx';

export class ModelError extends Error {
  constructor(
    readonly code: 'cancelled' | 'failed' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export async function isModelInstalled(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, MODEL_FILE))).size === MODEL_SOURCE.bytes;
  } catch {
    return false;
  }
}

/** Streams the one file named `entry` out of a tar stream (ustar; npm tarballs use short names). */
async function* extractTarEntry(tar: AsyncIterable<Buffer>, entry: string): AsyncGenerator<Buffer> {
  let buffer = Buffer.alloc(0);
  let remaining = 0; // bytes of the current entry still to read
  let padding = 0; // zero bytes after it, up to the next 512-byte block
  let wanted = false;
  for await (const chunk of tar) {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      if (remaining > 0) {
        if (buffer.length === 0) break;
        const take = Math.min(remaining, buffer.length);
        if (wanted) yield buffer.subarray(0, take);
        buffer = buffer.subarray(take);
        remaining -= take;
        if (remaining === 0 && wanted) return;
        continue;
      }
      if (padding > 0) {
        const skip = Math.min(padding, buffer.length);
        buffer = buffer.subarray(skip);
        padding -= skip;
        if (padding > 0) break;
        continue;
      }
      if (buffer.length < 512) break;
      const header = buffer.subarray(0, 512);
      buffer = buffer.subarray(512);
      if (header.every((b) => b === 0)) continue; // end-of-archive blocks
      const field = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
      const prefix = field(345, 155);
      const name = (prefix ? `${prefix}/` : '') + field(0, 100);
      const size = parseInt(field(124, 12).trim() || '0', 8);
      remaining = size;
      padding = (512 - (size % 512)) % 512;
      wanted = name === entry && (field(156, 1) === '0' || field(156, 1) === '');
      if (wanted && size === 0) return;
    }
  }
  throw new ModelError('invalid', `The download does not contain ${entry}.`);
}

export interface ExpectedFile {
  sha256: string;
  bytes: number;
}

/** Writes chunks to `file` while hashing them; checks the size and SHA-256, then renames into place. */
async function writeVerified(chunks: AsyncIterable<Buffer>, file: string, expected: ExpectedFile): Promise<void> {
  const temp = `${file}.${process.pid}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    await pipeline(
      async function* () {
        for await (const chunk of chunks) {
          hash.update(chunk);
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(temp),
    );
    if (bytes !== expected.bytes || hash.digest('hex') !== expected.sha256) {
      throw new ModelError('invalid', 'This is not the expected Demucs model (htdemucs.onnx from demucs-js 1.0.0).');
    }
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export interface DownloadOptions {
  dir: string;
  /** Electron's net.fetch in the app (system proxy settings), plain fetch in tests. */
  fetch?: typeof fetch;
  url?: string;
  /** Defaults to the real model (MODEL_SOURCE); tests use small files. */
  expected?: ExpectedFile & { entry: string };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function downloadModel(options: DownloadOptions): Promise<void> {
  await mkdir(options.dir, { recursive: true });
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(options.url ?? MODEL_SOURCE.url, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw new ModelError('cancelled', 'Download cancelled.');
    throw new ModelError('failed', `Could not download the model: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok || !response.body) throw new ModelError('failed', `Could not download the model (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || MODEL_SOURCE.downloadBytes;
  let received = 0;
  const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    options.onProgress?.(Math.min(1, received / total));
  });
  try {
    const tar = body.pipe(createGunzip());
    // pipe() does not forward errors (such as an abort) downstream.
    body.on('error', (error) => tar.destroy(error));
    const expected = options.expected ?? MODEL_SOURCE;
    await writeVerified(extractTarEntry(tar, expected.entry), path.join(options.dir, MODEL_FILE), expected);
  } catch (error) {
    if (options.signal?.aborted) throw new ModelError('cancelled', 'Download cancelled.');
    if (error instanceof ModelError) throw error;
    throw new ModelError('failed', `The download failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    body.destroy();
  }
  options.onProgress?.(1);
}

/** Installs a model file the user already has (e.g. downloaded on another computer). */
export async function importModel(dir: string, source: string, expected: ExpectedFile = MODEL_SOURCE): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeVerified(createReadStream(source), path.join(dir, MODEL_FILE), expected);
}

export async function deleteModel(dir: string): Promise<void> {
  await rm(path.join(dir, MODEL_FILE), { force: true });
}
