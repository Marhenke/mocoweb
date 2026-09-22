/**
 * "Deshacer" (Lane B7) — on an already-Aprobado change card, rolls every
 * entry it published back to exactly what was live immediately before that
 * approval, using the `approvedSnapshot` each entry was given at approval
 * time (see `routes/api/chat/approve`). A plain bearer-token-authenticated
 * POST the browser calls directly, never the chat model — same reasoning as
 * `approve`/`discard`. Requires "publish" scope: like `approve`, this moves
 * production.
 *
 * Takes `{ messageId }` (the specific card's `chat_messages.id`, which the
 * browser already has — it's rendering that exact bubble) rather than
 * always acting on "whatever the conversation's current card is": once a
 * card is published, the pending set is cleared (see `approve`), so there
 * is no longer a conversation-level pointer to it — the message id IS the
 * only remaining identity for "which approval to undo." This also means a
 * card from several turns ago can still be undone even after newer,
 * unrelated pending changes have started accumulating.
 */

import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { getConversationForClient, getMessageById, setChangeCard } from '$lib/server/cms/chat/store';
import { restorePublishedSnapshot } from '$lib/server/cms/mcp/tools/publish';
import type { ChangeCard } from '$lib/server/cms/chat/change-card';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'publish');
	if (auth instanceof Response) return auth;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json(
			{ error: 'invalid_request', error_description: 'No se pudo leer el pedido. Probá de nuevo.' },
			{ status: 400 }
		);
	}
	const messageId = typeof (body as Record<string, unknown>)?.messageId === 'string' ? (body as Record<string, unknown>).messageId as string : null;
	if (!messageId) {
		return Response.json(
			{ error: 'invalid_request', error_description: 'Falta indicar qué cambio deshacer.' },
			{ status: 400 }
		);
	}

	const conversation = await getConversationForClient(auth.clientId);
	const message = conversation ? await getMessageById(messageId) : null;
	if (!message || message.conversationId !== conversation?.id) {
		return Response.json(
			{ error: 'not_found', error_description: 'No encontré ese cambio en esta conversación.' },
			{ status: 404 }
		);
	}

	const card = message.changeCard as ChangeCard | null;
	if (!card || card.status !== 'published') {
		return Response.json(
			{ error: 'invalid_state', error_description: 'Ese cambio no está publicado — no hay nada que deshacer.' },
			{ status: 409 }
		);
	}

	const errors: string[] = [];
	for (const entryCard of card.entries) {
		if (!entryCard.approvedSnapshot) continue;
		const outcome = await restorePublishedSnapshot({
			collectionKey: entryCard.collection,
			slug: entryCard.slug,
			snapshot: entryCard.approvedSnapshot
		});
		if (!outcome.ok) errors.push(outcome.message);
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

	const undoneCard: ChangeCard = { status: 'undone', entries: card.entries };
	const updated = await setChangeCard(messageId, undoneCard);
	return Response.json({ ok: true, card: updated?.changeCard ?? undoneCard, messageId });
};
