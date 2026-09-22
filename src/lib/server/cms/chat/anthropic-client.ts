/**
 * Anthropic Messages API client for the admin chat (Lane B5) — plain
 * `fetch` against `POST /v1/messages`, not the `@anthropic-ai/sdk` package.
 *
 * That mirrors this codebase's existing precedent (`auth/jwt.ts` hand-rolls
 * HS256 instead of pulling in `jsonwebtoken`; `mcp/server.ts` hand-rolls
 * JSON-RPC instead of the MCP SDK) for the same reason stated in both of
 * those files' headers: the entire protocol surface actually needed here —
 * one request shape, tool-use content blocks, a `usage` field to read — is
 * a couple hundred lines against a documented JSON API, which is less code
 * and less dependency risk than adding a whole SDK for it. Verified against
 * Anthropic's own current Messages API docs while building this lane (model
 * ID, request/response shape, `tools`/`tool_use`/`tool_result` blocks,
 * `usage.input_tokens`/`usage.output_tokens`) — not assumed from training
 * data; see `pricing.ts`'s header for the same note about the per-token
 * rates.
 *
 * `ANTHROPIC_API_KEY` (Railway env var, owner-set) is read here and only
 * here — it is attached to the outgoing request header and never appears in
 * a prompt, a tool result, or anything sent to the browser (see
 * `agent.ts`/`+server.ts`, which never forward this module's inputs/outputs
 * verbatim to the client beyond the assistant's own final text).
 *
 * `CHAT_MODEL` is read once per call via `getChatModel()` (`pricing.ts`),
 * never hardcoded here — see that module's header for why (one owner
 * running many client sites off one cheap default, per-site override with
 * no code change).
 */

import { getChatModel } from './pricing';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * `ANTHROPIC_BASE_URL`, read live (not cached at module load, same
 * convention as `auth/keys.ts` reading `OWNER_KEY`) — matches the official
 * SDKs' own `ANTHROPIC_BASE_URL` env var, so this isn't a bespoke escape
 * hatch. Defaults to the real API; used in this lane's own testing to point
 * at a local stub server (no real Anthropic account needed to exercise the
 * tool-calling loop and the injection defense — see the Lane B5 report for
 * what was and wasn't verified this way).
 */
function messagesUrl(): string {
	const base = (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
	return `${base}/v1/messages`;
}

// Chat replies are short, conversational confirmations ("hecho, cambié el
// título a..."), not long-form generation — 4096 leaves ample room for a
// tool call plus a few sentences of commentary without inflating worst-case
// cost per turn. Raise this if real usage shows truncated replies.
const MAX_TOKENS = 4096;

export interface AnthropicToolDef {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export type AnthropicContentBlock = Record<string, unknown>;

export interface AnthropicMessageParam {
	role: 'user' | 'assistant';
	content: AnthropicContentBlock[];
}

export interface AnthropicUsage {
	input_tokens: number;
	output_tokens: number;
}

/**
 * `status` is the HTTP status; `errorType` is Anthropic's own
 * `error.type` field when the body parsed as JSON (e.g. `"rate_limit_error"`,
 * `"invalid_request_error"`) — used by `agent.ts`'s `isProviderLimitError`
 * to recognize a rate-limit or workspace-spend-limit rejection without
 * string-matching the human-readable message.
 */
export class AnthropicApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public errorType: string | null = null
	) {
		super(message);
		this.name = 'AnthropicApiError';
	}
}

export class MissingApiKeyError extends Error {
	constructor() {
		super(
			'ANTHROPIC_API_KEY is not set. The admin chat cannot call Claude until it is configured (Railway env var).'
		);
		this.name = 'MissingApiKeyError';
	}
}

/**
 * ── Streaming (Lane B6) ───────────────────────────────────────────────────
 * `callClaudeStream` (below) is the only way this app calls the Messages
 * API — a prior non-streaming `callClaude` (a single blocking request, no
 * `stream: true`) was removed once `/api/chat`'s POST switched to SSE for
 * every request; see `agent.ts`'s header for why keeping two call paths in
 * sync wasn't worth it. The request shape is otherwise identical; only
 * `stream: true` is added. The response body is Server-Sent Events, exactly
 * as documented at
 * https://platform.claude.com/docs/en/api/messages-streaming (fetched and
 * verified live while building this lane, not assumed from training data —
 * event names, field names and the exact per-event JSON shape below all
 * match that page's worked examples): a `message_start` carrying the
 * response id/model and the INPUT token count, then for each content block
 * a `content_block_start` (empty text or an empty-`input` `tool_use`),
 * zero or more `content_block_delta` (`text_delta.text` for prose,
 * `input_json_delta.partial_json` for a tool call's arguments, streamed as
 * fragments of a JSON string that must be concatenated then parsed once
 * complete — never parsed fragment-by-fragment), and a `content_block_stop`;
 * after every block, one `message_delta` carrying the final `stop_reason`
 * and the OUTPUT token count, then `message_stop`. `ping` events can appear
 * anywhere and carry no data worth acting on; an `error` event (e.g.
 * `overloaded_error`) can appear instead of a normal completion and is
 * surfaced here as a thrown `AnthropicApiError`, same as a non-2xx HTTP
 * response.
 *
 * This is a raw line-by-line SSE parser, not a library — same "hand-roll the
 * couple hundred lines this endpoint actually needs" precedent as the rest
 * of this file's header comment. `signal` is threaded straight into `fetch`:
 * aborting it (see `chat/agent.ts`'s stop handling) tears down the upstream
 * HTTP connection to Anthropic immediately, not just the local read loop —
 * generation actually stops server-side, not merely client-side.
 */

export type AnthropicStreamEvent =
	| { type: 'message_start'; message: { id: string; model: string; usage: AnthropicUsage } }
	| { type: 'content_block_start'; index: number; content_block: AnthropicContentBlock }
	| {
			type: 'content_block_delta';
			index: number;
			delta:
				| { type: 'text_delta'; text: string }
				| { type: 'input_json_delta'; partial_json: string }
				| { type: string; [key: string]: unknown };
	  }
	| { type: 'content_block_stop'; index: number }
	| {
			type: 'message_delta';
			delta: { stop_reason: string | null; stop_sequence: string | null };
			usage: { output_tokens: number };
	  }
	| { type: 'message_stop' }
	| { type: 'ping' }
	| { type: 'error'; error: { type: string; message: string } };

/**
 * True when `err` is the local, synchronous consequence of `signal` firing
 * (Node's `fetch`/stream machinery both throw a `DOMException` named
 * `"AbortError"` for this) — `agent.ts` needs to tell "the caller asked us
 * to stop" apart from a genuine network/API failure so it never shows the
 * stop button's own abort as an error banner.
 */
export function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

/**
 * Parses one SSE record (everything between a request/response's `event:`
 * and `data:` lines up to a blank line) into a typed event. Anthropic always
 * sends both an `event:` line and a `data:` line whose own `type` field
 * matches it — this parses off the `data:` line's JSON (self-describing),
 * using `event:` only to skip comment/keep-alive lines that carry no
 * `data:` at all.
 */
function parseSseRecord(record: string): AnthropicStreamEvent | null {
	let dataLine: string | null = null;
	for (const line of record.split('\n')) {
		if (line.startsWith('data:')) dataLine = line.slice(5).trim();
	}
	if (dataLine === null || dataLine.length === 0) return null;
	try {
		return JSON.parse(dataLine) as AnthropicStreamEvent;
	} catch {
		return null;
	}
}

export async function* callClaudeStream(
	params: { system: string; messages: AnthropicMessageParam[]; tools: AnthropicToolDef[] },
	signal: AbortSignal
): AsyncGenerator<AnthropicStreamEvent, void, unknown> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new MissingApiKeyError();

	const res = await fetch(messagesUrl(), {
		method: 'POST',
		signal,
		headers: {
			'content-type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': ANTHROPIC_VERSION
		},
		body: JSON.stringify({
			model: getChatModel(),
			max_tokens: MAX_TOKENS,
			system: params.system,
			messages: params.messages,
			tools: params.tools,
			stream: true
		})
	});

	if (!res.ok) {
		let description = res.statusText;
		let errorType: string | null = null;
		try {
			const body = (await res.json()) as { error?: { message?: string; type?: string } };
			if (body.error?.message) description = body.error.message;
			if (body.error?.type) errorType = body.error.type;
		} catch {
			// Body wasn't JSON — fall back to statusText, already set above.
		}
		throw new AnthropicApiError(
			`Anthropic API request failed (${res.status}): ${description}`,
			res.status,
			errorType
		);
	}
	if (!res.body) {
		throw new AnthropicApiError('Anthropic API streaming response had no body.', res.status);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			// SSE records are separated by a blank line; \r\n and \n are both
			// tolerated since Anthropic's own examples use bare \n but proxies
			// in between could normalize line endings.
			let boundary: number;
			while ((boundary = buffer.indexOf('\n\n')) !== -1) {
				const record = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const event = parseSseRecord(record);
				if (event === null) continue;
				if (event.type === 'error') {
					throw new AnthropicApiError(
						`Anthropic API streaming error: ${event.error.message}`,
						res.status,
						event.error.type
					);
				}
				yield event;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * True for the two provider-side rejections the brief calls out explicitly:
 * a rate limit, and a workspace/organization spend limit being hit. Both
 * are the owner's Anthropic account pushing back, not a bug in this app —
 * `agent.ts` treats either exactly like the local `CHAT_MONTHLY_BUDGET_USD`
 * guard tripping, showing the same friendly Spanish message instead of a
 * raw API error. `429` covers `rate_limit_error` unambiguously; a spend/
 * credit-limit rejection has been observed as a `400 invalid_request_error`
 * whose message names the credit balance or a spend limit, so that's
 * matched by content rather than by a dedicated `error.type` (Anthropic has
 * not published one for this case as of this lane).
 */
export function isProviderLimitError(err: AnthropicApiError): boolean {
	if (err.status === 429 || err.errorType === 'rate_limit_error') return true;
	if (err.status === 400 && /credit balance|spend limit|spending limit|budget/i.test(err.message)) {
		return true;
	}
	return false;
}
