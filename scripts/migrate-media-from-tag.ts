/**
 * Same job as scripts/migrate-media.ts (move every media file the seeded
 * content references into the S3-compatible bucket, rewriting
 * `entries.data`/`published_data` to the resulting `/media/<key>` URLs) —
 * but sources file BYTES from the frozen `pre-cms` git tag instead of
 * `static/` on disk.
 *
 * Why this script exists instead of just re-running migrate-media.ts:
 * migrate-media.ts's own commit (`0c521f9`) deleted every file it migrated
 * out of `static/` once it was uploaded (LANES.md defect #21). So on any
 * checkout that doesn't already have a populated bucket AND already-migrated
 * DB rows — a fresh clone, a fresh environment, or the case this script
 * exists for: a local dev DB reseeded from scripts/source-content.ts
 * (`npm run db:seed`) without the media migration being re-applied —
 * migrate-media.ts finds "0 distinct referenced media files" not because
 * there's nothing to migrate, but because the source bytes are gone from
 * disk. It cannot tell the difference between "already migrated" and
 * "nothing here to migrate", and silently does nothing either way.
 *
 * The durable source is the frozen `pre-cms` tag — the same trick
 * `.migration/generate-media-map.mjs` already uses for the same reason,
 * generalized here to every entry the seed writes (39), not just the 10
 * baseline pages that script cares about.
 *
 * Safe to run any number of times: `uploadMedia` is content-addressed (a
 * file whose bytes are already in the bucket is a no-op dedupe), and an
 * entry whose data already points at /media/... has nothing left in it that
 * resolves to a static/ path at the tag, so a second run finds 0 files to
 * migrate and 0 entries to rewrite.
 *
 * Usage: node --experimental-strip-types scripts/migrate-media-from-tag.ts [--dry-run] [--tag=pre-cms]
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/server/cms/db/client.ts';
import { entries } from '../src/lib/server/cms/db/schema.ts';
import { uploadMedia } from '../src/lib/server/cms/media/upload.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const TAG_ARG = process.argv.find((a) => a.startsWith('--tag='));
const TAG = TAG_ARG ? TAG_ARG.slice('--tag='.length) : 'pre-cms';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

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

// Memoized: the same static/ path can appear across many entries (e.g. the
// same portada.jpg is both `cover` and the first gallery cell), and every
// lookup shells out to git, so avoid re-asking for a path already checked.
const existsCache = new Map<string, boolean>();

function existsAtTag(gitPath: string): boolean {
	const cached = existsCache.get(gitPath);
	if (cached !== undefined) return cached;
	let ok = true;
	try {
		execFileSync('git', ['cat-file', '-e', `${TAG}:${gitPath}`], {
			cwd: REPO_ROOT,
			stdio: 'ignore'
		});
	} catch {
		ok = false;
	}
	existsCache.set(gitPath, ok);
	return ok;
}

function isMediaFile(value: string): boolean {
	if (typeof value !== 'string' || !value.startsWith('/')) return false;
	return existsAtTag(`static${value}`);
}

function readBytesAtTag(sitePath: string): Buffer {
	return execFileSync('git', ['show', `${TAG}:static${sitePath}`], {
		cwd: REPO_ROOT,
		maxBuffer: 1024 * 1024 * 500
	});
}

function altFromPath(path: string): string {
	return basename(path, extname(path)).replace(/[_-]+/g, ' ').trim();
}

/** Recursively collects every distinct site-relative path that resolves to a real file at the tag. */
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
	try {
		execFileSync('git', ['rev-parse', '--verify', `${TAG}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' });
	} catch {
		throw new Error(
			`git tag/ref "${TAG}" does not exist in this checkout. This script needs the frozen ` +
				`pre-CMS reference to source media bytes from (see .migration/LANES.md defect #21). ` +
				`Fetch it (e.g. "git fetch origin tag ${TAG}") or pass --tag=<ref> pointing at a commit ` +
				`that still has the original static/ files.`
		);
	}

	console.log(`==> Loading entries${DRY_RUN ? ' (dry run)' : ''} (sourcing bytes from tag "${TAG}")...`);
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
	if (allPaths.size === 0) {
		console.log('==> Nothing to migrate: every referenced path either is already /media/... or was not found at the tag.');
	}

	const mapping = new Map<string, string>();
	const measured = new Map<string, { width: number; height: number; ratio: number }>();
	let uploaded = 0;
	let deduped = 0;
	let totalBytes = 0;

	for (const path of [...allPaths].sort()) {
		const bytes = readBytesAtTag(path);
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

	console.log(
		`==> ${uploaded} objects uploaded, ${deduped} already present (content-addressed dedupe), ${totalBytes} bytes total.`
	);

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
