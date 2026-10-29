import type { StrapiFile } from './types';

/** Removes leading, trailing and repeated slashes, plus `..` segments. */
export function cleanPath(path?: string): string {
  if (!path) {
    return '';
  }
  return path
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

/** Builds `{directory}/{file.path}/{hash}{ext}` with forward slashes. */
export function getObjectKey(file: StrapiFile, directory = ''): string {
  const hash = cleanPath(file.hash);
  const ext = file.ext ? file.ext.replace(/[^a-zA-Z0-9.]/g, '') : '';
  return [cleanPath(directory), cleanPath(file.path), `${hash}${ext}`].filter(Boolean).join('/');
}

/** Percent-encodes each key segment and keeps the slashes. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/**
 * Reads the region out of a Neon storage host such as
 * `br-xxx.storage.c-7.us-east-2.aws.neon.tech`.
 */
export function regionFromEndpoint(endpoint: string): string | undefined {
  try {
    const labels = new URL(endpoint).hostname.split('.');
    const storage = labels.indexOf('storage');
    if (storage === -1 || !labels.slice(-2).join('.').endsWith('neon.tech')) {
      return undefined;
    }
    // storage . c-N . <region> . <cloud> . neon . tech
    return labels[storage + 2];
  } catch {
    return undefined;
  }
}

/** Returns the object key when `url` points into `baseUrl`, otherwise undefined. */
export function keyFromUrl(url: string, baseUrl: string): string | undefined {
  if (!url) {
    return undefined;
  }
  const prefix = `${baseUrl}/`;
  const withoutQuery = url.split(/[?#]/)[0];
  if (!withoutQuery.startsWith(prefix)) {
    return undefined;
  }
  try {
    return decodeURIComponent(withoutQuery.slice(prefix.length));
  } catch {
    return undefined;
  }
}
