/**
 * Lane B9 — tools that exist ONLY for the panel's chat loop
 * (`agent.ts`/`tools-bridge.ts`), never registered in `mcp/tools/index.ts`
 * and never visible to `/api/mcp`'s external OAuth clients (Claude Desktop,
 * ChatGPT). They don't fit the general MCP tool registry: "is there
 * something to undo, for the site's ONE change-approval flow" is a concept
 * specific to this panel's own UI, not something an external content client
 * should ever see or call.
 *
 * ── Why this exists: reachable Deshacer without a persistent bar ────────
 * Lane B9's brief: once the pinned bar clears after Aprobar (see
 * `open-change-set.ts`'s header), Deshacer must still be reachable — but
 * only by the OWNER asking in chat and then clicking a button the agent
 * offers, never by the model acting on its own. The model itself has no
 * tool that can run an undo (`restorePublishedSnapshot` in
 * `mcp/tools/publish.ts` is deliberately not a tool at all — see that
 * function's own header) — this tool is read-only by construction: it can
 * only ever REPORT whether `last_published` (`pending-changes.ts`) has
 * something in it, never touch it. `agent.ts` turns a successful, "available"
 * result from this tool into an `offerUndo` flag on the `tool_result` SSE
 * event; `ChatPanel.svelte` renders that as a clickable "Deshacer" action
 * inside the assistant's own bubble, which — when clicked — calls the
 * EXISTING `POST /api/chat/undo` endpoint directly (the same one the old
 * persistent bar's Deshacer button called), authenticated the same way,
 * never something this tool call itself performs.
 */

import { getLastPublished } from './pending-changes';
import { textResult, type ToolResult } from '../mcp/types';

export interface ChatOnlyToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/** Takes the conversation id directly (not a full `ToolContext` — these tools don't touch entries/scope, only this conversation's own `last_published` slot) rather than widening the shared `ToolContext` type every other tool handler receives. */
	handler: (args: Record<string, unknown>, conversationId: string) => Promise<ToolResult>;
}

export const offerUndoLastChangeTool: ChatOnlyToolDefinition = {
	name: 'offer_undo_last_change',
	description:
		"Checks whether the site's most recent approved change (Aprobar) can still be undone, and if so, what it " +
		'was. Call this when the person asks to undo/revert/roll back the last change (e.g. "deshacé el último ' +
		'cambio", "revertí lo que acabo de aprobar"). This tool NEVER performs the undo itself — it only reports ' +
		'availability. If `available` is true, the system automatically shows the person a clickable undo button ' +
		"attached to your reply — just say what would be undone in one short sentence and that they can click it " +
		'there; do not describe it as already done, and do not try to call any other tool to perform the undo. If ' +
		'`available` is false, say plainly that there is nothing to undo right now (nothing has been approved yet, ' +
		'or it was already undone) — never mention scopes, permissions, or logging in anywhere else.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	handler: async (_args, conversationId) => {
		const lastPublished = await getLastPublished(conversationId);
		if (!lastPublished || lastPublished.entries.length === 0) {
			return textResult({ available: false });
		}
		return textResult({
			available: true,
			entries: lastPublished.entries.map((e) => ({ label: e.label, summary: e.summary })),
			publishedAt: lastPublished.publishedAt
		});
	}
};

export const CHAT_ONLY_TOOLS: Record<string, ChatOnlyToolDefinition> = {
	[offerUndoLastChangeTool.name]: offerUndoLastChangeTool
};
