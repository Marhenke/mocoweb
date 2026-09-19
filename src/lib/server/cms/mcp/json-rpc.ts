/**
 * Minimal JSON-RPC 2.0 envelope types and builders for the MCP endpoint.
 *
 * Hand-rolled rather than pulling in `@modelcontextprotocol/sdk`: that SDK's
 * HTTP transport is written against Node's `http.IncomingMessage` /
 * `http.ServerResponse`, and SvelteKit hands every endpoint a Web-standard
 * `Request`/`Response` pair instead — the two don't line up without a
 * bridging shim (either a compatibility adapter in front of the SDK, or a
 * fake req/res pair behind it). This server only exposes tools (no
 * resources, no prompts, no sampling, no SSE push), so the actual protocol
 * surface is `initialize` / `notifications/initialized` / `tools/list` /
 * `tools/call` plus a couple of transport-level rules — small enough that
 * implementing it directly against `Request`/`Response` is less code and
 * less risk than writing and maintaining a Node req/res shim just to keep
 * the SDK happy. See `src/routes/api/mcp/+server.ts` for the transport glue
 * and its doc comment for the version/transport decision in full.
 */

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return v.jsonrpc === '2.0' && typeof v.method === 'string';
}

/** True for a JSON-RPC *notification*: no `id`, so the caller expects no response body. */
export function isNotification(req: JsonRpcRequest): boolean {
	return req.id === undefined;
}

export interface JsonRpcError {
	jsonrpc: '2.0';
	id: string | number | null;
	error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcSuccess {
	jsonrpc: '2.0';
	id: string | number | null;
	result: unknown;
}

export const JSON_RPC_ERROR_CODES = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603
} as const;

export function rpcError(
	id: string | number | null,
	code: number,
	message: string,
	data?: unknown
): JsonRpcError {
	return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function rpcResult(id: string | number | null, result: unknown): JsonRpcSuccess {
	return { jsonrpc: '2.0', id, result };
}
