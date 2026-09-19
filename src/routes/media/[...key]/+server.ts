/**
 * Streams a media object from the bucket to the visitor.
 *
 * The browser never talks to the bucket directly (Railway Buckets doesn't
 * support public buckets anyway) — every media URL in rendered content
 * points here, and this route is the only thing that holds bucket
 * credentials. Because storage keys are content-addressed (see
 * `uploadMedia`), an object's bytes at a given key never change, so the
 * response is marked immutable and cacheable for a year.
 */

import { error } from '@sveltejs/kit';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, MEDIA_BUCKET } from '$lib/server/cms/media/client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const key = params.key;

	let object;
	try {
		object = await s3.send(new GetObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
	} catch (err: unknown) {
		const name = (err as { name?: string })?.name;
		const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
		if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) {
			error(404, 'Media not found');
		}
		throw err;
	}

	if (!object.Body) {
		error(404, 'Media not found');
	}

	const headers: Record<string, string> = {
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Content-Type': object.ContentType ?? 'application/octet-stream'
	};
	if (typeof object.ContentLength === 'number') {
		headers['Content-Length'] = String(object.ContentLength);
	}

	return new Response(object.Body.transformToWebStream(), { headers });
};
