/**
 * `upload_media` — the function an MCP tool calls to store a media asset.
 *
 * Contract (see src/lib/content.schema.ts, `galleryCellSchema.ratio`): the
 * `ratio` this returns MUST be measured from the real file, never estimated,
 * because gallery row layout is driven by it directly (each cell's width is
 * a flex-basis proportional to its ratio). This module is what makes that
 * promise true, for both of the two media kinds the content schema allows:
 *
 *   - Images: `sharp` decodes the file and reports its real pixel size.
 *   - Video: `sharp` CANNOT do this — it only decodes still-image formats,
 *     never video containers (mp4/webm/etc). Reading a video's real
 *     dimensions needs an actual decoder, so this uses `ffprobe` (bundled as
 *     a static per-platform binary via `@ffprobe-installer/ffprobe`, so no
 *     system package/apt-get step is required in any environment, local or
 *     Railway). Anything that estimated a video's ratio instead of probing
 *     it would violate the same schema contract as guessing an image's
 *     ratio would.
 *
 * Storage is content-addressed: the object key is `sha256(bytes) + ext`, so
 * uploading the same bytes twice is a no-op (the object already exists at
 * that key) and the URL can be cached forever — see the `/media/[...key]`
 * route's `Cache-Control: immutable`.
 *
 * This file is generic engine code: it knows nothing about Moco. The script
 * that walks Moco's own `static/` folder and calls this function lives in
 * `scripts/`, not here.
 */

import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import { s3, MEDIA_BUCKET, ensureMediaBucket } from './client.ts';
import { db } from '../db/client.ts';
import { media } from '../db/schema.ts';

const execFileAsync = promisify(execFile);

export interface UploadMediaInput {
	/** The raw file bytes. */
	bytes: Buffer;
	/**
	 * A filename (or just an extension) used only to pick the stored key's
	 * file extension — never used as the key itself, since the key is
	 * content-addressed.
	 */
	filename: string;
	/** The file's MIME type, e.g. "image/jpeg", "video/mp4". */
	mime: string;
	/** Optional accessibility/description text, stored on the `media` row. */
	alt?: string | null;
}

export interface UploadMediaResult {
	/** Content-addressed storage key: sha256(bytes) + extension. */
	key: string;
	/** Site-relative URL that serves this object (the `/media/[...key]` route). */
	url: string;
	mime: string;
	width: number;
	height: number;
	/** Width ÷ height, measured from the real file. Never estimated. */
	ratio: number;
	bytes: number;
	alt: string | null;
	/** True if identical bytes were already stored under this key. */
	deduped: boolean;
}

const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'image/svg+xml': '.svg',
	'video/mp4': '.mp4',
	'video/webm': '.webm',
	'video/quicktime': '.mov'
};

function resolveExtension(filename: string, mime: string): string {
	const fromFilename = extname(filename).toLowerCase();
	if (fromFilename) return fromFilename;
	const fromMime = EXT_BY_MIME[mime];
	if (fromMime) return fromMime;
	throw new Error(`Cannot determine a file extension for mime type "${mime}" and filename "${filename}".`);
}

async function measureImage(bytes: Buffer): Promise<{ width: number; height: number }> {
	const meta = await sharp(bytes).metadata();
	if (!meta.width || !meta.height) {
		throw new Error("sharp could not read this image's real pixel dimensions.");
	}
	return { width: meta.width, height: meta.height };
}

async function measureVideo(bytes: Buffer): Promise<{ width: number; height: number }> {
	// ffprobe needs a real file path, not a buffer, so this writes the bytes
	// to a scratch file for the duration of the probe only.
	const scratchPath = join(tmpdir(), `mocoweb-media-${randomUUID()}`);
	await writeFile(scratchPath, bytes);
	try {
		const { stdout } = await execFileAsync(ffprobePath, [
			'-v',
			'error',
			'-select_streams',
			'v:0',
			'-show_entries',
			'stream=width,height',
			'-of',
			'json',
			scratchPath
		]);
		const parsed = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] };
		const stream = parsed.streams?.[0];
		if (!stream?.width || !stream?.height) {
			throw new Error("ffprobe could not read this video's real pixel dimensions.");
		}
		return { width: stream.width, height: stream.height };
	} finally {
		await unlink(scratchPath).catch(() => {});
	}
}

export async function uploadMedia(input: UploadMediaInput): Promise<UploadMediaResult> {
	await ensureMediaBucket();

	const hash = createHash('sha256').update(input.bytes).digest('hex');
	const ext = resolveExtension(input.filename, input.mime);
	const key = `${hash}${ext}`;

	const { width, height } = input.mime.startsWith('video/')
		? await measureVideo(input.bytes)
		: await measureImage(input.bytes);
	const ratio = width / height;
	const alt = input.alt ?? null;

	let deduped = false;
	try {
		await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
		deduped = true;
	} catch {
		await s3.send(
			new PutObjectCommand({
				Bucket: MEDIA_BUCKET,
				Key: key,
				Body: input.bytes,
				ContentType: input.mime,
				// Content-addressed keys never change contents, so this is safe
				// to bake into the object itself as well as the serving route.
				CacheControl: 'public, max-age=31536000, immutable'
			})
		);
	}

	await db
		.insert(media)
		.values({ key, mime: input.mime, width, height, bytes: input.bytes.length, alt })
		.onConflictDoUpdate({
			target: media.key,
			set: { mime: input.mime, width, height, bytes: input.bytes.length, alt }
		});

	return {
		key,
		url: `/media/${key}`,
		mime: input.mime,
		width,
		height,
		ratio,
		bytes: input.bytes.length,
		alt,
		deduped
	};
}
