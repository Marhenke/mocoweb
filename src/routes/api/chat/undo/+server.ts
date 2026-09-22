/**
 * "Deshacer" (Lane B7, redesigned in Lane B8) — rolls production back to
 * exactly what was live immediately before the conversation's most recent
 * approval, using the `approvedSnapshot` each entry was given at approval
 * time (see `routes/api/chat/approve`), AND returns that work to the site's
 * one open change set so the owner can adjust and approve it again. A plain
 * bearer-token-authenticated POST the browser calls directly, never the
 * chat model — same reasoning as `approve`/`discard`. Requires "publish"
 * scope: like `approve`, this moves production.
 *
 * ── Lane B8: undo must not throw the edit away ───────────────────────────
 * The B7 version of this endpoint, after rolling production back, ALSO
 * reset the entry's DRAFT (`data`) to the pre-approval snapshot — meaning
 * the edit itself was gone, not just unpublished. The brief for this lane
 * is explicit that this is wrong: "Deshacer... must roll production back
 * AND return that work to the open change set... so the owner can adjust
 * and approve again — not merely revert and lose it." This version leaves
 * `data` exactly as it was (the approved edit) — only `published_data` /
 * `published_position` / `status` move back to the snapshot — and re-adds
 * the entry to the pending set (`addPendingEntries`), so the persistent
 * pinned bar comes back showing that same work, ready for Aprobar again.
 *
 * Takes no body: `last_published` is a single slot on the conversation (see
 * `pending-changes.ts`'s header — "exactly one open change set" extends to
 * "exactly one undoable publish"), so there is nothing to disambiguate.
 */

import { db } from '$lib/server/cms/db/client';
import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient } from '$lib/server/cms/chat/store';
import { getLastPublished, setLastPublished, addPendingEntries } from '$lib/server/cms/chat/pending-changes';
import { restorePublishedSnapshot } from '$lib/server/cms/mcp/tools/publish';
import { getOpenChangeSet } from '$lib/server/cms/chat/open-change-set';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'publish');
	if (auth instanceof Response) return auth;

	const origin = new URL(request.url).origin;
	const conversation = await getConversationForClient(auth.clientId);
	if (!conversation) {
		return Response.json(
			{ error: 'not_found', error_description: 'No encontré ninguna conversación para deshacer.' },
			{ status: 404 }
		);
	}

	const lastPublished = await getLastPublished(conversation.id);
	if (!lastPublished || lastPublished.entries.length === 0) {
		return Response.json(
			{ error: 'invalid_state', error_description: 'No hay nada publicado para deshacer.' },
			{ status: 409 }
		);
	}

	const errors: string[] = [];
	for (const entryCard of lastPublished.entries) {
		if (!entryCard.approvedSnapshot) continue;
		const outcome = await restorePublishedSnapshot({
			collectionKey: entryCard.collection,
			slug: entryCard.slug,
			snapshot: entryCard.approvedSnapshot
		});
		if (!outcome.ok) {
			errors.push(outcome.message);
		}
		// Deliberately NOT resetting `data` (the draft) here — see this
		// file's header. The edited content stays exactly as approved; only
		// what's LIVE moves back.
	}

	if (errors.length > 0) {
		return Response.json(
			{
				error: 'undo_failed',
				error_description: 'No se pudo deshacer del todo — probá de nuevo en un momento.'
			},
			{ status: 502 }
		);
	}

	await setLastPublished(conversation.id, null);
	await addPendingEntries(
		conversation.id,
		lastPublished.entries.map((e) => ({ collection: e.collection, slug: e.slug }))
	);

	const card = await getOpenChangeSet(conversation.id, origin);
	return Response.json({ ok: true, card });
};
