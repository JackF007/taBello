import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeparationModelStatus } from '../../shared/ipc';
import { SeparationModelManager } from './manager';

let dir: string;
let server: Server;
let base: string;
// A stand-in for the model: 512 KB of incompressible bytes inside an npm-style tarball.
const model = Buffer.concat(Array.from({ length: 16_384 }, (_, i) => createHash('sha256').update(String(i)).digest()));
const expected = { entry: 'package/htdemucs.onnx', bytes: model.length, sha256: createHash('sha256').update(model).digest('hex') };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tabello-manager-'));
  await mkdir(path.join(dir, 'src/package'), { recursive: true });
  await writeFile(path.join(dir, 'src/package/htdemucs.onnx'), model);
  execFileSync('tar', ['-czf', path.join(dir, 'model.tgz'), '-C', path.join(dir, 'src'), 'package/htdemucs.onnx']);
  server = createServer((req, res) => {
    const file = path.join(dir, path.basename(req.url ?? ''));
    if (!existsSync(file)) return void res.writeHead(404).end();
    const data = readFileSync(file);
    res.writeHead(200, { 'content-length': data.length });
    // Slow enough to be stopped midway.
    let offset = 0;
    const send = () => {
      if (offset >= data.length) return void res.end();
      res.write(data.subarray(offset, offset + 16_384));
      offset += 16_384;
      setTimeout(send, 2);
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

const manager = (name: string, file = 'model.tgz') => {
  const changes: SeparationModelStatus[] = [];
  const keeper = new SeparationModelManager({
    dir: path.join(dir, name),
    source: { url: `${base}/${file}`, expected },
    onChange: (status) => changes.push(status),
  });
  return { keeper, changes };
};

describe('SeparationModelManager', () => {
  it('downloads the model by itself at the first start, telling the windows how far it is', async () => {
    const { keeper, changes } = manager('first-start');
    await keeper.ensure();
    expect((await keeper.status()).installed).toBe(true);
    expect(changes[0]).toMatchObject({ installed: false, downloading: true, progress: 0 });
    expect(changes.some((s) => s.downloading && (s.progress ?? 0) > 0 && (s.progress ?? 0) < 1)).toBe(true);
    expect(changes.at(-1)).toMatchObject({ installed: true, downloading: false, error: null });
    // Already there: nothing more to do.
    const count = changes.length;
    await keeper.ensure();
    expect(changes.length).toBe(count);
  });

  it('shares one download between the start and the user', async () => {
    const { keeper } = manager('shared');
    const automatic = keeper.ensure();
    await keeper.download();
    await automatic;
    expect((await keeper.status()).installed).toBe(true);
  });

  it('keeps the error of a failed download and tries again at the next start', async () => {
    const { keeper } = manager('offline', 'nope.tgz');
    await keeper.ensure();
    const status = await keeper.status();
    expect(status).toMatchObject({ installed: false, downloading: false });
    expect(status.error).toMatch(/HTTP 404/);
    // Next start, with a connection.
    const next = new SeparationModelManager({ dir: path.join(dir, 'offline'), source: { url: `${base}/model.tgz`, expected }, onChange: () => {} });
    await next.ensure();
    expect((await next.status()).installed).toBe(true);
  });

  it('does not download again what the user removed or stopped, until asked', async () => {
    const { keeper } = manager('removed');
    await keeper.ensure();
    expect((await keeper.remove()).installed).toBe(false);
    await keeper.ensure();
    expect((await keeper.status()).installed).toBe(false);

    // Stopped midway (once).
    let stop = true;
    const stopped: SeparationModelManager = new SeparationModelManager({
      dir: path.join(dir, 'stopped'),
      source: { url: `${base}/model.tgz`, expected },
      onChange: (status) => {
        if (stop && status.downloading && (status.progress ?? 0) > 0.2) {
          stop = false;
          stopped.cancel();
        }
      },
    });
    await stopped.ensure();
    expect(await stopped.status()).toMatchObject({ installed: false, downloading: false, error: null });
    await stopped.ensure();
    expect((await stopped.status()).installed).toBe(false);

    // Asked for: downloaded, and automatic again from then on.
    await stopped.download();
    expect((await stopped.status()).installed).toBe(true);
  });
});
