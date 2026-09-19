/**
 * Reads the seeded content back out of Postgres, reconstructs the shape the
 * current hardcoded TypeScript/Svelte content is in, and deep-compares it
 * against the original values — proving the CMS model lost nothing.
 *
 * For `projects`, "the original" is the actual, live `projects` export from
 * src/lib/data/projects.ts (a real importable module) — the strongest
 * possible comparison. For every other collection, the hardcoded content
 * lives inline in .svelte <script> blocks (not an importable module), so
 * "the original" is the one hand-transcription of it in
 * scripts/source-content.ts, shared with seed.ts (see that file's header
 * comment for why sharing one transcription is the safer design).
 *
 * Also checks, per entry: schema-valid, status='published', and
 * data deep-equals published_data (this content is live today, not a
 * draft).
 *
 * Usage: node --experimental-strip-types scripts/verify-roundtrip.ts
 */
import 'dotenv/config';
import { isDeepStrictEqual } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { asc, eq } from 'drizzle-orm';
import { collections, entries } from '../src/lib/server/cms/db/schema.ts';
import { collectionDefinitions } from '../src/lib/content.schema.ts';
import { projects as originalProjects } from '../src/lib/data/projects.ts';
import * as source from './source-content.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema: { collections, entries } });

let totalFailures = 0;

function report(collectionKey: string, ok: boolean, detail?: string) {
	if (ok) {
		console.log(`  PASS  ${collectionKey}`);
	} else {
		totalFailures++;
		console.log(`  FAIL  ${collectionKey}${detail ? ' — ' + detail : ''}`);
	}
}

async function fetchRows(collectionKey: string) {
	return db.query.entries.findMany({
		where: eq(entries.collectionKey, collectionKey),
		orderBy: [asc(entries.position)]
	});
}

async function checkEntryInvariants(collectionKey: string) {
	const rows = await fetchRows(collectionKey);
	const def = collectionDefinitions.find((d) => d.key === collectionKey)!;
	const problems: string[] = [];
	for (const row of rows) {
		if (row.status !== 'published') problems.push(`${row.slug}: status is "${row.status}", expected "published"`);
		if (!isDeepStrictEqual(row.data, row.publishedData)) {
			problems.push(`${row.slug}: data !== published_data`);
		}
		const result = def.schema.safeParse(row.data);
		if (!result.success) {
			problems.push(`${row.slug}: fails its own schema (${result.error.issues.map((i) => i.message).join('; ')})`);
		}
	}
	return problems;
}

async function main() {
	console.log('==> Per-entry invariants (published status, data===published_data, schema-valid)');
	for (const def of collectionDefinitions) {
		const problems = await checkEntryInvariants(def.key);
		report(def.key, problems.length === 0, problems.join(' | '));
	}

	console.log('\n==> Round-trip fidelity (reconstructed DB content vs. original hardcoded content)');

	// --- projects: compare against the real, live TS module export -----------
	{
		const rows = await fetchRows('projects');
		const reconstructed = rows.map((r) => ({ slug: r.slug, ...(r.data as object) }));
		const ok = isDeepStrictEqual(reconstructed, originalProjects);
		report('projects', ok, ok ? undefined : diffSummary(reconstructed, originalProjects));
	}

	// --- simple list collections: array of `data`, compared to source-content -
	const listChecks: [string, unknown[]][] = [
		['values', source.values],
		['process', source.process],
		['homeServices', source.homeServices],
		['estudioServices', source.estudioServices],
		['team', source.team as unknown as unknown[]],
		['contactMethods', source.contactMethods]
	];
	for (const [key, original] of listChecks) {
		const rows = await fetchRows(key);
		const reconstructed = rows.map((r) => r.data);
		const ok = isDeepStrictEqual(reconstructed, original);
		report(key, ok, ok ? undefined : diffSummary(reconstructed, original));
	}

	// --- singleton collections: single entry's `data`, compared directly -----
	const singletonChecks: [string, unknown][] = [
		['homeHero', source.homeHero],
		['statement', source.statement],
		['estudioHero', source.estudioHero],
		['contactoHero', source.contactoHero],
		['trabajosHeader', source.trabajosHeader],
		['contactCta', source.contactCta]
	];
	for (const [key, original] of singletonChecks) {
		const rows = await fetchRows(key);
		const ok = rows.length === 1 && isDeepStrictEqual(rows[0].data, original);
		report(
			key,
			ok,
			ok
				? undefined
				: rows.length !== 1
					? `expected exactly 1 entry, found ${rows.length}`
					: diffSummary(rows[0].data, original)
		);
	}

	console.log(
		totalFailures === 0
			? '\nROUND-TRIP FIDELITY: PASS (0 diffs across all collections)'
			: `\nROUND-TRIP FIDELITY: FAIL (${totalFailures} problem(s) — see above)`
	);

	await sql.end();
	process.exit(totalFailures === 0 ? 0 : 1);
}

function diffSummary(a: unknown, b: unknown): string {
	return `reconstructed=${JSON.stringify(a).slice(0, 300)} original=${JSON.stringify(b).slice(0, 300)}`;
}

await main();
