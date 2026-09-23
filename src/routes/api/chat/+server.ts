/**
 * The admin chat backend (Lane B5, streaming since Lane B6) — `/admin`'s
 * only server endpoint. Bearer-token authenticated exactly like `/api/mcp`
 * (same `requireAuth`, same access tokens minted by `/token`); there is no
 * cookie and no session here, consistent with why this whole engine's CSRF
 * guard is disabled (see `vite.config.ts`'s comment on `csrf.trustedOrigins`).
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
 *
 * ── Streaming (Lane B6) ───────────────────────────────────────────────────
 * POST now responds `Content-Type: text/event-stream` instead of one JSON
 * blob at the end — the brief requires token-by-token rendering, a typing
 * indicator, visible tool activity, and a working Stop button, none of
 * which are possible waiting on a single `await`. Attachments are still
 * uploaded synchronously BEFORE the stream opens (a real HTTP error status
 * — 400/502 — is still possible for that phase, exactly as before); once
 * the stream itself starts, every outcome (including "Anthropic isn't
 * configured" or a mid-turn API failure) becomes an SSE `error` frame
 * instead of an HTTP error status, because headers are already committed by
 * then. See `sseFrame` below for the wire format, and `$lib/admin/chat/sse.ts`
 * for the browser-side reader.
 *
 * Stop is `AbortSignal`-based, not a separate endpoint: the browser aborts
 * its own `fetch` to this route. That does NOT fire SvelteKit's
 * `request.signal` (verified empirically — see the long comment above
 * `abortController` below for why: that signal is for an aborted incoming
 * REQUEST body, not a disconnected outgoing response). Instead, this route
 * defines `cancel()` on the `ReadableStream` it returns — the lifecycle
 * method `@sveltejs/kit`'s own response-writing code calls when the
 * underlying HTTP response's `close`/`error` fires, in both `vite dev` and
 * the production `adapter-node` build — and aborts its OWN
 * `AbortController` from there, threaded through `runChatTurnStream` into
 * `callClaudeStream`'s own `fetch` to Anthropic (see `anthropic-client.ts`).
 * So stopping actually cancels the upstream generation, not just the local
 * read loop — verified locally against the stub server (see
 * `scripts/stub-anthropic-server.mjs`), which logs when its own request
 * socket closes early.
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
import { runChatTurnStream, type AgentStreamEvent } from '$lib/server/cms/chat/agent';
import { AnthropicApiError, MissingApiKeyError, type AnthropicContentBlock } from '$lib/server/cms/chat/anthropic-client';
import { getOpenChangeSet } from '$lib/server/cms/chat/open-change-set';
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
		stopped: row.stopped,
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

/** One SSE frame: `event: <name>\ndata: <json>\n\n` — the browser-side reader (`$lib/admin/chat/sse.ts`) parses this same shape it already knows from the Anthropic docs research done for `anthropic-client.ts`. */
function sseFrame(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;

	let body: unknown;
	try {
		body = await request.json();
	} catch (err) {
		// `request.json()` reads the underlying body stream, which is where
		// SvelteKit itself enforces `BODY_SIZE_LIMIT` (see
		// `@sveltejs/kit`'s `get_raw_body` / `@sveltejs/adapter-node`'s own
		// copy of it) — a request over that limit throws a `SvelteKitError`
		// with `.status === 413` from RIGHT HERE, not from a separate code
		// path. A base64-encoded photo is ~33% bigger than the file itself
		// plus JSON overhead, so this is the realistic failure mode for a
		// real photo attachment, not a hypothetical: verified locally by
		// posting a 700KB attachment against a production build with the
		// default 512K adapter-node limit and observing exactly this catch
		// fire. Previously this branch always answered the same generic,
		// English, misleading "Body must be JSON." regardless of cause —
		// the bug this lane's brief opens with. Distinguish the real cause
		// and answer in friendly Spanish either way; never the raw
		// exception text (see this file's header on error handling).
		const status = (err as { status?: number } | null)?.status;
		if (status === 413) {
			return Response.json(
				{
					error: 'payload_too_large',
					error_description:
						'La imagen (o el conjunto de archivos) pesa demasiado para enviarla de una. Probá con una ' +
						'imagen más liviana, o mandalas de a una por mensaje.'
				},
				{ status: 413 }
			);
		}
		console.error(
			JSON.stringify({
				at: 'api/chat:POST:parse-body',
				error: err instanceof Error ? (err.stack ?? err.message) : String(err)
			})
		);
		return Response.json(
			{
				error: 'invalid_request',
				error_description: 'No se pudo leer el mensaje enviado. Probá de nuevo.'
			},
			{ status: 400 }
		);
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
	// model sees this turn — see this file's header comment. This part is
	// still a normal request/response (not streamed): a failure here is a
	// real HTTP error, same as before Lane B6.
	const uploaded: { key: string; url: string; width: number; height: number; ratio: number; deduped: boolean; mime: string }[] = [];
	try {
		for (const att of attachmentInputs) {
			const bytes = Buffer.from(att.dataBase64, 'base64');
			if (bytes.length === 0) continue;
			const result = await uploadMedia({ bytes, filename: att.filename, mime: att.mime, alt: null });
			uploaded.push(result);
		}
	} catch (err) {
		// Never the raw `err.message` here (it's an internal, English,
		// developer-facing string, e.g. an S3/SeaweedFS client error) — log
		// it server-side and show a friendly Spanish message instead. See
		// this file's header ("No raw server error may ever reach the
		// chat").
		console.error(
			JSON.stringify({
				at: 'api/chat:POST:upload',
				error: err instanceof Error ? (err.stack ?? err.message) : String(err)
			})
		);
		return Response.json(
			{
				error: 'upload_failed',
				error_description:
					'No se pudo subir la imagen. Probá de nuevo en un momento; si sigue pasando, avisale a quien administra el sitio.'
			},
			{ status: 502 }
		);
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

	// ── Stop / disconnect detection ──────────────────────────────────────────
	// `request.signal` is NOT this: it only ever fires for an INCOMING request
	// whose BODY was aborted before it finished being read (see
	// `@sveltejs/kit`'s `getRequest` — `controller.abort()` there is gated on
	// `!end_emitted`) — by the time this handler runs, this POST's small JSON
	// body has always already finished reading, so `request.signal` can never
	// fire for what we actually care about: the browser dropping the
	// connection WHILE we're writing the (long-lived, streamed) response.
	// Verified empirically while building this lane: a client disconnecting
	// mid-stream left `request.signal.aborted` false and the turn ran to
	// completion server-side regardless — exactly the bug the brief warns
	// against ("Stop must actually abort... not just hide it").
	//
	// The correct signal is this `ReadableStream`'s own `cancel()` lifecycle
	// method: both `@sveltejs/adapter-node` (production) and the Vite dev
	// server (`vite dev`, what `dev.sh` runs) share the same response-writing
	// code (`@sveltejs/kit`'s `setResponse`), which listens for the
	// underlying Node response's `close`/`error` events and calls
	// `reader.cancel()` on exactly that condition — i.e. the client actually
	// disconnecting. Wiring `cancel` here to abort OUR OWN `AbortController`
	// (threaded into `runChatTurnStream` below) is what makes Stop tear down
	// the real upstream Anthropic connection, confirmed against the stub
	// server (see `scripts/stub-anthropic-server.mjs`), which logs when its
	// own request socket closes early.
	const abortController = new AbortController();

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;
			const safeEnqueue = (chunk: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// The browser already disconnected — `cancel()` below is what
					// actually stops the turn; a failed enqueue after that point is
					// expected, not a bug, and must never throw out of this
					// stream's `start`.
					closed = true;
				}
			};

			safeEnqueue(sseFrame('attachments', { attachments: uploaded }));

			try {
				const result = await runChatTurnStream({
					conversationId: conversation.id,
					userContent,
					ctx: { clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope, origin },
					signal: abortController.signal,
					onEvent: (event: AgentStreamEvent) => {
						switch (event.kind) {
							case 'user_message':
								safeEnqueue(sseFrame('user_message', { row: serializeRow(event.row) }));
								break;
							case 'text_delta':
								safeEnqueue(sseFrame('text_delta', { text: event.text }));
								break;
							case 'tool_start':
								safeEnqueue(sseFrame('tool_start', { id: event.id, name: event.name, label: event.label }));
								break;
							case 'tool_result':
								safeEnqueue(
									sseFrame('tool_result', {
										id: event.id,
										name: event.name,
										isError: event.isError,
										offerUndo: event.offerUndo ?? false
									})
								);
								break;
							case 'assistant_message':
								safeEnqueue(sseFrame('assistant_message', { row: serializeRow(event.row) }));
								break;
							case 'stopped':
								safeEnqueue(sseFrame('stopped', { row: serializeRow(event.row) }));
								break;
							case 'pending_change':
								safeEnqueue(sseFrame('pending_change', { card: event.card }));
								break;
						}
					}
				});
				safeEnqueue(
					sseFrame('done', {
						conversationId: conversation.id,
						assistantText: result.assistantText,
						budgetBlocked: result.budgetBlocked
					})
				);
			} catch (err) {
				// These three messages are what the browser shows verbatim in the
				// chat's error banner (see the Spanish copy below) — always
				// Spanish, never `err.message` directly (that's an internal,
				// English, developer-facing string; see the two error classes'
				// own JSDoc in anthropic-client.ts). Mirrors the pre-streaming
				// error handling exactly, just delivered as an SSE frame instead
				// of an HTTP status, since headers are already sent by now.
				if (err instanceof MissingApiKeyError) {
					safeEnqueue(
						sseFrame('error', {
							error: 'not_configured',
							error_description:
								'El chat todavía no está configurado en este sitio (falta la clave de Anthropic). El resto ' +
								'del sitio funciona con normalidad — avisale a quien administra el sitio.'
						})
					);
				} else if (err instanceof AnthropicApiError) {
					safeEnqueue(
						sseFrame('error', {
							error: 'anthropic_error',
							error_description:
								'Hubo un problema al consultar a Claude. Probá de nuevo en un momento; si sigue pasando, ' +
								'avisale a quien administra el sitio.'
						})
					);
				} else {
					console.error(
						JSON.stringify({
							at: 'api/chat:POST',
							error: err instanceof Error ? (err.stack ?? err.message) : String(err)
						})
					);
					safeEnqueue(
						sseFrame('error', {
							error: 'internal_error',
							error_description: 'Ocurrió un error inesperado. Probá de nuevo en un momento.'
						})
					);
				}
			} finally {
				closed = true;
				try {
					controller.close();
				} catch {
					// Already closed by the browser disconnecting — fine.
				}
			}
		},
		// The one piece that actually makes Stop work — see the comment above
		// `abortController`. `reason` is whatever `setResponse` in
		// `@sveltejs/kit` passes to `reader.cancel()` (an `Error`, possibly
		// undefined) when the underlying HTTP response's `close`/`error` fires;
		// not inspected here, just used to trigger our own abort.
		cancel(reason) {
			abortController.abort(reason);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};

export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;

	const origin = new URL(request.url).origin;
	const conversation = await getConversationForClient(auth.clientId);
	const messages = conversation ? await listMessages(conversation.id) : [];
	// Lane B8 — the persistent pinned bar has to reflect reality on every
	// reload/re-login, not just while a turn is streaming: it is rebuilt here
	// from the conversation's own state (pending set, or a still-undoable
	// last publish), never read off a message row (there is no message row
	// for it anymore — see `open-change-set.ts`).
	const pendingChange = conversation ? await getOpenChangeSet(conversation.id, origin) : null;
	return Response.json({
		conversation: conversation && {
			id: conversation.id,
			title: conversation.title,
			createdAt: conversation.createdAt.toISOString(),
			updatedAt: conversation.updatedAt.toISOString()
		},
		messages: messages.map(serializeRow),
		pendingChange
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
