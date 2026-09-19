/**
 * The static page cache (Lane A8): rendered HTML for public routes, stored
 * in the same S3-compatible bucket media already uses (Lane A5), under a
 * `pages/` prefix so it can never collide with a content-addressed media
 * key (those have no prefix and no slashes in their first segment other
 * than the extension).
 *
 * This is a plain key→body store with no TTL and no lazy population: the
 * ONLY writer is the regeneration engine (`regenerate.ts`), invoked
 * synchronously by `publish`/`unpublish`. Nothing here is written on a
 * visitor's request (see `src/hooks.server.ts`) — a cache miss falls back
 * to a normal, live SvelteKit render instead of populating the cache from
 * that fallback. This keeps invalidation simple and provable: a page's
 * cached bytes change at exactly one moment (a publish/unpublish that
 * declares that route affected) and never as a side effect of traffic.
 *
 * Lane B1 extended this from "HTML pages only" to also cache the generated
 * discovery files (/llms.txt, /llms-full.txt, /sitemap.xml) — plain text/XML,
 * not HTML — so `objectKeyFor` preserves whatever extension the path already
 * has instead of always appending `.html`, and the content type actually
 * served is round-tripped through S3's own object metadata rather than
 * assumed.
 */

import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3, MEDIA_BUCKET, ensureMediaBucket } from '../media/client';

const DEFAULT_CONTENT_TYPE = 'text/html; charset=utf-8';

function objectKeyFor(path: string): string {
	// path is always a leading-slash site path, e.g. "/", "/trabajos/racebox",
	// or a generated file path that already carries its own extension, e.g.
	// "/llms.txt", "/sitemap.xml" — only a page path (no extension) gets
	// ".html" appended.
	if (path === '/') return 'pages/index.html';
	const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
	return `pages${path}${hasExtension ? '' : '.html'}`;
}

export interface CachedPage {
	body: string;
	contentType: string;
}

export async function getCachedPage(path: string): Promise<CachedPage | null> {
	try {
		const result = await s3.send(
			new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: objectKeyFor(path) })
		);
		if (!result.Body) return null;
		const body = await result.Body.transformToString('utf-8');
		return { body, contentType: result.ContentType ?? DEFAULT_CONTENT_TYPE };
	} catch (err: unknown) {
		const name = (err as { name?: string })?.name;
		const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
		if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) return null;
		throw err;
	}
}

export async function putCachedPage(
	path: string,
	body: string,
	contentType: string = DEFAULT_CONTENT_TYPE
): Promise<void> {
	await ensureMediaBucket();
	await s3.send(
		new PutObjectCommand({
			Bucket: MEDIA_BUCKET,
			Key: objectKeyFor(path),
			Body: body,
			ContentType: contentType,
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
