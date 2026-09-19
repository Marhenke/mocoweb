#!/usr/bin/env node
/**
 * Rewrites /media/<key> URLs in HTML back to the original static/ path they
 * were migrated from (Lane A5), using the mapping generate-media-map.mjs
 * derives fresh from the `pre-cms` tag on every verify.sh run.
 *
 * This is a TRANSLATION, not an erasure, and that distinction is the whole
 * point: because the key is content-addressed (sha256 of the real bytes),
 * two different files can never collide on one key. Mapping every key back
 * to its one true original path means a correctly migrated image still
 * normalizes to exactly what the pre-cms baseline had (byte-exact match
 * preserved), while a swapped-in image produces a *different* key that maps
 * to a *different* (or no) path -- so it still shows up as a real diff. A
 * blanket placeholder (like the old translate() rule almost was in Lane A1)
 * would erase that distinction and blind the gate to exactly the kind of
 * silent content change it exists to catch.
 *
 * An unmapped key -- one that doesn't hash to anything in the mapping -- is
 * left completely untouched rather than guessed at or blanked. It still
 * reads "/media/<key>" afterwards, which will never match the baseline's
 * original-path text, so the diff still fails instead of quietly passing.
 *
 * Usage: node translate-media.mjs <path-to-media-map.json> < input > output
 */
import { readFileSync } from 'node:fs';

const mapPath = process.argv[2];
if (!mapPath) {
	console.error('Usage: translate-media.mjs <media-map.json> < input > output');
	process.exit(1);
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const input = readFileSync(0, 'utf8');

const output = input.replace(/\/media\/([A-Za-z0-9]+\.[A-Za-z0-9]+)/g, (full, key) => map[key] ?? full);

process.stdout.write(output);
