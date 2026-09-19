/**
 * Shared entry read/write primitives used by the entries.* tools. Generic
 * engine code: knows about the `entries` table shape, nothing about Moco.
 */

import { and, asc, eq, max } from 'drizzle-orm';
import { db } from '../db/client';
import { entries } from '../db/schema';
import { SINGLETON_SLUG } from './collections';
import type { CollectionDefinition } from '$lib/content.schema';

export type EntryRow = typeof entries.$inferSelect;

export interface SerializedEntry {
	id: string;
	collection: string;
	slug: string;
	position: number;
	status: string;
	data: unknown;
	publishedData: unknown;
	createdAt: string;
	updatedAt: string;
}

export function serializeEntry(row: EntryRow): SerializedEntry {
	return {
		id: row.id,
		collection: row.collectionKey,
		slug: row.slug,
		position: row.position,
		status: row.status,
		data: row.data,
		publishedData: row.publishedData,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

export async function listEntryRows(collectionKey: string): Promise<EntryRow[]> {
	return db
		.select()
		.from(entries)
		.where(eq(entries.collectionKey, collectionKey))
		.orderBy(asc(entries.position));
}

/**
 * Resolves one entry by id (authoritative) or slug (defaulting to the
 * singleton slug when the collection is a singleton and no slug was given).
 */
export async function resolveEntry(
	collection: CollectionDefinition,
	opts: { id?: string; slug?: string }
): Promise<EntryRow | undefined> {
	if (opts.id) {
		const rows = await db
			.select()
			.from(entries)
			.where(and(eq(entries.id, opts.id), eq(entries.collectionKey, collection.key)))
			.limit(1);
		return rows[0];
	}
	const slug = opts.slug ?? (collection.kind === 'singleton' ? SINGLETON_SLUG : undefined);
	if (!slug) return undefined;
	const rows = await db
		.select()
		.from(entries)
		.where(and(eq(entries.collectionKey, collection.key), eq(entries.slug, slug)))
		.limit(1);
	return rows[0];
}

/** Next append position for a new entry in this collection (max existing + 1, or 0). */
export async function nextAppendPosition(collectionKey: string): Promise<number> {
	const rows = await db
		.select({ max: max(entries.position) })
		.from(entries)
		.where(eq(entries.collectionKey, collectionKey));
	const current = rows[0]?.max;
	return current === null || current === undefined ? 0 : current + 1;
}
