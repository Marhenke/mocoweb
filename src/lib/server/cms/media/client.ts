/**
 * S3 client for the CMS media engine.
 *
 * Configured purely from environment variables — BUCKET, ENDPOINT,
 * ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION — which is exactly the shape
 * Railway Buckets injects in production. Nothing here hardcodes a provider:
 * the same code talks to the SeaweedFS container in docker-compose.dev.yml
 * locally and to Railway Buckets in production because both speak the S3
 * API and both are reached the same way, through this client.
 *
 * `forcePathStyle: true` is required for most non-AWS S3-compatible services
 * (SeaweedFS, Railway Buckets included) — they don't support the
 * virtual-hosted-style `bucket.endpoint.tld` addressing AWS defaults to.
 *
 * Lives under `src/lib/server/`, SvelteKit's server-only import boundary, so
 * these credentials can never end up in a client bundle.
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set. Copy .env.example to .env and adjust it.`);
	}
	return value;
}

export const MEDIA_BUCKET = requireEnv('BUCKET');

export const s3 = new S3Client({
	endpoint: requireEnv('ENDPOINT'),
	region: requireEnv('REGION'),
	credentials: {
		accessKeyId: requireEnv('ACCESS_KEY_ID'),
		secretAccessKey: requireEnv('SECRET_ACCESS_KEY')
	},
	forcePathStyle: true
});

/**
 * Idempotently makes sure the configured bucket exists, memoized for the
 * process's lifetime. In production the bucket is provisioned externally
 * (Railway Buckets creates it for you) so this is normally a single
 * HeadBucket no-op; it exists so local dev works with a single
 * `docker compose up` against a brand-new, empty S3-compatible service
 * without a separate manual bootstrap step.
 *
 * This isn't just a convenience: at least one S3-compatible server (the
 * SeaweedFS gateway used for local dev here) will silently accept
 * PutObject calls into a bucket that was never formally created, then
 * fail every subsequent GetObject for that same bucket with
 * "NoSuchBucket" -- an inconsistent state that's invisible until someone
 * tries to actually read an object back. Calling this before the first
 * write avoids relying on that kind of implicit auto-vivification.
 */
let bucketReady: Promise<void> | undefined;
export function ensureMediaBucket(): Promise<void> {
	if (!bucketReady) {
		bucketReady = (async () => {
			try {
				await s3.send(new HeadBucketCommand({ Bucket: MEDIA_BUCKET }));
			} catch {
				try {
					await s3.send(new CreateBucketCommand({ Bucket: MEDIA_BUCKET }));
				} catch (err: unknown) {
					const name = (err as { name?: string })?.name;
					if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
						throw err;
					}
				}
			}
		})();
	}
	return bucketReady;
}

/**
 * Best-effort "is object storage reachable right now" check with a few
 * quick retries, used by the health endpoint (`/api/health`) and the startup
 * cache warm (Lane B2) — mirrors `pingDatabase` in `../db/client.ts`. A
 * plain `HeadBucketCommand`, not `ensureMediaBucket()`: this must never
 * create the bucket as a side effect of a health check, only report whether
 * the S3-compatible endpoint answers at all.
 *
 * Each attempt carries its own `abortSignal` timeout (mirrors
 * `pingDatabase`'s `attemptTimeoutMs` race) so a connection stuck mid-TCP
 * (the endpoint's process is gone but the OS hasn't reported the socket as
 * closed yet) can't make a health check hang past what a visitor-facing
 * check is allowed to take — the AWS SDK's own default socket/connection
 * timeouts are tuned for throughput, not for "answer in under a few
 * seconds or say so."
 */
export async function pingStorage(
	opts: { retries?: number; backoffMs?: number; attemptTimeoutMs?: number } = {}
): Promise<boolean> {
	const retries = opts.retries ?? 2;
	const backoffMs = opts.backoffMs ?? 75;
	const attemptTimeoutMs = opts.attemptTimeoutMs ?? 3000;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await s3.send(new HeadBucketCommand({ Bucket: MEDIA_BUCKET }), {
				abortSignal: AbortSignal.timeout(attemptTimeoutMs)
			});
			return true;
		} catch (err: unknown) {
			// A 404 (bucket doesn't exist yet) still proves the endpoint itself
			// is reachable and answering — that's what this check is for, not
			// bucket existence (ensureMediaBucket already handles that lazily).
			const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
				?.httpStatusCode;
			if (status === 404) return true;
			if (attempt === retries) return false;
			await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** attempt));
		}
	}
	return false;
}
