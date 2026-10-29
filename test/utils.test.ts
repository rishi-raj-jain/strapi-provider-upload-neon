import { describe, expect, it } from 'vitest';
import provider from '../src/index';
import { cleanPath, encodeKey, getObjectKey, keyFromUrl, regionFromEndpoint } from '../src/utils';
import type { StrapiFile } from '../src/types';

const file = (overrides: Partial<StrapiFile> = {}): StrapiFile => ({
  name: 'photo.jpg',
  hash: 'photo_abc123',
  ext: '.jpg',
  mime: 'image/jpeg',
  size: 1,
  url: '',
  ...overrides,
});

describe('getObjectKey', () => {
  it('uses hash and ext', () => {
    expect(getObjectKey(file())).toBe('photo_abc123.jpg');
  });

  it('prefixes directory and file.path', () => {
    expect(getObjectKey(file({ path: 'a/b' }), '/uploads/')).toBe('uploads/a/b/photo_abc123.jpg');
  });

  it('drops traversal segments and odd ext characters', () => {
    expect(getObjectKey(file({ hash: '../x', ext: '.j/p?g', path: '../../etc' }), '..')).toBe('etc/x.jpg');
  });
});

describe('helpers', () => {
  it('cleanPath collapses slashes', () => {
    expect(cleanPath('//a///b/')).toBe('a/b');
  });

  it('encodeKey keeps slashes', () => {
    expect(encodeKey('my dir/a+b.png')).toBe('my%20dir/a%2Bb.png');
  });

  it('regionFromEndpoint reads Neon hosts only', () => {
    expect(regionFromEndpoint('https://br-x.storage.c-7.us-east-2.aws.neon.tech')).toBe('us-east-2');
    expect(regionFromEndpoint('https://s3.us-west-2.amazonaws.com')).toBeUndefined();
    expect(regionFromEndpoint('not a url')).toBeUndefined();
  });

  it('keyFromUrl strips base, query and encoding', () => {
    const base = 'https://br-x.storage.c-7.us-east-2.aws.neon.tech/media';
    expect(keyFromUrl(`${base}/my%20dir/a.png?X-Amz-Signature=1`, base)).toBe('my dir/a.png');
    expect(keyFromUrl('https://example.com/a.png', base)).toBeUndefined();
    expect(keyFromUrl(`${base}-other/a.png`, base)).toBeUndefined();
  });
});

describe('init', () => {
  const opts = {
    bucket: 'media',
    endpoint: 'https://br-x.storage.c-7.us-east-2.aws.neon.tech/',
    accessKeyId: 'id',
    secretAccessKey: 'secret',
  };

  it('throws without credentials', () => {
    const env = { ...process.env };
    delete process.env.AWS_ENDPOINT_URL_S3;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    try {
      expect(() => provider.init({ bucket: 'media' })).toThrow(/requires bucket, endpoint/);
    } finally {
      process.env = env;
    }
  });

  it('defaults to a public bucket', async () => {
    const p = provider.init(opts);
    expect(p.isPrivate()).toBe(false);
    const url = 'https://br-x.storage.c-7.us-east-2.aws.neon.tech/media/a.png';
    expect(await p.getSignedUrl(file({ url }))).toEqual({ url });
  });

  it('signs only URLs from its own bucket', async () => {
    const p = provider.init({ ...opts, publicFiles: false, signedUrlExpires: 60 });
    expect(p.isPrivate()).toBe(true);

    const own = await p.getSignedUrl(file({ url: 'https://br-x.storage.c-7.us-east-2.aws.neon.tech/media/a b.png' }));
    const signed = new URL(own.url);
    expect(signed.pathname).toBe('/media/a%20b.png');
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(signed.searchParams.get('X-Amz-Credential')).toContain('/us-east-2/s3/');

    const external = 'https://cdn.example.com/a.png';
    expect(await p.getSignedUrl(file({ url: external }))).toEqual({ url: external });
  });

  it('honors an explicit region and baseUrl', async () => {
    const p = provider.init({ ...opts, region: 'eu-central-1', baseUrl: 'https://cdn.example.com/', publicFiles: false });
    const { url } = await p.getSignedUrl(file({ url: 'https://cdn.example.com/x.png' }));
    // Signing still targets the Neon endpoint, never the CDN.
    expect(new URL(url).host).toBe('br-x.storage.c-7.us-east-2.aws.neon.tech');
    expect(new URL(url).pathname).toBe('/media/x.png');
    expect(new URL(url).searchParams.get('X-Amz-Credential')).toContain('/eu-central-1/s3/');
  });
});
