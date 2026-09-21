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

export interface AnthropicResponse {
	id: string;
	role: 'assistant';
	/** The model that actually served this response — pass this, not the requested model, to `computeCostUsd`. */
	model: string;
	content: AnthropicContentBlock[];
	stop_reason: string | null;
	usage: AnthropicUsage;
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

export async function callClaude(params: {
	system: string;
	messages: AnthropicMessageParam[];
	tools: AnthropicToolDef[];
}): Promise<AnthropicResponse> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new MissingApiKeyError();

	const res = await fetch(messagesUrl(), {
		method: 'POST',
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
			tools: params.tools
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

	return (await res.json()) as AnthropicResponse;
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
