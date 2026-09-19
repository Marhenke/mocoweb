#!/usr/bin/env node
/**
 * Derives the /media/<key> -> original-static-path mapping used by
 * verify.sh's normalize() rule for Lane A5's media migration.
 *
 * Nothing here is hand-transcribed or stored as a one-off artifact:
 *   1. The set of paths that need mapping is read straight out of the 10
 *      frozen `.migration/baseline/*.html` captures -- whatever
 *      /projects|/team|/video path actually appears in rendered pre-cms
 *      output is exactly, and only, what verify.sh will ever need to
 *      translate a /media/<key> back into. (static/ also holds a few files
 *      nothing ever referenced -- see LANES.md #15 -- and deliberately
 *      excluding those avoids a real hash collision: one orphan file is
 *      byte-identical to a referenced one, so mapping from "every file in
 *      static/" would non-deterministically pick the wrong original path
 *      for that shared key.)
 *   2. Each path's key is computed by hashing that file's actual bytes at
 *      the frozen `pre-cms` git tag, with the exact same
 *      sha256(bytes) + extension scheme uploadMedia() uses (see
 *      src/lib/server/cms/media/upload.ts).
 *
 * Run this again at any point and, as long as the baseline captures and the
 * `pre-cms` tag are unchanged (they're frozen on purpose), you get
 * byte-identical output -- so the mapping can never drift out of sync with
 * reality the way a hand-maintained table could.
 *
 * Usage: node .migration/generate-media-map.mjs > .migration/media-map.json
 * (invoked automatically by verify.sh; safe to run from anywhere inside the
 * repo since it resolves paths relative to this file, not the cwd)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAG = 'pre-cms';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_DIR = new URL('./baseline/', import.meta.url);

const referencedPaths = new Set();
for (const file of readdirSync(BASELINE_DIR)) {
	if (!file.endsWith('.html')) continue;
	const html = readFileSync(new URL(file, BASELINE_DIR), 'utf8');
	const pattern = /(?:src|poster)="(\/(?:projects|team|video)\/[^"]+)"|url\((\/(?:projects|team|video)\/[^)]+)\)/g;
	for (const m of html.matchAll(pattern)) {
		referencedPaths.add(m[1] ?? m[2]);
	}
}

/** @type {Record<string, string>} */
const map = {};
for (const sitePath of referencedPaths) {
	const gitPath = `static${sitePath}`;
	const bytes = execFileSync('git', ['show', `${TAG}:${gitPath}`], {
		cwd: REPO_ROOT,
		maxBuffer: 1024 * 1024 * 500
	});
	const hash = createHash('sha256').update(bytes).digest('hex');
	const ext = extname(sitePath).toLowerCase();
	const key = `${hash}${ext}`;
	if (map[key] && map[key] !== sitePath) {
		throw new Error(
			`Hash collision building the media map: both "${map[key]}" and "${sitePath}" hash to ` +
				`"${key}". generate-media-map.mjs cannot disambiguate two distinct, both-referenced, ` +
				`byte-identical files -- fix this manually before trusting verify.sh's output.`
		);
	}
	map[key] = sitePath;
}

process.stdout.write(JSON.stringify(map, null, 2) + '\n');
