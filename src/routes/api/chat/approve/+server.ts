/**
 * "Aprobar" (Lane B7) — publishes every entry in the conversation's current
 * pending change set. This is the ONLY path that moves production for
 * anything the panel touched: the chat model itself can never call
 * `publish`/`unpublish` (see `chat/tools-bridge.ts`'s header) — this
 * endpoint is a plain bearer-token-authenticated POST the BROWSER calls
 * directly when the owner clicks "Aprobar" on a change card, never
 * something the model triggers. Requires "publish" scope, exactly like the
 * `publish` tool itself would.
 *
 * Reuses `publishTool.handler` (the same function `/api/mcp`'s `publish`
 * tool calls) directly, once per pending entry, in single-entry mode — not
 * a second publish implementation. Captures each entry's live snapshot
 * (`publishedData`/`publishedPosition`/`status`) immediately before
 * publishing it, into the card's `approvedSnapshot`, so `routes/api/chat/undo`
 * can restore exactly that later ("Deshacer").
 *
 * Partial failure (one entry's publish-time render validation fails while
 * others succeed — see `publishOrRollback` in `mcp/tools/publish.ts`) keeps
 * the failed entry/entries in the pending set (still shown, still
 * approvable again) and only clears the ones that actually went live.
 */

import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient } from '$lib/server/cms/chat/store';
import { getPendingChange, setPendingEntries } from '$lib/server/cms/chat/pending-changes';
import { buildChangeCard, type ChangeCardEntry } from '$lib/server/cms/chat/change-card';
import { setChangeCard, getMessageById } from '$lib/server/cms/chat/store';
import { getCollection } from '$lib/server/cms/mcp/collections';
import { resolveEntry } from '$lib/server/cms/mcp/entry-store';
import { publishTool } from '$lib/server/cms/mcp/tools/publish';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'publish');
	if (auth instanceof Response) return auth;

	const origin = new URL(request.url).origin;
	const conversation = await getConversationForClient(auth.clientId);
	if (!conversation) return Response.json({ ok: true, card: null });

	const pending = await getPendingChange(conversation.id);
	if (!pending || pending.entries.length === 0) {
		return Response.json({ ok: true, card: null });
	}

	const freshCard = await buildChangeCard(origin, pending.entries);
	const ctx = { clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope, origin };

	const succeededEntries: ChangeCardEntry[] = [];
	const stillPendingEntries: ChangeCardEntry[] = [];
	const errors: string[] = [];

	for (const entryCard of freshCard.entries) {
		const collection = getCollection(entryCard.collection);
		if (!collection) continue;
		const row = await resolveEntry(collection, { slug: entryCard.slug ?? undefined });
		if (!row) continue; // vanished since the card was built — nothing to publish

		const snapshot = { publishedData: row.publishedData, publishedPosition: row.publishedPosition, status: row.status };
		const outcome = await publishTool.handler(
			{ collection: entryCard.collection, ...(entryCard.slug ? { slug: entryCard.slug } : {}) },
			ctx
		);
		if (outcome.isError) {
			stillPendingEntries.push(entryCard);
			errors.push(outcome.content[0]?.text ?? `No se pudo publicar "${entryCard.label}".`);
			continue;
		}
		succeededEntries.push({ ...entryCard, approvedSnapshot: snapshot });
	}

	if (!pending.cardMessageId) {
		// Shouldn't happen (a non-empty pending set always has a card
		// message — see `agent.ts`'s `finalizeCard`) but never crash the
		// approval over a missing pointer.
		await setPendingEntries(
			conversation.id,
			stillPendingEntries.map((e) => ({ collection: e.collection, slug: e.slug }))
		);
		return Response.json({ ok: errors.length === 0, errors, card: null });
	}

	if (stillPendingEntries.length > 0) {
		// Partial (or total) failure: keep the failed ones pending, drop the
		// succeeded ones from the pending set, and show a card that reflects
		// exactly that split rather than silently losing the distinction.
		await setPendingEntries(
			conversation.id,
			stillPendingEntries.map((e) => ({ collection: e.collection, slug: e.slug }))
		);
		const partialCard = { status: 'pending' as const, entries: stillPendingEntries };
		const updated = await setChangeCard(pending.cardMessageId, partialCard);
		return Response.json({ ok: false, errors, messageId: pending.cardMessageId, card: updated?.changeCard ?? partialCard });
	}

	// Everything published — clear the pending set and freeze the card.
	await setPendingEntries(conversation.id, []);
	const publishedCard = {
		status: 'published' as const,
		entries: succeededEntries,
		publishedAt: new Date().toISOString()
	};
	const updated = await setChangeCard(pending.cardMessageId, publishedCard);
	// Sanity: confirm the message still exists (it always should — nothing
	// deletes chat_messages except "Borrar conversación", which would also
	// have cleared the pending set).
	if (!updated) {
		const check = await getMessageById(pending.cardMessageId);
		if (!check) return Response.json({ ok: true, card: publishedCard, messageId: pending.cardMessageId });
	}
	return Response.json({ ok: true, card: updated?.changeCard ?? publishedCard, messageId: pending.cardMessageId });
};
