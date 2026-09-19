/**
 * Moves every media file that Moco's seeded content actually references out
 * of `static/` and into the S3-compatible bucket, rewriting the DB content
 * (`entries.data` / `entries.published_data`) to point at the new
 * `/media/<key>` URLs.
 *
 * This is a one-off migration script for THIS site's content, not engine
 * code — the engine (`src/lib/server/cms/media/`) knows nothing about Moco,
 * `static/projects/...` paths, or this script's existence.
 *
 * How it finds "media the content references": rather than hand-listing
 * fields (fragile — a new mediaPath field added later would silently be
 * missed), it walks every entry's `data`/`published_data` JSON and treats
 * any string starting with "/" that resolves to a real file under
 * `static/` as a media reference. Route paths like "/contacto" don't
 * resolve to a file, so they're naturally excluded — no need to know which
 * JSON keys are "media fields" versus plain site-relative links.
 *
 * Idempotent-ish: re-running is safe because `uploadMedia` is
 * content-addressed (identical bytes upsert the same row/object instead of
 * duplicating), but it will re-walk already-migrated entries and find
 * nothing left to rewrite (their strings already point at /media/..., which
 * doesn't resolve to a file under static/, so they're skipped).
 *
 * Usage: node scripts/migrate-media.ts [--dry-run]
 */
import 'dotenv/config';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/server/cms/db/client.ts';
import { entries } from '../src/lib/server/cms/db/schema.ts';
import { uploadMedia } from '../src/lib/server/cms/media/upload.ts';

const DRY_RUN = process.argv.includes('--dry-run');

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_DIR = join(REPO_ROOT, 'static');

const MIME_BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mov': 'video/quicktime'
};

function isMediaFile(value: string): boolean {
	if (typeof value !== 'string' || !value.startsWith('/')) return false;
	const abs = join(STATIC_DIR, value);
	if (!existsSync(abs)) return false;
	return statSync(abs).isFile();
}

function altFromPath(path: string): string {
	return basename(path, extname(path)).replace(/[_-]+/g, ' ').trim();
}

/** Recursively collects every distinct site-relative path that resolves to a real static file. */
function collectMediaPaths(node: unknown, found: Set<string>): void {
	if (Array.isArray(node)) {
		for (const item of node) collectMediaPaths(item, found);
	} else if (node && typeof node === 'object') {
		for (const value of Object.values(node as Record<string, unknown>)) collectMediaPaths(value, found);
	} else if (typeof node === 'string' && isMediaFile(node)) {
		found.add(node);
	}
}

/** Deep-clones `node`, replacing any string in `mapping` with its mapped value. */
function rewrite<T>(node: T, mapping: Map<string, string>): T {
	if (Array.isArray(node)) {
		return node.map((item) => rewrite(item, mapping)) as unknown as T;
	}
	if (node && typeof node === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = rewrite(v, mapping);
		return out as T;
	}
	if (typeof node === 'string' && mapping.has(node)) {
		return mapping.get(node) as unknown as T;
	}
	return node;
}

/** Finds every {ratio, mediaPath} pair in gallery-shaped JSON, for the ratio cross-check. */
function collectRatioClaims(node: unknown, out: { path: string; ratio: number }[]): void {
	if (Array.isArray(node)) {
		for (const item of node) collectRatioClaims(item, out);
	} else if (node && typeof node === 'object') {
		const obj = node as Record<string, unknown>;
		const mediaPath = typeof obj.src === 'string' ? obj.src : typeof obj.video === 'string' ? obj.video : undefined;
		if (mediaPath && typeof obj.ratio === 'number' && isMediaFile(mediaPath)) {
			out.push({ path: mediaPath, ratio: obj.ratio });
		}
		for (const value of Object.values(obj)) collectRatioClaims(value, out);
	}
}

async function main() {
	console.log(`==> Loading entries${DRY_RUN ? ' (dry run)' : ''}...`);
	const rows = await db
		.select({
			id: entries.id,
			collectionKey: entries.collectionKey,
			slug: entries.slug,
			data: entries.data,
			publishedData: entries.publishedData
		})
		.from(entries);

	const allPaths = new Set<string>();
	const ratioClaims: { path: string; ratio: number }[] = [];
	for (const row of rows) {
		collectMediaPaths(row.data, allPaths);
		collectMediaPaths(row.publishedData, allPaths);
		collectRatioClaims(row.data, ratioClaims);
	}

	console.log(`==> Found ${allPaths.size} distinct referenced media files across ${rows.length} entries.`);

	const mapping = new Map<string, string>();
	const measured = new Map<string, { width: number; height: number; ratio: number }>();
	let uploaded = 0;
	let deduped = 0;
	let totalBytes = 0;

	for (const path of [...allPaths].sort()) {
		const abs = join(STATIC_DIR, path);
		const bytes = readFileSync(abs);
		const ext = extname(path).toLowerCase();
		const mime = MIME_BY_EXT[ext];
		if (!mime) throw new Error(`No MIME mapping for extension "${ext}" (file: ${path})`);

		const result = await uploadMedia({
			bytes,
			filename: basename(path),
			mime,
			alt: altFromPath(path)
		});
		mapping.set(path, result.url);
		measured.set(path, { width: result.width, height: result.height, ratio: result.ratio });
		totalBytes += result.bytes;
		if (result.deduped) deduped++;
		else uploaded++;
		console.log(
			`  ${result.deduped ? 'exists ' : 'upload '} ${path} -> ${result.url}  ` +
				`${result.width}x${result.height} ratio=${result.ratio.toFixed(4)}`
		);
	}

	console.log(`==> ${uploaded} objects uploaded, ${deduped} already present (content-addressed dedupe), ${totalBytes} bytes total.`);

	console.log('==> Cross-checking measured ratio against the ratio already in content...');
	let ratioChecked = 0;
	let ratioMismatch = 0;
	for (const claim of ratioClaims) {
		const result = measured.get(claim.path);
		if (!result) continue;
		ratioChecked++;
		const diff = Math.abs(result.ratio - claim.ratio);
		if (diff > 0.01) {
			ratioMismatch++;
			console.log(
				`  MISMATCH ${claim.path}: content ratio=${claim.ratio} vs measured ratio=${result.ratio.toFixed(4)} (diff=${diff.toFixed(4)})`
			);
		}
	}
	console.log(`==> Ratio cross-check: ${ratioChecked} checked, ${ratioMismatch} mismatched (>0.01 off).`);

	console.log(`==> Rewriting ${rows.length} entries' data/published_data with the new /media/... URLs...`);
	let changed = 0;
	for (const row of rows) {
		const newData = rewrite(row.data, mapping);
		const newPublished = row.publishedData ? rewrite(row.publishedData, mapping) : row.publishedData;
		const dataChanged = JSON.stringify(newData) !== JSON.stringify(row.data);
		const publishedChanged = JSON.stringify(newPublished) !== JSON.stringify(row.publishedData);
		if (!dataChanged && !publishedChanged) continue;
		changed++;
		console.log(`  ${row.collectionKey}/${row.slug}`);
		if (!DRY_RUN) {
			await db
				.update(entries)
				.set({ data: newData, publishedData: newPublished, updatedAt: new Date() })
				.where(eq(entries.id, row.id));
		}
	}
	console.log(`==> ${changed} entries ${DRY_RUN ? 'would be' : 'were'} updated.`);

	console.log('Done.');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
