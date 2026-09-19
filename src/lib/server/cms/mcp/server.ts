/**
 * JSON-RPC method dispatch for the MCP endpoint. Transport-agnostic: takes a
 * parsed `JsonRpcRequest` and an already-resolved auth context (or null for
 * methods that don't need one resolved yet), returns the body to send back.
 * See `src/routes/api/mcp/+server.ts` for the HTTP glue and the transport
 * decision.
 *
 * Protocol target: MCP **2025-11-25** — the most recent "legacy" (classic
 * `initialize` handshake) revision. As of this writing the spec has moved on
 * to a `2026-07-28` "modern" revision that replaces the handshake with
 * per-request protocol negotiation and a mandatory `server/discover` method;
 * see this file's sibling doc comment in `+server.ts` for why that isn't
 * what's implemented here.
 */

import { getTool, allTools } from './tools/index';
import type { ToolContext } from './types';
import type { Scope } from '../auth/scope';
import { rpcError, rpcResult, JSON_RPC_ERROR_CODES, type JsonRpcRequest } from './json-rpc';

export const PROTOCOL_VERSION = '2025-11-25';

const SERVER_INFO = { name: 'mocoweb-cms', title: 'Moco CMS', version: '0.1.0' };

const SERVER_INSTRUCTIONS =
	'This MCP server operates a content-managed website with no admin panel — these tools are the only way to ' +
	'read or change its content. Start with get_site_map to see every route and which collection governs each ' +
	"content region, then describe_collection(key) for that region's full schema (its field descriptions carry " +
	'rules a type alone cannot express — read them) before calling list_entries/get_entry or writing. All writes ' +
	'land in a draft (`data`); nothing you do here changes what visitors currently see (`published_data`) — ' +
	'publishing is a separate, not-yet-available step.';

export interface DispatchResult {
	/** Response body to send. null means "no body" (a notification: HTTP 202/204). */
	body: unknown | null;
	status: number;
}

/** The scope a request needs, resolvable before auth so tools/call can be checked per-tool. */
export function requiredScopeFor(req: JsonRpcRequest): Scope {
	if (req.method === 'tools/call') {
		const name = typeof req.params?.name === 'string' ? req.params.name : '';
		return getTool(name)?.scope ?? 'read';
	}
	return 'read';
}

export async function dispatch(
	req: JsonRpcRequest,
	ctx: ToolContext | null
): Promise<DispatchResult> {
	const id = req.id ?? null;
	const isNotification = req.id === undefined;

	switch (req.method) {
		case 'initialize': {
			const result = {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
				instructions: SERVER_INSTRUCTIONS
			};
			return { body: rpcResult(id, result), status: 200 };
		}

		case 'notifications/initialized':
		case 'notifications/cancelled':
			// Notifications never get a response body; the transport returns 202.
			return { body: null, status: 202 };

		case 'ping':
			return { body: rpcResult(id, {}), status: 200 };

		case 'tools/list': {
			const tools = allTools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema
			}));
			return { body: rpcResult(id, { tools }), status: 200 };
		}

		case 'tools/call': {
			const params = req.params ?? {};
			const name = typeof params.name === 'string' ? params.name : '';
			const tool = getTool(name);
			if (!tool) {
				return {
					body: rpcError(
						id,
						JSON_RPC_ERROR_CODES.INVALID_PARAMS,
						`Unknown tool "${name}". Call tools/list to see available tools.`
					),
					status: 200
				};
			}
			if (!ctx) {
				return {
					body: rpcError(
						id,
						JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
						'No auth context was resolved for this call.'
					),
					status: 200
				};
			}
			const rawArgs = params.arguments;
			const args =
				rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
					? (rawArgs as Record<string, unknown>)
					: {};
			try {
				const result = await tool.handler(args, ctx);
				return { body: rpcResult(id, result), status: 200 };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					body: rpcResult(id, {
						content: [{ type: 'text', text: `Internal error running "${name}": ${message}` }],
						isError: true
					}),
					status: 200
				};
			}
		}

		default:
			if (isNotification) return { body: null, status: 202 };
			return {
				body: rpcError(
					id,
					JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
					`Unknown method "${req.method}".`
				),
				status: 200
			};
	}
}
