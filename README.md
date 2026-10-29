# Strapi Provider Upload Neon

[![npm version](https://img.shields.io/npm/v/strapi-provider-upload-neon.svg)](https://www.npmjs.com/package/strapi-provider-upload-neon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Upload files to [Neon Object Storage](https://neon.com/docs/storage) from Strapi v5, with support for public and private buckets.

## Features

- Strapi v5 compatible
- Node.js 20 and later
- TypeScript types, CommonJS and ESM builds
- Public buckets (permanent URLs)
- Private buckets (time-limited presigned URLs)
- Streaming and multipart uploads for large files
- In-place file replacement from the Media Library
- Zero-config credentials: reads the `AWS_*` variables that `neon env pull` writes

## Why not the official S3 provider?

Neon Object Storage speaks the S3 API, but `@strapi/provider-upload-aws-s3` does not work with it out of the box:

- It sends `x-amz-acl: public-read` on every upload unless you remove `ACL` by hand. Neon sets access per bucket and returns `501 NotImplemented` for that header.
- It uses virtual-hosted URLs (`bucket.host`) unless you set `forcePathStyle`. Neon serves buckets on the path.
- Private mode depends on `ACL: 'private'`, which has no effect on Neon.

This provider handles all three: it never sends an ACL, always uses path-style requests, and takes the bucket's access level from a single `publicFiles` option.

## Installation

```bash
npm install strapi-provider-upload-neon
```

## Requirements

- Node.js >= 20
- Strapi >= 5.0.0
- A Neon project with Object Storage and a bucket

## Quick Start

### 1. Create a bucket and pull credentials

With the [Neon CLI](https://neon.com/docs/reference/cli-install), from your Strapi project:

```bash
neon link
```

```bash
neon buckets create strapi-media --access-level public_read
```

```bash
neon env pull --services object-storage
```

`neon env pull` writes the branch's storage credentials to `.env` (or `.env.local`):

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_ENDPOINT_URL_S3=https://br-xxx.storage.c-7.us-east-2.aws.neon.tech
AWS_REGION=us-east-2
```

Add the bucket settings next to them:

```env
NEON_BUCKET=strapi-media
NEON_DIRECTORY=uploads
NEON_PUBLIC_FILES=true
NEON_SIGNED_URL_EXPIRES=3600
```

Strapi reads `.env` only. If the CLI wrote `.env.local`, pass `--file .env`.

For a private bucket, leave out `--access-level public_read` and set `NEON_PUBLIC_FILES=false`.

### 2. Plugin configuration

Create or update `config/plugins.ts` (or `config/plugins.js`):

**TypeScript:**

```typescript
export default ({ env }) => ({
  upload: {
    config: {
      provider: 'strapi-provider-upload-neon',
      providerOptions: {
        endpoint: env('AWS_ENDPOINT_URL_S3'),
        accessKeyId: env('AWS_ACCESS_KEY_ID'),
        secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
        region: env('AWS_REGION'),
        bucket: env('NEON_BUCKET'),
        directory: env('NEON_DIRECTORY', ''),
        publicFiles: env.bool('NEON_PUBLIC_FILES', true),
        signedUrlExpires: env.int('NEON_SIGNED_URL_EXPIRES', 3600),
      },
      sizeLimit: 250 * 1024 * 1024, // 250MB
    },
  },
});
```

**JavaScript:**

```javascript
module.exports = ({ env }) => ({
  upload: {
    config: {
      provider: 'strapi-provider-upload-neon',
      providerOptions: {
        endpoint: env('AWS_ENDPOINT_URL_S3'),
        accessKeyId: env('AWS_ACCESS_KEY_ID'),
        secretAccessKey: env('AWS_SECRET_ACCESS_KEY'),
        region: env('AWS_REGION'),
        bucket: env('NEON_BUCKET'),
        directory: env('NEON_DIRECTORY', ''),
        publicFiles: env.bool('NEON_PUBLIC_FILES', true),
        signedUrlExpires: env.int('NEON_SIGNED_URL_EXPIRES', 3600),
      },
      sizeLimit: 250 * 1024 * 1024, // 250MB
    },
  },
});
```

Use the full package name in `provider`. Strapi resolves a short name like `neon` to `@strapi/provider-upload-neon` and then to a package called `neon`, which is the Neon CLI.

The credential options are optional. When they are missing, the provider falls back to `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`.

### 3. Security configuration

Update `config/middlewares.ts` (or `config/middlewares.js`) so the admin panel can show images from Neon:

```javascript
module.exports = ({ env }) => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', env('AWS_ENDPOINT_URL_S3')],
          'media-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io', env('AWS_ENDPOINT_URL_S3')],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
```

If you set `baseUrl`, add that origin as well.

## Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `bucket` | string | Yes | - | Bucket name on the Neon branch |
| `endpoint` | string | No | `AWS_ENDPOINT_URL_S3` | S3 endpoint of the branch |
| `accessKeyId` | string | No | `AWS_ACCESS_KEY_ID` | Object Storage access key |
| `secretAccessKey` | string | No | `AWS_SECRET_ACCESS_KEY` | Object Storage secret key |
| `region` | string | No | `AWS_REGION`, then the region in the endpoint host | SigV4 signing region |
| `directory` | string | No | `''` | Folder prefix for object keys |
| `publicFiles` | boolean | No | `true` | `true` for a `public_read` bucket, `false` for a private one |
| `signedUrlExpires` | number | No | `3600` | Presigned URL lifetime in seconds (private only) |
| `baseUrl` | string | No | `{endpoint}/{bucket}` | CDN or proxy URL used in stored file URLs |
| `cacheControl` | string | No | - | `Cache-Control` header saved on each object |
| `multipart` | object | No | SDK defaults | `{ partSize, queueSize }` for multipart uploads |
| `s3Options` | object | No | - | Extra `S3Client` options, merged over the defaults |

## Public vs Private Buckets

Neon sets access per bucket, not per object. Match `publicFiles` to the bucket's access level.

### Public buckets (`publicFiles: true`)

Create the bucket with `--access-level public_read`. Files get permanent URLs that need no credentials:

```
https://br-xxx.storage.c-7.us-east-2.aws.neon.tech/strapi-media/uploads/photo_a1b2c3.jpg
```

**Best for:** public assets, images, documents

### Private buckets (`publicFiles: false`)

Create the bucket without an access level (private is the default). Strapi stores the plain object URL, which returns `403` on its own. The Media Library and the REST and GraphQL APIs swap it for a presigned URL on every read:

```
https://br-xxx.storage.c-7.us-east-2.aws.neon.tech/strapi-media/uploads/photo_a1b2c3.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...
```

**Best for:** user documents, sensitive files, access-controlled content

#### Signing a URL in your own code

```javascript
const file = await strapi.db.query('plugin::upload.file').findOne({ where: { id: fileId } });
const { url } = await strapi.plugin('upload').provider.getSignedUrl(file);
// `url` expires after signedUrlExpires seconds
```

URLs that do not belong to the configured bucket (external links, files from another provider) are returned unchanged.

## Neon branches

Each Neon branch has its own storage endpoint and credentials, and a child branch starts with a copy of its parent's buckets. Point a preview deployment at a branch with `neon env pull --branch <name>` and its uploads stay out of production.

## Troubleshooting

### Files not displaying in the admin panel

Check that `config/middlewares.js` lists your `AWS_ENDPOINT_URL_S3` (and `baseUrl`, if set) in `img-src` and `media-src`.

### `Could not load upload provider "neon"`

Set `provider` to the full package name, `strapi-provider-upload-neon`.

### Upload fails

- Check `endpoint`, `accessKeyId`, `secretAccessKey` and `bucket`
- Confirm the bucket exists on the same branch as the credentials: `neon buckets list`
- Make sure the credentials come from `neon env pull --services object-storage` for that branch

### Private files return 403

That is expected for the stored URL. Read files through Strapi (Media Library, REST, GraphQL) or call `getSignedUrl`. Check that `publicFiles` is `false`.

### Public files return 403

The bucket is private. Recreate it with `--access-level public_read`, or set `publicFiles: false`.

## Testing

```bash
npm test
```

runs the unit tests. To run the integration suite against a Neon branch, create a `public_read` bucket and a private bucket, pull the credentials, and name the buckets in `.env`:

```env
NEON_PUBLIC_BUCKET=strapi-public
NEON_PRIVATE_BUCKET=strapi-private
```

```bash
npm run test:integration
```

The integration suite covers buffer and stream uploads, a 12 MB multipart upload, keys with spaces and `+`, private reads (403 unsigned, 200 presigned), replace, and delete.

Tested on Strapi 5.60 with Neon Postgres as the database:

| Bucket Type | Upload + image formats | Media Library | Replace | Delete |
|-------------|------------------------|---------------|---------|--------|
| Public      | ✅                     | ✅            | ✅      | ✅     |
| Private     | ✅                     | ✅            | ✅      | ✅     |

## Privacy

This provider does not collect, track, or transmit any usage data. All requests go directly from your Strapi instance to your Neon branch.

## Security

- Never commit Object Storage credentials to version control
- Use environment variables for all credentials
- Keep `signedUrlExpires` short for sensitive files
- Authenticate users before you generate presigned URLs for them

## License

MIT

## Links

- [Neon Object Storage docs](https://neon.com/docs/storage)
- [Neon CLI](https://neon.com/docs/reference/neon-cli)
- [Strapi Upload docs](https://docs.strapi.io/cms/features/media-library)

## Contributing

Issues and pull requests are welcome.
