import type { ReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import type { S3ClientConfig } from '@aws-sdk/client-s3';

export interface ProviderOptions {
  /** Bucket name on the Neon branch. */
  bucket: string;
  /** S3 endpoint of the branch. Defaults to `AWS_ENDPOINT_URL_S3`. */
  endpoint?: string;
  /** Defaults to `AWS_ACCESS_KEY_ID`. */
  accessKeyId?: string;
  /** Defaults to `AWS_SECRET_ACCESS_KEY`. */
  secretAccessKey?: string;
  /** SigV4 signing region. Defaults to `AWS_REGION`, then the region in the endpoint host. */
  region?: string;
  /** Folder prefix for every object key, e.g. `uploads`. */
  directory?: string;
  /**
   * `true` for a `public_read` bucket (permanent URLs).
   * `false` for a private bucket (Strapi asks for presigned URLs on read).
   */
  publicFiles?: boolean;
  /** Lifetime of presigned GET URLs for private buckets, in seconds. */
  signedUrlExpires?: number;
  /** Public base URL (CDN or proxy) that replaces `{endpoint}/{bucket}` in file URLs. */
  baseUrl?: string;
  /** `Cache-Control` header stored on every uploaded object. */
  cacheControl?: string;
  /** Multipart tuning for `@aws-sdk/lib-storage`. */
  multipart?: {
    partSize?: number;
    queueSize?: number;
  };
  /** Extra `S3Client` options, merged over the provider defaults. */
  s3Options?: Partial<S3ClientConfig>;
}

export interface StrapiFile {
  name: string;
  hash: string;
  ext?: string;
  mime: string;
  size: number;
  url: string;
  path?: string;
  buffer?: Buffer;
  stream?: Readable | ReadStream;
  [key: string]: unknown;
}

export interface UploadProvider {
  upload(file: StrapiFile): Promise<void>;
  uploadStream(file: StrapiFile): Promise<void>;
  replace(newFile: StrapiFile, oldFile: StrapiFile): Promise<void>;
  replaceStream(newFile: StrapiFile, oldFile: StrapiFile): Promise<void>;
  delete(file: StrapiFile): Promise<void>;
  /** Returns true when the bucket is private. */
  isPrivate(): boolean;
  /** Returns a presigned GET URL for private buckets, or the stored URL otherwise. */
  getSignedUrl(file: StrapiFile): Promise<{ url: string }>;
}
