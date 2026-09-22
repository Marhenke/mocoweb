/**
 * "Aprobar" (Lane B7, redesigned in Lane B8) — publishes every entry in the
 * conversation's current pending change set. This is the ONLY path that
 * moves production for anything the panel touched: the chat model itself
 * can never call `publish`/`unpublish` (see `chat/tools-bridge.ts`'s
 * header) — this endpoint is a plain bearer-token-authenticated POST the
 * BROWSER calls directly when the owner clicks "Aprobar" on the persistent
 * pinned bar, never something the model triggers. Requires "publish" scope,
 * exactly like the `publish` tool itself would.
 *
 * Reuses `publishTool.handler` (the same function `/api/mcp`'s `publish`
 * tool calls) directly, once per pending entry, in single-entry mode — not
 * a second publish implementation. Captures each entry's live snapshot
 * (`publishedData`/`publishedPosition`/`status`) immediately before
 * publishing it, and moves the succeeded entries into the conversation's
 * ONE `last_published` slot (`chat/pending-changes.ts`) — replacing
 * whatever was there before — so `routes/api/chat/undo` can restore exactly
 * that later ("Deshacer").
 *
 * Partial failure (one entry's publish-time render validation fails while
 * others succeed — see `publishOrRollback` in `mcp/tools/publish.ts`) keeps
 * the failed entry/entries in the pending set (still shown, still
 * approvable again) and only moves the ones that actually went live into
 * `last_published`.
 */

import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient } from '$lib/server/cms/chat/store';
import { getPendingChange, setPendingEntries, setLastPublished } from '$lib/server/cms/chat/pending-changes';
import { buildChangeCard, type ChangeCardEntry } from '$lib/server/cms/chat/change-card';
import { getOpenChangeSet } from '$lib/server/cms/chat/open-change-set';
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
		return Response.json({ ok: true, card: await getOpenChangeSet(conversation.id, origin) });
	}

	const freshCard = await buildChangeCard(origin, pending.entries);
	const ctx = { clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope, origin };

	const succeededEntries: ChangeCardEntry[] = [];
	const stillPendingRefs: { collection: string; slug: string | null }[] = [];
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
			stillPendingRefs.push({ collection: entryCard.collection, slug: entryCard.slug });
			errors.push(outcome.content[0]?.text ?? `No se pudo publicar "${entryCard.label}".`);
			continue;
		}
		succeededEntries.push({ ...entryCard, approvedSnapshot: snapshot });
	}

	await setPendingEntries(conversation.id, stillPendingRefs);

	if (succeededEntries.length > 0) {
		// Lane B8 — a single "last published" slot, not a stack: replaces
		// whatever was previously undoable. See `pending-changes.ts`'s header
		// for why that matches "exactly one open change set."
		await setLastPublished(conversation.id, {
			entries: succeededEntries,
			publishedAt: new Date().toISOString()
		});
	}

	const card = await getOpenChangeSet(conversation.id, origin);
	return Response.json({ ok: errors.length === 0, errors, card });
};
