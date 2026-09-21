/**
 * The admin chat backend (Lane B5) — `/admin`'s only server endpoint. Bearer-
 * token authenticated exactly like `/api/mcp` (same `requireAuth`, same
 * access tokens minted by `/token`); there is no cookie and no session here,
 * consistent with why this whole engine's CSRF guard is disabled (see
 * `vite.config.ts`'s comment on `csrf.trustedOrigins`).
 *
 * There is exactly ONE conversation per site (Lane B5 follow-up — see
 * `chat/store.ts`'s header). POST always resolves and runs a turn against
 * that one conversation (any `conversationId` a caller sends is accepted
 * back only for logging/consistency, never used to pick between several —
 * `getOrCreateSingletonConversation` ignores it entirely). GET returns that
 * one conversation and its messages, or nulls if nothing has been said yet.
 * DELETE removes it outright ("Borrar conversación" in the UI) — every
 * message cascades away with it, and the next POST starts a fresh one.
 *
 * Attachments arrive as base64 in the request body and are uploaded via the
 * SAME `uploadMedia` pipeline `upload_media` (the MCP tool) calls — directly,
 * not by asking the model to call the tool with a giant base64 argument —
 * before the model ever sees the turn, so by the time Claude reads the
 * user's message the image is already a real, ratio-measured media row and
 * the message just references its key/url. See `chat/agent.ts` for why the
 * image is attached to the model call by its public `/media/<key>` URL
 * rather than re-sending base64 on every turn.
 */

import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { uploadMedia } from '$lib/server/cms/media/upload';
import {
	getOrCreateSingletonConversation,
	getConversationForClient,
	deleteConversation,
	listMessages,
	type ChatMessageRow
} from '$lib/server/cms/chat/store';
import { runChatTurn } from '$lib/server/cms/chat/agent';
import { AnthropicApiError, MissingApiKeyError, type AnthropicContentBlock } from '$lib/server/cms/chat/anthropic-client';
import type { RequestHandler } from './$types';

function serializeRow(row: ChatMessageRow) {
	return {
		id: row.id,
		role: row.role,
		content: row.content,
		inputTokens: row.inputTokens,
		outputTokens: row.outputTokens,
		costUsd: row.costUsd,
		budgetBlocked: row.budgetBlocked,
		createdAt: row.createdAt.toISOString()
	};
}

interface AttachmentInput {
	filename: string;
	mime: string;
	dataBase64: string;
}

function parseAttachments(value: unknown): AttachmentInput[] {
	if (!Array.isArray(value)) return [];
	const out: AttachmentInput[] = [];
	for (const item of value) {
		if (
			item &&
			typeof item === 'object' &&
			typeof (item as Record<string, unknown>).filename === 'string' &&
			typeof (item as Record<string, unknown>).mime === 'string' &&
			typeof (item as Record<string, unknown>).dataBase64 === 'string'
		) {
			out.push(item as AttachmentInput);
		}
	}
	return out;
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: 'invalid_request', error_description: 'Body must be JSON.' }, { status: 400 });
	}
	if (typeof body !== 'object' || body === null) {
		return Response.json({ error: 'invalid_request', error_description: 'Body must be a JSON object.' }, { status: 400 });
	}
	const { message, attachments } = body as Record<string, unknown>;

	const messageText = typeof message === 'string' ? message : '';
	const attachmentInputs = parseAttachments(attachments);
	if (messageText.trim().length === 0 && attachmentInputs.length === 0) {
		return Response.json(
			{ error: 'invalid_request', error_description: '`message` or `attachments` is required.' },
			{ status: 400 }
		);
	}

	const origin = new URL(request.url).origin;
	const conversation = await getOrCreateSingletonConversation(auth.clientId);

	// Upload every attachment through the real media pipeline BEFORE the
	// model sees this turn — see this file's header comment.
	const uploaded: { key: string; url: string; width: number; height: number; ratio: number; deduped: boolean; mime: string }[] = [];
	try {
		for (const att of attachmentInputs) {
			const bytes = Buffer.from(att.dataBase64, 'base64');
			if (bytes.length === 0) continue;
			const result = await uploadMedia({ bytes, filename: att.filename, mime: att.mime, alt: null });
			uploaded.push(result);
		}
	} catch (err) {
		const description = err instanceof Error ? err.message : String(err);
		return Response.json({ error: 'upload_failed', error_description: description }, { status: 502 });
	}

	const userContent: AnthropicContentBlock[] = [];
	if (messageText.trim().length > 0) {
		userContent.push({ type: 'text', text: messageText });
	}
	for (const u of uploaded) {
		const absoluteUrl = `${origin}${u.url}`;
		userContent.push({
			type: 'text',
			text:
				`[Imagen adjunta por el usuario — YA subida a la biblioteca de medios, no la vuelvas a subir] ` +
				`key=${u.key} url=${absoluteUrl} ancho=${u.width} alto=${u.height} ratio=${u.ratio}` +
				(u.deduped ? ' (bytes idénticos a un archivo ya existente, reutilizado)' : '')
		});
		if (u.mime.startsWith('image/')) {
			userContent.push({ type: 'image', source: { type: 'url', url: absoluteUrl } });
		}
	}

	try {
		const result = await runChatTurn({
			conversationId: conversation.id,
			userContent,
			ctx: { clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope, origin }
		});
		return Response.json({
			conversationId: conversation.id,
			assistantText: result.assistantText,
			budgetBlocked: result.budgetBlocked,
			messages: result.newRows.map(serializeRow),
			attachments: uploaded
		});
	} catch (err) {
		// These three messages are what the browser shows verbatim in the
		// chat's error banner (see +page.svelte's `chatError`) — always
		// Spanish, never `err.message` directly (that's an internal,
		// English, developer-facing string; see the two error classes'
		// own JSDoc in anthropic-client.ts).
		if (err instanceof MissingApiKeyError) {
			return Response.json(
				{
					error: 'not_configured',
					error_description:
						'El chat todavía no está configurado en este sitio (falta la clave de Anthropic). El resto ' +
						'del sitio funciona con normalidad — avisale a quien administra el sitio.'
				},
				{ status: 503 }
			);
		}
		if (err instanceof AnthropicApiError) {
			return Response.json(
				{
					error: 'anthropic_error',
					error_description:
						'Hubo un problema al consultar a Claude. Probá de nuevo en un momento; si sigue pasando, ' +
						'avisale a quien administra el sitio.'
				},
				{ status: 502 }
			);
		}
		return Response.json(
			{
				error: 'internal_error',
				error_description: 'Ocurrió un error inesperado. Probá de nuevo en un momento.'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;

	const conversation = await getConversationForClient(auth.clientId);
	const messages = conversation ? await listMessages(conversation.id) : [];
	return Response.json({
		conversation: conversation && {
			id: conversation.id,
			title: conversation.title,
			createdAt: conversation.createdAt.toISOString(),
			updatedAt: conversation.updatedAt.toISOString()
		},
		messages: messages.map(serializeRow)
	});
};

/** "Borrar conversación": deletes the site's one conversation and every message in it. A no-op (still `{ok:true}`) if there is nothing to delete yet. */
export const DELETE: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;

	const conversation = await getConversationForClient(auth.clientId);
	if (conversation) await deleteConversation(conversation.id);
	return Response.json({ ok: true });
};
