/**
 * Seeds `collections` and `entries` from the site's current hardcoded
 * content (see scripts/source-content.ts), validating every entry against
 * its Zod schema (src/lib/content.schema.ts) before writing it.
 *
 * This content is already live on the site today — it is not a draft — so
 * every entry is seeded with status='published' and `published_data` set
 * equal to `data`.
 *
 * Idempotent: re-running upserts by (collection key) and (collection_key,
 * slug), so running it twice updates the same rows in place instead of
 * duplicating or erroring. Following the pattern from scripts/migrate.ts:
 * `adapter-node` doesn't read .env, so this needs dotenv explicitly.
 *
 * Usage: node --experimental-strip-types scripts/seed.ts
 */
import 'dotenv/config';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { collections, entries } from '../src/lib/server/cms/db/schema.ts';
import { collectionDefinitions } from '../src/lib/content.schema.ts';
import * as source from './source-content.ts';

// Standalone connection, following the same pattern as scripts/migrate.ts:
// adapter-node doesn't read .env, and a plain script isn't running inside
// SvelteKit's server context, so it builds its own short-lived client
// rather than importing the app's shared `db` from
// src/lib/server/cms/db/client.ts (which also keeps this script from having
// to care about that module's extensionless relative import, which plain
// `node` can't resolve the way Vite does).
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}
const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema: { collections, entries } });

function slugify(input: string): string {
	return input
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // strip accents
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

interface SeedEntry {
	collectionKey: string;
	slug: string;
	position: number;
	data: unknown;
}

const seedEntries: SeedEntry[] = [
	...source.projects.map((p, i) => ({
		collectionKey: 'projects',
		slug: p.slug,
		position: i,
		data: p.data
	})),
	...source.values.map((v, i) => ({
		collectionKey: 'values',
		slug: slugify(v.title),
		position: i,
		data: v
	})),
	...source.process.map((p, i) => ({
		collectionKey: 'process',
		slug: slugify(p.title),
		position: i,
		data: p
	})),
	...source.homeServices.map((s, i) => ({
		collectionKey: 'homeServices',
		slug: slugify(s.title),
		position: i,
		data: s
	})),
	...source.estudioServices.map((s, i) => ({
		collectionKey: 'estudioServices',
		slug: slugify(s.title),
		position: i,
		data: s
	})),
	...source.team.map((t, i) => ({
		collectionKey: 'team',
		slug: slugify(t.name),
		position: i,
		data: t
	})),
	...source.contactMethods.map((m, i) => ({
		collectionKey: 'contactMethods',
		slug: slugify(m.label),
		position: i,
		data: m
	})),
	{ collectionKey: 'homeHero', slug: 'default', position: 0, data: source.homeHero },
	{ collectionKey: 'statement', slug: 'default', position: 0, data: source.statement },
	{ collectionKey: 'estudioHero', slug: 'default', position: 0, data: source.estudioHero },
	{ collectionKey: 'contactoHero', slug: 'default', position: 0, data: source.contactoHero },
	{ collectionKey: 'trabajosHeader', slug: 'default', position: 0, data: source.trabajosHeader },
	{ collectionKey: 'contactCta', slug: 'default', position: 0, data: source.contactCta }
];

async function main() {
	console.log(`==> Validating ${seedEntries.length} entries across ${collectionDefinitions.length} collections...`);

	const schemaByKey = new Map(collectionDefinitions.map((d) => [d.key, d]));
	let invalid = 0;
	for (const entry of seedEntries) {
		const def = schemaByKey.get(entry.collectionKey);
		if (!def) {
			console.error(`  ! No schema registered for collection "${entry.collectionKey}"`);
			invalid++;
			continue;
		}
		const result = def.schema.safeParse(entry.data);
		if (!result.success) {
			invalid++;
			console.error(`  ! ${entry.collectionKey}/${entry.slug} failed validation:`);
			for (const issue of result.error.issues) {
				console.error(`      - ${issue.path.join('.')}: ${issue.message}`);
			}
		}
	}
	if (invalid > 0) {
		throw new Error(`${invalid} entr(y/ies) failed schema validation — aborting before writing anything.`);
	}
	console.log('    all entries valid.');

	console.log(`==> Upserting ${collectionDefinitions.length} collections...`);
	for (const [i, def] of collectionDefinitions.entries()) {
		const schemaJson = z.toJSONSchema(def.schema, { target: 'draft-7' });
		await db
			.insert(collections)
			.values({
				key: def.key,
				kind: def.kind,
				label: def.label,
				schemaJson,
				position: i,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: collections.key,
				set: {
					kind: def.kind,
					label: def.label,
					schemaJson,
					position: i,
					updatedAt: new Date()
				}
			});
	}

	console.log(`==> Upserting ${seedEntries.length} entries...`);
	for (const entry of seedEntries) {
		// This content is already live today, so both sides of the Lane A8
		// draft/published split land in sync: published_position starts equal
		// to the draft position (there is no separate "live order" yet to
		// diverge from), and pending_delete starts false (nothing is queued
		// for removal).
		await db
			.insert(entries)
			.values({
				collectionKey: entry.collectionKey,
				slug: entry.slug,
				position: entry.position,
				status: 'published',
				data: entry.data,
				publishedData: entry.data,
				publishedPosition: entry.position,
				pendingDelete: false,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: [entries.collectionKey, entries.slug],
				set: {
					position: entry.position,
					status: 'published',
					data: entry.data,
					publishedData: entry.data,
					publishedPosition: entry.position,
					pendingDelete: false,
					updatedAt: new Date()
				}
			});
	}

	console.log('Done.');
}

await main();
await sql.end();
process.exit(0);
