// Runs against a real Neon branch. Needs the AWS_* variables from `neon env pull --services object-storage`
// plus NEON_PUBLIC_BUCKET (a public_read bucket) and NEON_PRIVATE_BUCKET (a private bucket).
import { createReadStream, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import provider from '../src/index';
import type { StrapiFile, UploadProvider } from '../src/types';

const { AWS_ENDPOINT_URL_S3, NEON_PUBLIC_BUCKET, NEON_PRIVATE_BUCKET } = process.env;
const enabled = Boolean(AWS_ENDPOINT_URL_S3 && NEON_PUBLIC_BUCKET && NEON_PRIVATE_BUCKET);
const run = `test-${randomUUID().slice(0, 8)}`;

const makeFile = (hash: string, body: Buffer, extra: Partial<StrapiFile> = {}): StrapiFile => ({
  name: `${hash}.txt`,
  hash,
  ext: '.txt',
  mime: 'text/plain',
  size: body.length / 1000,
  url: '',
  buffer: body,
  ...extra,
});

const cleanup: Array<[UploadProvider, StrapiFile]> = [];

describe.runIf(enabled)('Neon Object Storage integration', () => {
  // Credentials and endpoint come from the environment only.
  // Created in beforeAll because describe bodies run during collection even when skipped.
  let pub: UploadProvider;
  let priv: UploadProvider;

  beforeAll(() => {
    pub = provider.init({ bucket: NEON_PUBLIC_BUCKET!, directory: run, cacheControl: 'public, max-age=60' });
    priv = provider.init({ bucket: NEON_PRIVATE_BUCKET!, directory: run, publicFiles: false, signedUrlExpires: 120 });
  });

  afterAll(async () => {
    await Promise.allSettled(cleanup.map(([p, f]) => p.delete(f)));
  });

  it('uploads a buffer to a public bucket and serves it anonymously', async () => {
    const body = Buffer.from('hello neon');
    const file = makeFile('buffer_1', body);
    await pub.upload(file);
    cleanup.push([pub, file]);

    expect(file.url).toBe(`${AWS_ENDPOINT_URL_S3}/${NEON_PUBLIC_BUCKET}/${run}/buffer_1.txt`);
    const res = await fetch(file.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.text()).toBe('hello neon');
    expect(await pub.getSignedUrl(file)).toEqual({ url: file.url });
  });

  it('streams a 12 MB file through multipart upload', async () => {
    const body = randomBytes(12 * 1024 * 1024);
    const path = join(tmpdir(), `${run}-big.bin`);
    writeFileSync(path, body);
    const file = makeFile('stream_big', body, {
      ext: '.bin',
      mime: 'application/octet-stream',
      buffer: undefined,
      stream: createReadStream(path),
    });
    await pub.uploadStream(file);
    cleanup.push([pub, file]);

    const res = await fetch(file.url);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  }, 120_000);

  it('streams a Readable of unknown length', async () => {
    const file = makeFile('stream_small', Buffer.alloc(0), {
      buffer: undefined,
      stream: Readable.from([Buffer.from('chunk-1 '), Buffer.from('chunk-2')]),
    });
    await pub.uploadStream(file);
    cleanup.push([pub, file]);
    expect(await (await fetch(file.url)).text()).toBe('chunk-1 chunk-2');
  });

  it('encodes folder paths with spaces and plus signs', async () => {
    const file = makeFile('nested', Buffer.from('nested'), { path: 'my folder/a+b' });
    await pub.upload(file);
    cleanup.push([pub, file]);

    expect(file.url).toContain(`/${run}/my%20folder/a%2Bb/nested.txt`);
    expect(await (await fetch(file.url)).text()).toBe('nested');
  });

  it('keeps private files private and signs them on demand', async () => {
    const file = makeFile('secret', Buffer.from('top secret'));
    await priv.upload(file);
    cleanup.push([priv, file]);

    expect(priv.isPrivate()).toBe(true);
    expect((await fetch(file.url)).status).toBe(403);

    const { url } = await priv.getSignedUrl(file);
    expect(url).toContain('X-Amz-Signature=');
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('top secret');
  });

  it('replace uploads the new object and removes the old one', async () => {
    const oldFile = makeFile('replace_old', Buffer.from('old'));
    await pub.upload(oldFile);
    const newFile = makeFile('replace_new', Buffer.from('new'));
    await pub.replaceStream(newFile, oldFile);
    cleanup.push([pub, newFile]);

    expect((await fetch(oldFile.url)).status).toBe(404);
    expect(await (await fetch(newFile.url)).text()).toBe('new');
  });

  it('replace with the same key overwrites in place', async () => {
    const file = makeFile('replace_same', Buffer.from('v1'));
    await pub.upload(file);
    cleanup.push([pub, file]);
    await pub.replace(makeFile('replace_same', Buffer.from('v2')), file);
    expect(await (await fetch(file.url, { cache: 'no-store' })).text()).toBe('v2');
  });

  it('deletes by the stored URL even after the directory changes', async () => {
    const file = makeFile('moved', Buffer.from('bye'));
    await pub.upload(file);
    const other = provider.init({ bucket: NEON_PUBLIC_BUCKET!, directory: 'somewhere-else' });
    await other.delete(file);
    expect((await fetch(file.url)).status).toBe(404);
  });

  it('deleting a missing object does not throw', async () => {
    await expect(pub.delete(makeFile('never_uploaded', Buffer.from('')))).resolves.toBeUndefined();
  });

  it('reports a wrong bucket clearly', async () => {
    const bad = provider.init({ bucket: `missing-${run}` });
    await expect(bad.upload(makeFile('x', Buffer.from('x')))).rejects.toThrow(/Failed to upload .* to Neon Object Storage/);
  });
});
