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
		'Deletes a draft entry — behavior depends on whether it has ever been published, because this server ' +
		'never changes what visitors see outside of `publish`: (1) an entry that has NEVER been published ' +
		'(`publishedData` is null) is deleted outright, immediately, right now. (2) an entry that HAS been ' +
		'published (`publishedData` is not null) is NOT deleted yet — deleting the row would delete its live ' +
		'snapshot too, taking it off the site instantly. Instead this sets `pendingDelete: true` on the entry: ' +
		'it keeps rendering on the live site exactly as before, and disappears only on the next `publish` call ' +
		'for this collection (or for this entry specifically), which is what actually removes the row. Call ' +
		'again with `restore: true` to cancel a pending delete before publishing. Always refuses on a ' +
		"singleton's entry — a singleton must always have exactly one, deleting it would leave the collection " +
		'empty and break every page reading it.',
	scope: 'write',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug." },
			id: { type: 'string', description: "The entry's id (uuid). Alternative to `slug`." },
			restore: {
				type: 'boolean',
				description:
					'Set true to cancel a previously-set pendingDelete on a published entry instead of deleting/queuing it — undoes the effect of a prior delete_entry call, as long as publish has not run since.'
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

		const restore = args.restore === true;

		if (restore) {
			if (!row.pendingDelete) {
				return textResult(
					`Entry "${row.slug}" in collection "${key}" is not pending deletion — nothing to restore.`,
					true
				);
			}
			const [updated] = await db
				.update(entries)
				.set({ pendingDelete: false, updatedAt: new Date() })
				.where(eq(entries.id, row.id))
				.returning();
			return textResult(serializeEntry(updated));
		}

		if (row.publishedData === null) {
			// Never published: nothing live to protect, delete outright.
			await db.delete(entries).where(eq(entries.id, row.id));
			return textResult({ deleted: true, collection: key, id: row.id, slug: row.slug });
		}

		if (row.pendingDelete) {
			return textResult(
				`Entry "${row.slug}" in collection "${key}" is already pending deletion — it will be removed on the ` +
					'next publish. Call again with restore: true to cancel that.',
				true
			);
		}

		const [updated] = await db
			.update(entries)
			.set({ pendingDelete: true, updatedAt: new Date() })
			.where(eq(entries.id, row.id))
			.returning();
		return textResult({
			pendingDelete: true,
			note: `Entry "${row.slug}" is still live. It will be removed from the site the next time collection "${key}" (or this entry) is published.`,
			entry: serializeEntry(updated)
		});
	}
};

// ---------------------------------------------------------------------------
// reorder_entries
// ---------------------------------------------------------------------------

export const reorderEntriesTool: ToolDefinition = {
	name: 'reorder_entries',
	description:
		'Sets a new DRAFT display order for every entry in a `list` collection, by giving the full list of slugs ' +
		'in the desired order. This only ever changes `position` (the draft order) — the live site keeps ' +
		'rendering in whatever order `publish` last froze into `publishedPosition`, completely unaffected, until ' +
		'you call `publish` on this collection. Works freely on a collection that already has published entries ' +
		'— reordering the draft is always safe; only `publish` can move production.',
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
