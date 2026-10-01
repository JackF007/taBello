import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadModel, importModel, MODEL_FILE, ModelError } from './model';

let dir: string;
let server: Server;
let base: string;
// A stand-in for the model: 1 MB of incompressible (hash-chained) bytes inside an npm-style tarball.
const model = Buffer.concat(
  Array.from({ length: 32_768 }, (_, i) => createHash('sha256').update(String(i)).digest()),
);
const expected = { entry: 'package/htdemucs.onnx', bytes: model.length, sha256: createHash('sha256').update(model).digest('hex') };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tabello-model-'));
  await mkdir(path.join(dir, 'src/package'), { recursive: true });
  await writeFile(path.join(dir, 'src/package/README.md'), 'readme');
  await writeFile(path.join(dir, 'src/package/htdemucs.onnx'), model);
  execFileSync('tar', ['-czf', path.join(dir, 'model.tgz'), '-C', path.join(dir, 'src'), 'package/README.md', 'package/htdemucs.onnx']);
  execFileSync('tar', ['-czf', path.join(dir, 'empty.tgz'), '-C', path.join(dir, 'src'), 'package/README.md']);
  server = createServer((req, res) => {
    const file = path.join(dir, path.basename(req.url ?? ''));
    if (!existsSync(file)) return void res.writeHead(404).end();
    const data = readFileSync(file);
    res.writeHead(200, { 'content-length': data.length });
    // Slow enough to be cancelled midway.
    let offset = 0;
    const send = () => {
      if (offset >= data.length) return void res.end();
      res.write(data.subarray(offset, offset + 16_384));
      offset += 16_384;
      setTimeout(send, 1);
    };
    send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

describe('downloadModel', () => {
  it('extracts and verifies the model from the tarball', async () => {
    const target = path.join(dir, 'ok');
    const progress: number[] = [];
    await downloadModel({ dir: target, url: `${base}/model.tgz`, expected, onProgress: (f) => progress.push(f) });
    expect(readFileSync(path.join(target, MODEL_FILE)).equals(model)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(2);
  });

  it('rejects a file with the wrong checksum and leaves nothing behind', async () => {
    const target = path.join(dir, 'bad');
    await expect(downloadModel({ dir: target, url: `${base}/model.tgz`, expected: { ...expected, sha256: '0'.repeat(64) } })).rejects.toMatchObject({ code: 'invalid' });
    expect(await readdir(target)).toEqual([]);
  });

  it('reports a missing model, an HTTP error and a cancelled download', async () => {
    await expect(downloadModel({ dir: path.join(dir, 'empty'), url: `${base}/empty.tgz`, expected })).rejects.toMatchObject({ code: 'invalid' });
    await expect(downloadModel({ dir: path.join(dir, 'missing'), url: `${base}/nope.tgz`, expected })).rejects.toMatchObject({ code: 'failed' });
    const controller = new AbortController();
    const pending = downloadModel({
      dir: path.join(dir, 'cancel'),
      url: `${base}/model.tgz`,
      expected,
      signal: controller.signal,
      onProgress: (f) => f > 0.2 && controller.abort(),
    });
    await expect(pending).rejects.toBeInstanceOf(ModelError);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('importModel', () => {
  it('copies a verified model file', async () => {
    await importModel(path.join(dir, 'imported'), path.join(dir, 'src/package/htdemucs.onnx'), expected);
    expect(readFileSync(path.join(dir, 'imported', MODEL_FILE)).equals(model)).toBe(true);
    await expect(importModel(path.join(dir, 'wrong'), path.join(dir, 'src/package/README.md'), expected)).rejects.toMatchObject({ code: 'invalid' });
  });
});
