/**
 * "Descartar" (Lane B7) — reverts every entry in the conversation's current
 * pending change set back to exactly what's live, without publishing
 * anything. A plain bearer-token-authenticated POST the browser calls
 * directly (never the chat model) — see `routes/api/chat/approve`'s header
 * for the same reasoning applied here.
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
 */

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/cms/db/client';
import { entries } from '$lib/server/cms/db/schema';
import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient, setChangeCard } from '$lib/server/cms/chat/store';
import { getPendingChange, clearPendingChange } from '$lib/server/cms/chat/pending-changes';
import { buildChangeCard } from '$lib/server/cms/chat/change-card';
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
		return Response.json({ ok: true, card: null });
	}

	// Diff captured BEFORE reverting — the discarded card still shows what
	// was thrown away, same as the "published" card shows what went live.
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
	const discardedCard = { status: 'discarded' as const, entries: freshCard.entries };
	const updated = pending.cardMessageId ? await setChangeCard(pending.cardMessageId, discardedCard) : null;
	return Response.json({ ok: true, card: updated?.changeCard ?? discardedCard, messageId: pending.cardMessageId });
};
