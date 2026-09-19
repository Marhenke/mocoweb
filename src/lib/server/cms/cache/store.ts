/**
 * The static page cache (Lane A8): rendered HTML for public routes, stored
 * in the same S3-compatible bucket media already uses (Lane A5), under a
 * `pages/` prefix so it can never collide with a content-addressed media
 * key (those have no prefix and no slashes in their first segment other
 * than the extension).
 *
 * This is a plain key→HTML store with no TTL and no lazy population: the
 * ONLY writer is the regeneration engine (`regenerate.ts`), invoked
 * synchronously by `publish`/`unpublish`. Nothing here is written on a
 * visitor's request (see `src/hooks.server.ts`) — a cache miss falls back
 * to a normal, live SvelteKit render instead of populating the cache from
 * that fallback. This keeps invalidation simple and provable: a page's
 * cached bytes change at exactly one moment (a publish/unpublish that
 * declares that route affected) and never as a side effect of traffic.
 */

import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3, MEDIA_BUCKET, ensureMediaBucket } from '../media/client';

function objectKeyFor(path: string): string {
	// path is always a leading-slash site path, e.g. "/", "/trabajos/racebox".
	const normalized = path === '/' ? '/index' : path;
	return `pages${normalized}.html`;
}

export async function getCachedPage(path: string): Promise<string | null> {
	try {
		const result = await s3.send(
			new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKeyFor(path) })
		);
		if (!result.Body) return null;
		return await result.Body.transformToString('utf-8');
	} catch (err: unknown) {
		const name = (err as { name?: string })?.name;
		const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
		if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return null;
		throw err;
	}
}

export async function putCachedPage(path: string, html: string): Promise<void> {
	await ensureMediaBucket();
	await s3.send(
		new PutObjectCommand({
			Bucket: MEDIA_BUCKET,
			Key: objectKeyFor(path),
			Body: html,
			ContentType: 'text/html; charset=utf-8',
			// The opposite of media's immutable/1-year cache: this object is
			// expected to change every time its owning collection is
			// published, and the object key itself never changes (it's the
			// route path, not a content hash), so nothing downstream should
			// cache it long-term either.
			CacheControl: 'no-store'
		})
	);
}

export async function deleteCachedPage(path: string): Promise<void> {
	await ensureMediaBucket();
	try {
		await s3.send(new DeleteObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKeyFor(path) }));
	} catch {
		// Deleting a key that was never cached is a no-op, not an error.
	}
}
