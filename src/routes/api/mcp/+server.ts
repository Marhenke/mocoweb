/**
 * The MCP endpoint (Lane A7). This is the only way an agent operates the
 * site: `initialize` → `notifications/initialized` → `tools/list` →
 * `tools/call`, over a single POST endpoint, guarded by A6's `requireAuth`.
 *
 * ── Protocol version ─────────────────────────────────────────────────────
 * Targets MCP **2025-11-25**, the most recent revision that still uses the
 * classic `initialize` handshake ("legacy", in the spec's own terminology).
 * The spec has since moved to a `2026-07-28` "modern" revision that drops
 * the handshake for per-request version negotiation (`_meta`, a mandatory
 * `server/discover` method, `UnsupportedProtocolVersionError`, etc). That
 * revision is brand new; nothing suggests real MCP clients speak it yet, and
 * this lane's brief explicitly asks for `initialize → tools/list →
 * tools/call` to be demonstrated end-to-end, which is exactly the legacy
 * shape. Building the stateless modern negotiation on top of a tools-only
 * server would be a substantial, separately-scoped piece of work for a
 * client population of ~zero today — flagging this as a deliberate,
 * revisit-later choice rather than an oversight.
 *
 * ── Transport ────────────────────────────────────────────────────────────
 * Streamable HTTP (the current standard transport), but responding with a
 * single `application/json` body rather than opening an SSE stream — the
 * spec explicitly allows either for a POST'ed request, and this server never
 * needs to push a message before its one response (no sampling, no
 * server-initiated requests, no resumable streams). No `Mcp-Session-Id` is
 * issued either: session management is optional ("MAY") and this server is
 * intentionally stateless between calls — every JSON-RPC call already
 * carries its own bearer token, so there is nothing a session would add.
 *
 * ── Why hand-rolled JSON-RPC instead of `@modelcontextprotocol/sdk` ───────
 * The SDK's HTTP transport is written against Node's `http.IncomingMessage`/
 * `ServerResponse`; SvelteKit endpoints receive/return Web `Request`/
 * `Response`. Bridging that mismatch means either wrapping the SDK behind a
 * req/res shim, or adopting a whole extra HTTP layer inside a SvelteKit app
 * that already has one. This server exposes tools only (no resources, no
 * prompts, no sampling) — the entire protocol surface handled below is
 * `initialize`, one notification, `tools/list`, and `tools/call`, which is
 * a couple hundred lines against plain `Request`/`Response` (see
 * `../../../lib/server/cms/mcp/server.ts`). That was less code and less
 * risk than writing and maintaining a compatibility shim just to keep using
 * the SDK, so this lane implements the JSON-RPC handling directly.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────
 * Every request needs at least "read" scope (so a request with no/invalid
 * token gets 401 even for `initialize` — the endpoint is a protected
 * resource per A6's OAuth metadata, full stop). A `tools/call` is checked
 * again against that specific tool's own required scope (`read` or
 * `write`) — a read-scoped token calling a write tool gets a 403 with a
 * `WWW-Authenticate` header naming exactly which scope was required, from
 * the same `requireAuth` used everywhere else in this codebase.
 */

import { requireAuth } from '$lib/server/cms/auth/require-auth';
import { dispatch, requiredScopeFor } from '$lib/server/cms/mcp/server';
import { isJsonRpcRequest, type JsonRpcRequest } from '$lib/server/cms/mcp/json-rpc';
import type { RequestHandler } from './$types';

function jsonRpcParseError(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			id: null,
			error: {
				code: -32700,
				message: 'Parse error: request body must be a single JSON-RPC 2.0 object.'
			}
		}),
		{ status: 400, headers: { 'Content-Type': 'application/json' } }
	);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonRpcParseError();
	}

	if (Array.isArray(body)) {
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				error: {
					code: -32600,
					message:
						'JSON-RPC batching is not supported (removed from MCP as of 2025-06-18); send one request per HTTP call.'
				}
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	if (!isJsonRpcRequest(body)) {
		return jsonRpcParseError();
	}
	const req = body as JsonRpcRequest;

	// Every request needs at least "read"; tools/call is re-checked against
	// its specific tool's own scope below.
	const scope = requiredScopeFor(req);
	const auth = await requireAuth(request, scope);
	if (auth instanceof Response) return auth;

	const result = await dispatch(req, {
		clientId: auth.clientId,
		clientName: auth.clientName,
		scope: auth.scope,
		origin: new URL(request.url).origin
	});

	if (result.body === null) {
		// A notification: the transport spec requires 202 Accepted, no body.
		return new Response(null, { status: 202, headers: { 'MCP-Protocol-Version': '2025-11-25' } });
	}

	return new Response(JSON.stringify(result.body), {
		status: result.status,
		headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' }
	});
};

// This server never pushes server-initiated messages, so it offers no SSE
// stream on GET — per the Streamable HTTP spec, that's declared with 405.
export const GET: RequestHandler = async () => {
	return new Response('This MCP server does not support server-initiated SSE streams; use POST.', {
		status: 405,
		headers: { Allow: 'POST' }
	});
};
