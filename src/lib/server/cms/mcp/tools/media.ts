import { desc, like } from 'drizzle-orm';
import { db } from '../../db/client';
import { media } from '../../db/schema';
import { uploadMedia } from '../../media/upload';
import { textResult, type ToolDefinition } from '../types';

export const uploadMediaTool: ToolDefinition = {
	name: 'upload_media',
	description:
		"Uploads a file (image or video) into the site's media storage and returns its content-addressed `key`, " +
		'its serving `url` (site-relative, e.g. "/media/<key>"), and — critically — its real, measured `width`, ' +
		'`height`, and `ratio` (width ÷ height). ALWAYS use the returned `ratio` verbatim for any gallery cell or ' +
		'other ratio field that references this file; never estimate it by eye or copy one from a similar-looking ' +
		'file. Storage is content-addressed: uploading bytes that already exist returns `deduped: true` with the ' +
		'same `key` as before — that is a normal no-op, not an error, and there is nothing further to do; the ' +
		'file was already there. Send the file as base64 in `dataBase64`.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			filename: {
				type: 'string',
				description:
					'Original filename (or just an extension like ".jpg"), used only to pick the stored extension.'
			},
			mime: {
				type: 'string',
				description: 'The file\'s MIME type, e.g. "image/jpeg", "image/png", "video/mp4".'
			},
			dataBase64: {
				type: 'string',
				description:
					'The raw file bytes, base64-encoded (no data: URL prefix — just the base64 payload).'
			},
			alt: {
				type: 'string',
				description: 'Optional accessibility/description text for this file.'
			}
		},
		required: ['filename', 'mime', 'dataBase64'],
		additionalProperties: false
	},
	handler: async (args) => {
		const filename = String(args.filename ?? '');
		const mime = String(args.mime ?? '');
		const dataBase64 = args.dataBase64;
		if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
			return textResult('`dataBase64` is required and must be a non-empty base64 string.', true);
		}
		let bytes: Buffer;
		try {
			bytes = Buffer.from(dataBase64, 'base64');
		} catch {
			return textResult('`dataBase64` could not be decoded as base64.', true);
		}
		if (bytes.length === 0) {
			return textResult(
				'Decoded file is empty — check that `dataBase64` was encoded correctly.',
				true
			);
		}

		const alt = typeof args.alt === 'string' ? args.alt : null;

		try {
			const result = await uploadMedia({ bytes, filename, mime, alt });
			return textResult(result);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return textResult(`Upload failed: ${message}`, true);
		}
	}
};

export const listMediaTool: ToolDefinition = {
	name: 'list_media',
	description:
		'Lists uploaded media assets (most recently uploaded first), each with its `key`, serving `url`, mime ' +
		'type, measured width/height/ratio, size in bytes, and alt text. Use this to find an already-uploaded ' +
		"file's key/url/ratio instead of re-uploading, or to check whether a given file was already migrated.",
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			mimePrefix: {
				type: 'string',
				description: 'Optional filter, e.g. "image/" or "video/" to list only one media kind.'
			},
			limit: {
				type: 'number',
				description: 'Maximum number of results (default 100, max 500).'
			}
		},
		additionalProperties: false
	},
	handler: async (args) => {
		const limitArg = typeof args.limit === 'number' ? args.limit : 100;
		const limit = Math.max(1, Math.min(500, Math.floor(limitArg)));
		const mimePrefix = typeof args.mimePrefix === 'string' ? args.mimePrefix : undefined;

		const rows = mimePrefix
			? await db
					.select()
					.from(media)
					.where(like(media.mime, `${mimePrefix}%`))
					.orderBy(desc(media.createdAt))
					.limit(limit)
			: await db.select().from(media).orderBy(desc(media.createdAt)).limit(limit);

		const items = rows.map((row) => ({
			key: row.key,
			url: `/media/${row.key}`,
			mime: row.mime,
			width: row.width,
			height: row.height,
			ratio: row.width && row.height ? row.width / row.height : null,
			bytes: row.bytes,
			alt: row.alt,
			createdAt: row.createdAt.toISOString()
		}));

		return textResult({ media: items });
	}
};

export const mediaTools: ToolDefinition[] = [uploadMediaTool, listMediaTool];
