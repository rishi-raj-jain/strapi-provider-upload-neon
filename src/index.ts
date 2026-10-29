import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ProviderOptions, StrapiFile, UploadProvider } from './types';
import { encodeKey, getObjectKey, keyFromUrl, regionFromEndpoint } from './utils';

export type { ProviderOptions, StrapiFile, UploadProvider } from './types';

export default {
  init(options: ProviderOptions): UploadProvider {
    // Fall back to the variables that `neon env pull` and Neon deployments inject.
    const endpoint = (options.endpoint ?? process.env.AWS_ENDPOINT_URL_S3 ?? '').replace(/\/+$/, '');
    const accessKeyId = options.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = options.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;
    const { bucket } = options;

    if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Neon provider requires bucket, endpoint, accessKeyId and secretAccessKey. ' +
          'Set them in providerOptions or run `neon env pull` to get the AWS_* variables.',
      );
    }

    const region = options.region ?? process.env.AWS_REGION ?? regionFromEndpoint(endpoint) ?? 'us-east-1';
    const directory = options.directory ?? '';
    const publicFiles = options.publicFiles ?? true;
    const signedUrlExpires = options.signedUrlExpires ?? 3600;
    const baseUrl = (options.baseUrl ?? `${endpoint}/${bucket}`).replace(/\/+$/, '');

    const client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      // Neon serves buckets on the path, not as subdomains.
      forcePathStyle: true,
      ...options.s3Options,
    });

    // Prefer the key stored in the URL so files survive a later `directory` change.
    const resolveKey = (file: StrapiFile) => keyFromUrl(file.url, baseUrl) ?? getObjectKey(file, directory);

    /**
     * Unified upload logic for buffers and streams.
     * No ACL header is sent: access is set per bucket on Neon.
     */
    const uploadFile = async (file: StrapiFile) => {
      const key = getObjectKey(file, directory);
      const body = file.stream ?? file.buffer;
      if (!body) {
        throw new Error(`[Neon Provider] ${file.name} has neither a stream nor a buffer`);
      }

      try {
        await new Upload({
          client,
          params: {
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: file.mime,
            ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
          },
          ...options.multipart,
        }).done();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to upload ${key} to Neon Object Storage: ${message}`);
      }

      file.url = `${baseUrl}/${encodeKey(key)}`;
    };

    const deleteKey = async (key: string) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    };

    // Upload first, then drop the old object if its key changed, so the asset is never missing.
    const replaceFile = async (newFile: StrapiFile, oldFile: StrapiFile) => {
      const oldKey = resolveKey(oldFile);
      await uploadFile(newFile);
      if (oldKey !== getObjectKey(newFile, directory)) {
        await deleteKey(oldKey);
      }
    };

    return {
      upload: uploadFile,
      uploadStream: uploadFile,

      replace: replaceFile,
      replaceStream: replaceFile,

      async delete(file) {
        await deleteKey(resolveKey(file));
      },

      isPrivate() {
        return !publicFiles;
      },

      async getSignedUrl(file) {
        const key = keyFromUrl(file.url, baseUrl);
        // Public bucket, or a URL that belongs somewhere else (another provider, external link).
        if (publicFiles || !key) {
          return { url: file.url };
        }
        const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn: signedUrlExpires,
        });
        return { url };
      },
    };
  },
};
