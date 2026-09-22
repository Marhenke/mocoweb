/**
 * "Descartar" (Lane B7, redesigned in Lane B8) — reverts every entry in the
 * conversation's current pending change set back to exactly what's live,
 * without publishing anything. A plain bearer-token-authenticated POST the
 * browser calls directly (never the chat model) — see
 * `routes/api/chat/approve`'s header for the same reasoning applied here.
 *
 * "Revert to live" means two different things depending on the entry's own
 * history, same distinction `delete_entry` already draws (see
 * `mcp/tools/entries.ts`): an entry that has been published before reverts
 * its DRAFT (`data`) back to `publishedData` (undoing the edit, not the
 * entry); an entry that has NEVER been published (created fresh in this
 * pending set, `publishedData` still null) is deleted outright — there is
 * no "live version" to revert to, so discarding its creation means it never
 * existed. `write` scope is enough (this never touches `publishedData`
 * itself, only drafts) — narrower than "publish", matching every other
 * draft-only tool in this codebase.
 *
 * Only ever touches the PENDING set — a still-undoable earlier publish
 * (`last_published`) is untouched by Descartar; that's a separate action
 * (Deshacer, `routes/api/chat/undo`).
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/cms/db/client';
import { entries } from '$lib/server/cms/db/schema';
import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient } from '$lib/server/cms/chat/store';
import { getPendingChange, clearPendingChange } from '$lib/server/cms/chat/pending-changes';
import { buildChangeCard } from '$lib/server/cms/chat/change-card';
import { getOpenChangeSet } from '$lib/server/cms/chat/open-change-set';
import { getCollection } from '$lib/server/cms/mcp/collections';
import { resolveEntry } from '$lib/server/cms/mcp/entry-store';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'write');
	if (auth instanceof Response) return auth;

	const origin = new URL(request.url).origin;
	const conversation = await getConversationForClient(auth.clientId);
	if (!conversation) return Response.json({ ok: true, card: null });

	const pending = await getPendingChange(conversation.id);
	if (!pending || pending.entries.length === 0) {
		return Response.json({ ok: true, card: await getOpenChangeSet(conversation.id, origin) });
	}

	const freshCard = await buildChangeCard(origin, pending.entries);

	for (const entryCard of freshCard.entries) {
		const collection = getCollection(entryCard.collection);
		if (!collection) continue;
		const row = await resolveEntry(collection, { slug: entryCard.slug ?? undefined });
		if (!row) continue;

		if (row.publishedData === null) {
			await db.delete(entries).where(eq(entries.id, row.id));
		} else {
			await db
				.update(entries)
				.set({
					data: row.publishedData,
					pendingDelete: false,
					position: row.publishedPosition ?? row.position,
					updatedAt: new Date()
				})
				.where(eq(entries.id, row.id));
		}
	}

	await clearPendingChange(conversation.id);
	// Descartar never touches an already-undoable publish — only whatever
	// was still pending.
	const card = await getOpenChangeSet(conversation.id, origin);
	return Response.json({ ok: true, card });
};
