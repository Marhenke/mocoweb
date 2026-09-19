/**
 * Read/write tools over `entries`. Writes only ever touch the `data` column
 * (the draft) — see the doc comments on delete_entry and reorder_entries
 * below for the two places that constraint required an explicit design
 * decision, not just "don't call publish".
 */

import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { entries } from '../../db/schema';
import {
	getCollection,
	collectionNotFoundMessage,
	SINGLETON_SLUG,
	formatZodError
} from '../collections';
import { listEntryRows, resolveEntry, serializeEntry, nextAppendPosition } from '../entry-store';
import { recordRevision } from '../revisions';
import { textResult, type ToolDefinition } from '../types';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugErrorMessage(slug: string): string {
	return (
		`"${slug}" is not a valid entry slug: slugs must be lowercase letters, digits, and single hyphens ` +
		'between words (e.g. "racebox", "sergio-castiglione") — this keeps them safe to use directly in a URL ' +
		'(e.g. /trabajos/{slug}).'
	);
}

// ---------------------------------------------------------------------------
// list_entries
// ---------------------------------------------------------------------------

export const listEntriesTool: ToolDefinition = {
	name: 'list_entries',
	description:
		"Lists every entry in a collection, in display order (an entry's `position` — the same order the live " +
		'site renders them in). Each entry includes both `data` (the current draft — what you read and patch) ' +
		'and `publishedData` (a frozen snapshot of what visitors currently see right now, or null if this entry ' +
		'has never been published). `data` and `publishedData` can legitimately differ — that difference is a ' +
		'pending edit, not a bug. For a singleton collection this returns 0 or 1 entries.',
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' }
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);
		const rows = await listEntryRows(collection.key);
		return textResult({
			collection: collection.key,
			kind: collection.kind,
			entries: rows.map(serializeEntry)
		});
	}
};

// ---------------------------------------------------------------------------
// get_entry
// ---------------------------------------------------------------------------

export const getEntryTool: ToolDefinition = {
	name: 'get_entry',
	description:
		'Reads one entry by slug (or id). For a singleton collection, omit `slug` — there is only one entry, at ' +
		'slug "default". Returns both `data` (draft) and `publishedData` (live snapshot, or null if never ' +
		'published) so you can confirm a write only changed the draft.',
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug. Omit for a singleton collection." },
			id: {
				type: 'string',
				description:
					"The entry's id (uuid). Alternative to `slug`; takes priority if both are given."
			}
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);
		const slug = typeof args.slug === 'string' ? args.slug : undefined;
		const id = typeof args.id === 'string' ? args.id : undefined;
		const row = await resolveEntry(collection, { id, slug });
		if (!row) {
			return textResult(
				`No entry found in collection "${key}" for ${id ? `id "${id}"` : `slug "${slug ?? SINGLETON_SLUG}"`}. ` +
					'Call list_entries to see what exists.',
				true
			);
		}
		return textResult(serializeEntry(row));
	}
};

// ---------------------------------------------------------------------------
// create_entry
// ---------------------------------------------------------------------------

export const createEntryTool: ToolDefinition = {
	name: 'create_entry',
	description:
		'Creates a new entry as a draft (published_data stays null — this never appears on the live site until ' +
		'a future publish step, which this server does not implement). Only valid for `list` collections: a ' +
		'singleton already has its one entry, use update_entry on it instead. `data` is validated against the ' +
		"collection's full schema before anything is saved — call describe_collection first. New entries are " +
		'always appended after the current last entry (there is no `position` argument here); use ' +
		'reorder_entries afterward if you need it earlier.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			collection: {
				type: 'string',
				description: 'A collection key, e.g. "projects". Must be a `list` collection.'
			},
			slug: {
				type: 'string',
				description:
					'The new entry\'s slug: lowercase, hyphenated, unique within this collection (e.g. "nuevo-cliente").'
			},
			data: {
				type: 'object',
				description:
					"The entry's full data, matching the collection's schema exactly (see describe_collection)."
			}
		},
		required: ['collection', 'slug', 'data'],
		additionalProperties: false
	},
	handler: async (args, ctx) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		if (collection.kind === 'singleton') {
			return textResult(
				`"${key}" is a singleton collection — it already has exactly one entry and cannot have another. ` +
					'Use update_entry to change its data.',
				true
			);
		}

		const slug = String(args.slug ?? '');
		if (!SLUG_PATTERN.test(slug)) {
			return textResult(slugErrorMessage(slug), true);
		}

		const existing = await resolveEntry(collection, { slug });
		if (existing) {
			return textResult(
				`An entry with slug "${slug}" already exists in collection "${key}". Slugs must be unique within a ` +
					'collection — choose a different one, or use update_entry on the existing entry.',
				true
			);
		}

		const parsed = collection.schema.safeParse(args.data);
		if (!parsed.success) {
			return textResult(formatZodError(key, parsed.error), true);
		}

		const position = await nextAppendPosition(collection.key);
		const [row] = await db
			.insert(entries)
			.values({
				collectionKey: collection.key,
				slug,
				position,
				status: 'draft',
				data: parsed.data,
				publishedData: null
			})
			.returning();

		await recordRevision({
			entryId: row.id,
			data: parsed.data,
			clientId: ctx.clientId,
			note: 'created'
		});

		return textResult(serializeEntry(row));
	}
};

// ---------------------------------------------------------------------------
// update_entry
// ---------------------------------------------------------------------------

export const updateEntryTool: ToolDefinition = {
	name: 'update_entry',
	description:
		"Applies a partial patch to an entry's draft `data` and validates the RESULT against the full collection " +
		'schema before saving — nothing is written if the merge would be invalid. The patch is a shallow, ' +
		'top-level merge: each key you include replaces that top-level field entirely (e.g. `{"title": "New"}` ' +
		"changes only `title`); to change something inside a nested array/object (e.g. one row of a project's " +
		"`gallery`), you must supply that whole top-level field's new value, not a deep path into it. Only " +
		'`data` changes — `published_data` (what visitors see) is never touched here, by design; this tool ' +
		'cannot publish. Every successful update is recorded as a revision.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug. Omit for a singleton collection." },
			id: { type: 'string', description: "The entry's id (uuid). Alternative to `slug`." },
			patch: {
				type: 'object',
				description:
					'Top-level fields to replace in `data`. See the tool description for merge semantics.'
			},
			note: {
				type: 'string',
				description:
					'Optional short note describing why this change was made, stored on the revision.'
			}
		},
		required: ['collection', 'patch'],
		additionalProperties: false
	},
	handler: async (args, ctx) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		const slug = typeof args.slug === 'string' ? args.slug : undefined;
		const id = typeof args.id === 'string' ? args.id : undefined;
		const row = await resolveEntry(collection, { id, slug });
		if (!row) {
			return textResult(
				`No entry found in collection "${key}" for ${id ? `id "${id}"` : `slug "${slug ?? SINGLETON_SLUG}"`}.`,
				true
			);
		}

		const patch = args.patch;
		if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
			return textResult(
				'`patch` must be a JSON object of top-level fields to replace in `data`.',
				true
			);
		}

		const currentData = row.data as Record<string, unknown>;
		const merged = { ...currentData, ...(patch as Record<string, unknown>) };

		const parsed = collection.schema.safeParse(merged);
		if (!parsed.success) {
			return textResult(formatZodError(key, parsed.error), true);
		}

		const note = typeof args.note === 'string' ? args.note : undefined;

		const [updated] = await db
			.update(entries)
			.set({ data: parsed.data, updatedAt: new Date() })
			.where(eq(entries.id, row.id))
			.returning();

		await recordRevision({ entryId: row.id, data: parsed.data, clientId: ctx.clientId, note });

		return textResult(serializeEntry(updated));
	}
};

// ---------------------------------------------------------------------------
// delete_entry
// ---------------------------------------------------------------------------

export const deleteEntryTool: ToolDefinition = {
	name: 'delete_entry',
	description:
		'Permanently deletes a draft entry. Refuses on two kinds of entry, both because this server never ' +
		"changes what visitors see: (1) a singleton's entry — a singleton must always have exactly one, deleting " +
		'it would leave the collection empty and break every page reading it; (2) any entry that has ever been ' +
		'published (its `published_data` is not null) — deleting the row deletes that snapshot too, which would ' +
		'remove it from the live site immediately, and this server implements no publish/unpublish/rollback to ' +
		'undo that. Only entries that were created and never published can be deleted.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug." },
			id: { type: 'string', description: "The entry's id (uuid). Alternative to `slug`." }
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		const slug = typeof args.slug === 'string' ? args.slug : undefined;
		const id = typeof args.id === 'string' ? args.id : undefined;
		const row = await resolveEntry(collection, { id, slug });
		if (!row) {
			return textResult(
				`No entry found in collection "${key}" for ${id ? `id "${id}"` : `slug "${slug ?? SINGLETON_SLUG}"`}.`,
				true
			);
		}

		if (collection.kind === 'singleton') {
			return textResult(
				`"${key}" is a singleton collection; its one entry cannot be deleted (that would leave the ` +
					'collection with zero entries, which breaks every page reading it).',
				true
			);
		}

		if (row.publishedData !== null) {
			return textResult(
				`Entry "${row.slug}" in collection "${key}" has been published (published_data is set) — deleting ` +
					'it would remove it from the live site immediately, and this server has no publish/unpublish/' +
					'rollback tool (Lane A8) to undo that. Only never-published draft entries can be deleted.',
				true
			);
		}

		await db.delete(entries).where(eq(entries.id, row.id));
		return textResult({ deleted: true, collection: key, id: row.id, slug: row.slug });
	}
};

// ---------------------------------------------------------------------------
// reorder_entries
// ---------------------------------------------------------------------------

export const reorderEntriesTool: ToolDefinition = {
	name: 'reorder_entries',
	description:
		'Sets a new display order for every entry in a `list` collection, by giving the full list of slugs in ' +
		'the desired order. IMPORTANT SCHEMA LIMITATION: `position` is a single column shared by draft and live ' +
		'ordering — there is no separate "draft order" — so reordering necessarily changes the order any already-' +
		'published entries render in, which this server otherwise never does. To keep that guarantee, this tool ' +
		'refuses to run at all if ANY entry in the collection has ever been published (published_data is not ' +
		'null on any of them). It only works on a collection where nothing has been published yet.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			collection: {
				type: 'string',
				description: 'A collection key, e.g. "projects". Must be a `list` collection.'
			},
			order: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Every entry slug in this collection, in the desired new order. Must be a permutation of the current slugs — no missing, no extra, no duplicates.'
			}
		},
		required: ['collection', 'order'],
		additionalProperties: false
	},
	handler: async (args) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		if (collection.kind === 'singleton') {
			return textResult(
				`"${key}" is a singleton collection with a single entry — there is nothing to reorder.`,
				true
			);
		}

		const order = Array.isArray(args.order) ? args.order.map(String) : null;
		if (!order || order.length === 0) {
			return textResult(
				"`order` must be a non-empty array of this collection's entry slugs.",
				true
			);
		}

		const rows = await listEntryRows(collection.key);

		const published = rows.filter((r) => r.publishedData !== null);
		if (published.length > 0) {
			return textResult(
				`Collection "${key}" has ${published.length} published entr${published.length === 1 ? 'y' : 'ies'} ` +
					`(${published.map((r) => r.slug).join(', ')}). Reordering would change the live order of those ` +
					'entries because `position` is shared between draft and published state in this schema — see the ' +
					'tool description. Reordering is only available before anything in this collection has been ' +
					'published.',
				true
			);
		}

		const currentSlugs = new Set(rows.map((r) => r.slug));
		const orderSet = new Set(order);
		const missing = [...currentSlugs].filter((s) => !orderSet.has(s));
		const extra = order.filter((s) => !currentSlugs.has(s));
		const duplicates = order.filter((s, i) => order.indexOf(s) !== i);
		if (missing.length > 0 || extra.length > 0 || duplicates.length > 0) {
			const parts: string[] = [];
			if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
			if (extra.length > 0) parts.push(`unknown: ${extra.join(', ')}`);
			if (duplicates.length > 0) parts.push(`duplicated: ${[...new Set(duplicates)].join(', ')}`);
			return textResult(
				`\`order\` must be exactly a permutation of this collection's current slugs (${parts.join('; ')}).`,
				true
			);
		}

		const bySlug = new Map(rows.map((r) => [r.slug, r]));
		for (let i = 0; i < order.length; i++) {
			const row = bySlug.get(order[i])!;
			if (row.position !== i) {
				await db
					.update(entries)
					.set({ position: i, updatedAt: new Date() })
					.where(eq(entries.id, row.id));
			}
		}

		const updatedRows = await listEntryRows(collection.key);
		return textResult({ collection: key, entries: updatedRows.map(serializeEntry) });
	}
};

export const entryTools: ToolDefinition[] = [
	listEntriesTool,
	getEntryTool,
	createEntryTool,
	updateEntryTool,
	deleteEntryTool,
	reorderEntriesTool
];
