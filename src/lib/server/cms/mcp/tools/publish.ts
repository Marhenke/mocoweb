/**
 * Publish-surface tools (Lane A8): `publish`, `unpublish`, `list_revisions`,
 * `rollback`, `preview_url`. Everything before this lane could only ever
 * touch `data` (the draft) — these five are the only tools that can move
 * what a visitor actually sees, which is why `publish`/`unpublish`/
 * `rollback` require the `publish` scope (see `../../auth/scope.ts`), a
 * strictly higher trust level than `write`.
 */

import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { entries, revisions } from '../../db/schema';
import { getCollection, collectionNotFoundMessage, SINGLETON_SLUG } from '../collections';
import {
	listEntryRows,
	resolveEntry,
	serializeEntry,
	nextAppendPublishedPosition
} from '../entry-store';
import { recordRevision, SEED_REVISION_CLIENT_ID } from '../revisions';
import {
	validateRegeneration,
	type FanOutOptions,
	type RegenerateResult
} from '../../cache/regenerate';
import { signPreviewToken, PREVIEW_QUERY_PARAM } from '../../auth/preview-token';
import { routesForCollection } from '$lib/content.schema';
import { textResult, type ToolDefinition } from '../types';

// ---------------------------------------------------------------------------
// Publish-validation helper (Lane B2)
// ---------------------------------------------------------------------------

/**
 * The property the migration brief calls "publish must validate by
 * rendering": renders every route this publish/unpublish would affect
 * BEFORE trusting the DB write that just happened. If any of them fails to
 * render, `rollback` (a caller-supplied compensating write that restores
 * exactly what the DB looked like before this call) is invoked and the
 * cache is left completely untouched — no path is deleted, overwritten, or
 * cleared — so the previously published version keeps serving. Only on
 * success is the cache actually written (`validation.commit()`).
 *
 * This must run AFTER the DB write it's validating (see
 * `validateRegeneration`'s doc comment for why: the render is a real HTTP
 * self-fetch on a separate Postgres connection, so it can only ever see
 * committed data) — every call site here follows that order: write, then
 * validate-or-rollback.
 */
async function publishOrRollback(
	collectionKey: string,
	fanOutOpts: FanOutOptions,
	rollback: () => Promise<void>
): Promise<{ ok: true; regen: RegenerateResult } | { ok: false; message: string }> {
	const validation = await validateRegeneration(collectionKey, fanOutOpts);
	if (validation.ok) {
		return { ok: true, regen: await validation.commit() };
	}
	await rollback();
	const failedPaths = validation.failures.map((f) => f.path).join(', ');
	return {
		ok: false,
		message:
			`Publish refused: rendering failed for ${failedPaths}. Nothing was changed — the DB write ` +
			'was rolled back and the previously published version is still live and still cached. ' +
			"Fix whatever's broken about that route's render (bad/missing referenced content is the " +
			'usual cause), then publish again.'
	};
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

export const publishTool: ToolDefinition = {
	name: 'publish',
	description:
		'Applies a collection\'s DRAFT state to what visitors see: content (`data` → `publishedData`), order ' +
		'(`position` → `publishedPosition`), and deletions (any entry with `pendingDelete: true` is removed for ' +
		'good) — then re-renders and re-caches every page this collection affects (see get_site_map for the ' +
		'route↔collection map). This is the ONLY tool that moves production; everything else in this server ' +
		'only ever edits the draft.\n\n' +
		'TWO MODES — pick deliberately, they do different things:\n' +
		'  - Omit `slug` → WHOLE-COLLECTION mode: publishes every entry\'s current draft content, the full ' +
		'current draft order, AND every pending delete, all at once. This is the ONLY mode that moves order — ' +
		'if you just called reorder_entries and want that live, you MUST use this mode with no `slug`; calling ' +
		'single-entry mode afterward will publish content but silently leave the live order exactly as it was. ' +
		'Also republishes the current draft content of every OTHER already-published entry in the collection, ' +
		'even ones you didn\'t mean to touch right now — fine if they\'re already in the state you want live, but ' +
		'check list_entries first if you\'re not sure everything in this collection is ready to go out together.\n' +
		'  - Pass `slug` → SINGLE-ENTRY mode: publishes just that one entry\'s current draft content (or, if it\'s ' +
		'`pendingDelete`, removes it) and touches nothing else — every other entry\'s live content and the live ' +
		'order are left exactly as they were. A brand-new never-before-published entry lands at the END of the ' +
		'live order, not wherever it happens to sit in the draft order. Use this for an isolated content edit to ' +
		'one entry when you specifically do NOT want to also push out whatever else is sitting in this ' +
		"collection's draft.\n\n" +
		'Requires "publish" scope — a "write"-scoped token can edit drafts all day and will get a 403 calling this.',
	scope: 'publish',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: {
				type: 'string',
				description:
					'Publish only this one entry\'s content (list collections only). Omit to publish the whole collection (content + order + deletions).'
			}
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args, ctx) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		const slug = typeof args.slug === 'string' && args.slug.length > 0 ? args.slug : undefined;

		if (slug) {
			if (collection.kind === 'singleton') {
				return textResult(
					`"${key}" is a singleton — it has one entry with no slug. Call publish({ collection: "${key}" }) with no slug.`,
					true
				);
			}
			const row = await resolveEntry(collection, { slug });
			if (!row) {
				return textResult(`No entry found in collection "${key}" for slug "${slug}".`, true);
			}

			if (row.pendingDelete) {
				await db.delete(entries).where(eq(entries.id, row.id));
				const outcome = await publishOrRollback(key, { removedSlugs: [row.slug] }, async () => {
					// The row was deleted outright, not just modified — the only way
					// to restore it is re-inserting the exact snapshot taken above.
					await db.insert(entries).values(row);
				});
				if (!outcome.ok) return textResult(outcome.message, true);
				return textResult({
					collection: key,
					deleted: row.slug,
					regenerated: outcome.regen.regenerated,
					invalidated: outcome.regen.invalidated
				});
			}

			const previous = {
				publishedData: row.publishedData,
				publishedPosition: row.publishedPosition,
				status: row.status
			};
			const publishedPosition =
				row.publishedPosition ?? (await nextAppendPublishedPosition(key));
			const [updated] = await db
				.update(entries)
				.set({
					publishedData: row.data,
					publishedPosition,
					status: 'published',
					updatedAt: new Date()
				})
				.where(eq(entries.id, row.id))
				.returning();

			const outcome = await publishOrRollback(key, { changedSlug: row.slug }, async () => {
				await db
					.update(entries)
					.set({ ...previous, updatedAt: new Date() })
					.where(eq(entries.id, row.id));
			});
			if (!outcome.ok) return textResult(outcome.message, true);
			return textResult({
				entry: serializeEntry(updated),
				regenerated: outcome.regen.regenerated,
				invalidated: outcome.regen.invalidated
			});
		}

		// Whole-collection publish.
		if (collection.kind === 'singleton') {
			const row = await resolveEntry(collection, {});
			if (!row) return textResult(`Collection "${key}" has no entry to publish.`, true);
			const previous = {
				publishedData: row.publishedData,
				publishedPosition: row.publishedPosition,
				status: row.status
			};
			const [updated] = await db
				.update(entries)
				.set({
					publishedData: row.data,
					publishedPosition: 0,
					status: 'published',
					updatedAt: new Date()
				})
				.where(eq(entries.id, row.id))
				.returning();
			const outcome = await publishOrRollback(key, {}, async () => {
				await db
					.update(entries)
					.set({ ...previous, updatedAt: new Date() })
					.where(eq(entries.id, row.id));
			});
			if (!outcome.ok) return textResult(outcome.message, true);
			return textResult({
				entry: serializeEntry(updated),
				regenerated: outcome.regen.regenerated,
				invalidated: outcome.regen.invalidated
			});
		}

		const rows = await listEntryRows(key);
		const toDelete = rows.filter((r) => r.pendingDelete);
		const toPublish = rows.filter((r) => !r.pendingDelete);
		const previousPublishState = toPublish.map((r) => ({
			id: r.id,
			publishedData: r.publishedData,
			publishedPosition: r.publishedPosition,
			status: r.status
		}));

		for (const row of toDelete) {
			await db.delete(entries).where(eq(entries.id, row.id));
		}
		for (const row of toPublish) {
			await db
				.update(entries)
				.set({
					publishedData: row.data,
					publishedPosition: row.position,
					status: 'published',
					updatedAt: new Date()
				})
				.where(eq(entries.id, row.id));
		}

		const outcome = await publishOrRollback(
			key,
			{ fullCollection: true, removedSlugs: toDelete.map((r) => r.slug) },
			async () => {
				for (const prev of previousPublishState) {
					await db
						.update(entries)
						.set({
							publishedData: prev.publishedData,
							publishedPosition: prev.publishedPosition,
							status: prev.status,
							updatedAt: new Date()
						})
						.where(eq(entries.id, prev.id));
				}
				for (const row of toDelete) {
					await db.insert(entries).values(row);
				}
			}
		);
		if (!outcome.ok) return textResult(outcome.message, true);

		const publishedRows = await listEntryRows(key);
		return textResult({
			collection: key,
			published: toPublish.map((r) => r.slug),
			deleted: toDelete.map((r) => r.slug),
			entries: publishedRows.map(serializeEntry),
			regenerated: outcome.regen.regenerated,
			invalidated: outcome.regen.invalidated
		});
	}
};

// ---------------------------------------------------------------------------
// unpublish
// ---------------------------------------------------------------------------

export const unpublishTool: ToolDefinition = {
	name: 'unpublish',
	description:
		'Takes one entry off the live site immediately, WITHOUT deleting it: `publishedData` and ' +
		'`publishedPosition` are cleared (set back to null/none) and `status` reverts to "draft", but `data` ' +
		"(the draft) is untouched — the entry still exists and can be edited or re-published later. Only valid " +
		"for `list` collections (a singleton must always be live; there is nothing to unpublish). Re-renders " +
		'every page this collection affects so the removal takes effect immediately, not just on the next ' +
		'unrelated publish. Requires "publish" scope.',
	scope: 'publish',
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

		if (collection.kind === 'singleton') {
			return textResult(
				`"${key}" is a singleton — its one entry must always be live and cannot be unpublished.`,
				true
			);
		}

		const slug = typeof args.slug === 'string' ? args.slug : undefined;
		const id = typeof args.id === 'string' ? args.id : undefined;
		const row = await resolveEntry(collection, { id, slug });
		if (!row) {
			return textResult(
				`No entry found in collection "${key}" for ${id ? `id "${id}"` : `slug "${slug}"`}.`,
				true
			);
		}

		if (row.publishedData === null) {
			return textResult(`Entry "${row.slug}" in collection "${key}" is not currently published.`, true);
		}

		const previous = {
			publishedData: row.publishedData,
			publishedPosition: row.publishedPosition,
			pendingDelete: row.pendingDelete,
			status: row.status
		};
		const [updated] = await db
			.update(entries)
			.set({
				publishedData: null,
				publishedPosition: null,
				pendingDelete: false,
				status: 'draft',
				updatedAt: new Date()
			})
			.where(eq(entries.id, row.id))
			.returning();

		const outcome = await publishOrRollback(key, { removedSlugs: [row.slug] }, async () => {
			await db
				.update(entries)
				.set({ ...previous, updatedAt: new Date() })
				.where(eq(entries.id, row.id));
		});
		if (!outcome.ok) return textResult(outcome.message, true);
		return textResult({
			entry: serializeEntry(updated),
			regenerated: outcome.regen.regenerated,
			invalidated: outcome.regen.invalidated
		});
	}
};

// ---------------------------------------------------------------------------
// list_revisions
// ---------------------------------------------------------------------------

export const listRevisionsTool: ToolDefinition = {
	name: 'list_revisions',
	description:
		"Lists an entry's revision history (every past `data` snapshot, newest first), each with its `id` (pass " +
		'to `rollback`), `clientId` (which MCP client made that change), optional `note`, `createdAt`, and ' +
		'`initial` — true on exactly one revision per entry: its seeded starting state (recorded by ' +
		'scripts/seed.ts, `clientId: "system:seed"`), the floor of this entry\'s history. Rolling back to it undoes ' +
		'every agent write ever made to this entry, all the way back to launch. It is always the OLDEST revision ' +
		"(last in this newest-first list) if this entry has any history at all. Read-only.",
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug. Omit for a singleton collection." },
			id: { type: 'string', description: "The entry's id (uuid). Alternative to `slug`." },
			limit: { type: 'number', description: 'Maximum revisions to return (default 20, max 100).' }
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

		const limitArg = typeof args.limit === 'number' ? args.limit : 20;
		const limit = Math.max(1, Math.min(100, Math.floor(limitArg)));

		const rows = await db
			.select()
			.from(revisions)
			.where(eq(revisions.entryId, row.id))
			.orderBy(desc(revisions.createdAt))
			.limit(limit);

		return textResult({
			collection: key,
			slug: row.slug,
			revisions: rows.map((r) => ({
				id: r.id,
				clientId: r.clientId,
				initial: r.clientId === SEED_REVISION_CLIENT_ID,
				note: r.note,
				data: r.data,
				createdAt: r.createdAt.toISOString()
			}))
		});
	}
};

// ---------------------------------------------------------------------------
// rollback
// ---------------------------------------------------------------------------

export const rollbackTool: ToolDefinition = {
	name: 'rollback',
	description:
		"Restores an entry's DRAFT `data` to exactly what it was at a past revision (see list_revisions for " +
		'`revisionId` values). This only ever touches the draft — exactly like update_entry, it never changes ' +
		'`publishedData` — so rolling back what a visitor sees still requires a follow-up `publish` call. The ' +
		'rollback itself is recorded as a new revision (so the history never loses a state, even the one just ' +
		'rolled back from). Requires "publish" scope: a rollback is corrective surgery on content history, not ' +
		'an ordinary edit, and pairs naturally with the undo of a bad publish.',
	scope: 'publish',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: { type: 'string', description: "The entry's slug. Omit for a singleton collection." },
			id: { type: 'string', description: "The entry's id (uuid). Alternative to `slug`." },
			revisionId: { type: 'string', description: 'The revision id to restore (from list_revisions).' }
		},
		required: ['collection', 'revisionId'],
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

		const revisionId = String(args.revisionId ?? '');
		const revisionRows = await db
			.select()
			.from(revisions)
			.where(eq(revisions.id, revisionId))
			.limit(1);
		const revision = revisionRows[0];
		if (!revision || revision.entryId !== row.id) {
			return textResult(
				`Revision "${revisionId}" was not found for entry "${row.slug}" in collection "${key}". Call list_revisions to see valid ids.`,
				true
			);
		}

		const parsed = collection.schema.safeParse(revision.data);
		if (!parsed.success) {
			return textResult(
				`Revision "${revisionId}" no longer matches this collection's current schema and cannot be restored: ` +
					parsed.error.issues.map((i) => i.message).join('; '),
				true
			);
		}

		const [updated] = await db
			.update(entries)
			.set({ data: parsed.data, updatedAt: new Date() })
			.where(eq(entries.id, row.id))
			.returning();

		await recordRevision({
			entryId: row.id,
			data: parsed.data,
			clientId: ctx.clientId,
			note: `rollback to revision ${revisionId}`
		});

		return textResult(serializeEntry(updated));
	}
};

// ---------------------------------------------------------------------------
// preview_url
// ---------------------------------------------------------------------------

export const previewUrlTool: ToolDefinition = {
	name: 'preview_url',
	description:
		'Returns one or more URLs that render this collection\'s DRAFT state — the exact `data` an agent has ' +
		'been editing, including entries never published and excluding any entry pending deletion — instead of ' +
		"what's currently live, so a change can be reviewed before publish. The URL carries a signed, expiring " +
		'token in the query string (never a cookie: this engine has no session mechanism and this endpoint runs ' +
		'no auth check beyond the token itself, so treat the link as a bearer credential — anyone who has it can ' +
		'view the draft, valid for 24 hours). A collection can back more than one route (e.g. `projects` backs ' +
		'/, /trabajos, AND /trabajos/{slug}) — this returns a preview link for every route it backs; for a ' +
		'route with a {slug} segment, `slug` is required to know which entry\'s page to build.',
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			collection: { type: 'string', description: 'A collection key, e.g. "projects".' },
			slug: {
				type: 'string',
				description:
					'Required if this collection backs any route with a {slug} segment (e.g. "projects" → /trabajos/{slug}). Ignored for routes with no {slug} segment.'
			}
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args, ctx) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) return textResult(collectionNotFoundMessage(key), true);

		const slug = typeof args.slug === 'string' ? args.slug : undefined;
		const routes = routesForCollection(key);
		if (routes.length === 0) {
			return textResult(`No route in get_site_map renders collection "${key}".`, true);
		}

		const token = signPreviewToken();
		const urls: { pattern: string; url: string }[] = [];
		for (const route of routes) {
			if (route.dynamic) {
				if (!slug) {
					return textResult(
						`Collection "${key}" backs the dynamic route "${route.pattern}" — pass \`slug\` to build its preview URL (the other, non-dynamic routes it backs, if any, don't need one).`,
						true
					);
				}
				const path = route.pattern.replace('{slug}', slug);
				urls.push({ pattern: route.pattern, url: `${ctx.origin}${path}?${PREVIEW_QUERY_PARAM}=${token}` });
			} else {
				urls.push({
					pattern: route.pattern,
					url: `${ctx.origin}${route.pattern}?${PREVIEW_QUERY_PARAM}=${token}`
				});
			}
		}

		return textResult({ collection: key, urls, expiresInSeconds: 24 * 60 * 60 });
	}
};

// ---------------------------------------------------------------------------
// restorePublishedSnapshot — Lane B7, "Deshacer" on an approved change card
// ---------------------------------------------------------------------------

/**
 * Restores one entry's LIVE state (`publishedData`/`publishedPosition`/
 * `status`) to exactly a prior snapshot — the server-side action behind
 * "Deshacer" on a published change card (`routes/api/chat/undo`). Deliberately
 * NOT a tool (nothing here is registered in `ToolDefinition`/`allTools`,
 * unlike every other export in this file): the brief for that lane is
 * explicit that approve/discard/undo are actions the PANEL TOKEN takes
 * directly, authenticated the same way any other endpoint is, never
 * something the chat model can call — see `chat/tools-bridge.ts`'s header
 * for why `publish`/`unpublish` themselves are excluded from what the model
 * can call, which is the same reasoning applied one level further here:
 * undo is even more clearly an action with no legitimate model-initiated
 * use case.
 *
 * Reuses `publishOrRollback` (this file's own render-validate-or-compensate
 * helper, already used by every tool above) so an undo that would leave a
 * route unable to render gets refused and rolled back to what was live a
 * moment ago — exactly the same safety property `publish` itself has, not a
 * weaker one just because this path doesn't go through the tool registry.
 */
export async function restorePublishedSnapshot(params: {
	collectionKey: string;
	slug: string | null;
	snapshot: {
		publishedData: unknown;
		publishedPosition: number | null;
		status: string;
		/** Lane B9 — see `ChangeCardEntry.approvedSnapshot`'s doc comment in `chat/change-card.ts`. */
		deletedRow?: Record<string, unknown> | null;
	};
}): Promise<{ ok: true } | { ok: false; message: string }> {
	const collection = getCollection(params.collectionKey);
	if (!collection) return { ok: false, message: collectionNotFoundMessage(params.collectionKey) };
	const row = await resolveEntry(collection, { slug: params.slug ?? undefined });

	if (!row) {
		// Lane B9 — the row genuinely doesn't exist anymore. The only
		// legitimate reason (as opposed to a stale/bogus undo request): the
		// approval this is undoing published a PENDING DELETE, which `publish`
		// removes outright (see this file's `publish` handler, the
		// `row.pendingDelete` branch) — `approve/+server.ts` captured the whole
		// row for exactly this case (`snapshot.deletedRow`). Re-`INSERT` it
		// (not update — there's nothing to update), then run it through the
		// same render-validate-or-compensate helper every other path here
		// uses, so an undo that would leave a route unable to render gets
		// refused and rolled back (re-deleted) instead of silently corrupting
		// the site, exactly like a normal publish failure would.
		if (!params.snapshot.deletedRow) {
			return {
				ok: false,
				message: `No entry found in collection "${params.collectionKey}" for slug "${params.slug ?? SINGLETON_SLUG}".`
			};
		}
		const restored = deserializeEntryRow(params.snapshot.deletedRow);
		// `entries.$inferInsert` types `id` as optional (it has a DB default),
		// even though `deserializeEntryRow` always sets it explicitly — pin it
		// to a definite `string` once here rather than fighting that at every
		// later use.
		const restoredId: string = restored.id as string;
		await db.insert(entries).values(restored);
		const outcome = await publishOrRollback(
			params.collectionKey,
			params.slug ? { changedSlug: params.slug } : {},
			async () => {
				await db.delete(entries).where(eq(entries.id, restoredId));
			}
		);
		if (!outcome.ok) return { ok: false, message: outcome.message };
		return { ok: true };
	}

	const currentSnapshot = {
		publishedData: row.publishedData,
		publishedPosition: row.publishedPosition,
		status: row.status
	};
	await db
		.update(entries)
		.set({
			publishedData: params.snapshot.publishedData,
			publishedPosition: params.snapshot.publishedPosition,
			status: params.snapshot.status,
			updatedAt: new Date()
		})
		.where(eq(entries.id, row.id));

	const outcome = await publishOrRollback(
		params.collectionKey,
		params.slug ? { changedSlug: params.slug } : {},
		async () => {
			await db
				.update(entries)
				.set({ ...currentSnapshot, updatedAt: new Date() })
				.where(eq(entries.id, row.id));
		}
	);
	if (!outcome.ok) return { ok: false, message: outcome.message };
	return { ok: true };
}

/**
 * Reverses the JSON round-trip a full `entries` row takes through
 * `chat_conversations.last_published` (a jsonb column, see
 * `chat/pending-changes.ts`): `createdAt`/`updatedAt` come back as ISO
 * strings (jsonb has no native timestamp type — `JSON.stringify` already
 * turned the original `Date` objects into strings on the way in, via their
 * own `toJSON()`), which drizzle's `timestamp()` column type needs as real
 * `Date` instances again for `db.insert(...).values(...)`. Every other field
 * round-trips as-is (string/number/boolean/plain object all survive JSON
 * unchanged).
 */
function deserializeEntryRow(raw: Record<string, unknown>): typeof entries.$inferInsert {
	return {
		id: raw.id as string,
		collectionKey: raw.collectionKey as string,
		slug: raw.slug as string,
		position: raw.position as number,
		status: raw.status as string,
		data: raw.data,
		publishedData: raw.publishedData ?? null,
		publishedPosition: (raw.publishedPosition as number | null) ?? null,
		pendingDelete: false, // it's coming back to life — never re-insert it still flagged for deletion
		createdAt: new Date(raw.createdAt as string),
		updatedAt: new Date()
	};
}

export const publishTools: ToolDefinition[] = [
	publishTool,
	unpublishTool,
	listRevisionsTool,
	rollbackTool,
	previewUrlTool
];
