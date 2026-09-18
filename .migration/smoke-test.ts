/**
 * Throwaway round-trip smoke test for the CMS data layer (Lane A2).
 * Not part of the app; run manually and then delete (or keep for the next
 * lane to reuse — see the migration report for which).
 *
 * Usage: node .migration/smoke-test.ts
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { collections, entries, revisions } from '../src/lib/server/cms/db/schema.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set.');

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema: { collections, entries, revisions } });

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

console.log('1. Insert a collection...');
const [collection] = await db
	.insert(collections)
	.values({
		key: 'smoke_test_projects',
		kind: 'list',
		label: 'Smoke Test Projects',
		schemaJson: { type: 'object', properties: {} }
	})
	.returning();
assert(collection.key === 'smoke_test_projects', 'collection key round-trips');
console.log('   ok:', collection);

console.log('2. Insert an entry referencing it...');
const [entry] = await db
	.insert(entries)
	.values({
		collectionKey: collection.key,
		slug: 'smoke-test-entry',
		data: { title: 'Smoke Test' }
	})
	.returning();
assert(entry.collectionKey === collection.key, 'entry references collection');
console.log('   ok:', entry);

console.log('3. Insert a revision referencing that entry...');
const [revision] = await db
	.insert(revisions)
	.values({
		entryId: entry.id,
		data: { title: 'Smoke Test' },
		clientId: 'smoke-test-script',
		note: 'initial draft'
	})
	.returning();
assert(revision.entryId === entry.id, 'revision references entry');
console.log('   ok:', revision);

console.log('4. Read them back...');
const readCollection = await db.query.collections.findFirst({
	where: eq(collections.key, collection.key)
});
const readEntry = await db.query.entries.findFirst({ where: eq(entries.id, entry.id) });
const readRevision = await db.query.revisions.findFirst({ where: eq(revisions.id, revision.id) });
assert(readCollection, 'collection reads back');
assert(readEntry, 'entry reads back');
assert(readRevision, 'revision reads back');
console.log('   ok: all three read back');

console.log('5. Delete the collection...');
await db.delete(collections).where(eq(collections.key, collection.key));

console.log('6. Confirm cascade removed the entry and its revision...');
const entryAfter = await db.query.entries.findFirst({ where: eq(entries.id, entry.id) });
const revisionAfter = await db.query.revisions.findFirst({ where: eq(revisions.id, revision.id) });
assert(entryAfter === undefined, 'entry was cascade-deleted');
assert(revisionAfter === undefined, 'revision was cascade-deleted');
console.log('   ok: entry and revision are gone');

console.log('\nSMOKE TEST PASSED');
await sql.end();
