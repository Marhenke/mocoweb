/**
 * Postgres-backed persistence for the admin chat (Lane B5) — conversations
 * survive a page reload or a fresh /admin login, per the brief. `content` on
 * a `chat_messages` row is stored in the exact shape the Anthropic Messages
 * API expects for one `{role, content}` entry (see `db/schema.ts`'s doc
 * comment on `chatMessages`), so `toMessageParam` below is a direct,
 * lossless round-trip — no reshaping needed to resend history to the model.
 *
 * ── One conversation per site (Lane B5 follow-up) ────────────────────────
 * The owner's own feedback after using the panel: there is exactly ONE
 * conversation for a site, not a list to pick between — `chat_conversations`
 * still exists as a table (dropping it would be a migration for no real
 * benefit: it already gives every message a stable `conversation_id` for
 * the FK/cascade-delete "Borrar conversación" needs), but
 * `getOrCreateSingletonConversation` is now the ONLY way callers get a
 * conversation id, and it always returns the SAME row for a given
 * `client_id` — creating one only the first time. `deleteConversation`
 * (backing "Borrar conversación") removes that row outright; `chat_messages`
 * cascades with it (see `db/schema.ts`), and the next message starts a
 * fresh row via the same function. There is no `listConversations` /
 * multi-conversation listing anymore — it was removed, not just unused, so
 * nothing in `routes/api/chat/+server.ts` or `routes/admin/+page.svelte`
 * can reintroduce a "pick a conversation" UI by calling it.
 */

import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chatConversations, chatMessages } from '../db/schema';

export type ChatRole = 'user' | 'assistant';

/** Matches Anthropic's content-block shape closely enough for our own storage/replay — never imports an SDK type, since this engine calls the API over plain fetch (see `anthropic-client.ts`). */
export type ChatContentBlock = Record<string, unknown>;

export interface ChatMessageRow {
	id: string;
	conversationId: string;
	role: ChatRole;
	content: ChatContentBlock[];
	inputTokens: number | null;
	outputTokens: number | null;
	costUsd: number | null;
	budgetBlocked: boolean;
	/** Lane B6 — true for a partial assistant reply persisted because the owner hit Stop mid-stream. See `db/schema.ts`'s column comment. */
	stopped: boolean;
	/** Lane B7 — the approve-this-preview card, when this row is the one currently showing it. See `chat/change-card.ts`. */
	changeCard: import('./change-card').ChangeCard | null;
	createdAt: Date;
}

export interface ChatConversationRow {
	id: string;
	clientId: string;
	title: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Returns the site's one conversation for `clientId`, creating it if this
 * is the very first message ever. If more than one row somehow exists
 * (e.g. left over from before this lane enforced a singleton), the most
 * recently active one is used — tolerant of old data, never errors.
 */
export async function getOrCreateSingletonConversation(clientId: string): Promise<ChatConversationRow> {
	const existing = await getConversationForClient(clientId);
	if (existing) return existing;

	const [row] = await db
		.insert(chatConversations)
		.values({ clientId, title: 'Conversación del sitio' })
		.returning();
	return row;
}

/** Read-only counterpart of `getOrCreateSingletonConversation` — used by GET/DELETE, which must never create an empty conversation just by being called. */
export async function getConversationForClient(clientId: string): Promise<ChatConversationRow | null> {
	const existing = await db
		.select()
		.from(chatConversations)
		.where(eq(chatConversations.clientId, clientId))
		.orderBy(desc(chatConversations.updatedAt))
		.limit(1);
	return existing[0] ?? null;
}

/** "Borrar conversación": removes the conversation row; every chat_messages row for it cascades away with it (db/schema.ts's onDelete: 'cascade'). */
export async function deleteConversation(id: string): Promise<void> {
	await db.delete(chatConversations).where(eq(chatConversations.id, id));
}

async function touchConversation(id: string): Promise<void> {
	await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, id));
}

export async function listMessages(conversationId: string): Promise<ChatMessageRow[]> {
	const rows = await db
		.select()
		.from(chatMessages)
		.where(eq(chatMessages.conversationId, conversationId))
		.orderBy(chatMessages.createdAt);
	return rows.map((r) => ({
		...r,
		role: r.role as ChatRole,
		content: r.content as ChatContentBlock[],
		changeCard: (r.changeCard as ChatMessageRow['changeCard']) ?? null
	}));
}

/** Reads one message row by id — used to check whether a card's target message still exists before relocating/updating it. */
export async function getMessageById(id: string): Promise<ChatMessageRow | null> {
	const rows = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);
	const r = rows[0];
	if (!r) return null;
	return { ...r, role: r.role as ChatRole, content: r.content as ChatContentBlock[], changeCard: (r.changeCard as ChatMessageRow['changeCard']) ?? null };
}

/** Sets (or clears, with `null`) the change card shown on one message row — used by `chat/agent.ts` (attaching/relocating a card each turn) and the approve/discard/undo endpoints (freezing the card's final state). */
export async function setChangeCard(id: string, card: ChatMessageRow['changeCard']): Promise<ChatMessageRow | null> {
	const rows = await db.update(chatMessages).set({ changeCard: card }).where(eq(chatMessages.id, id)).returning();
	const r = rows[0];
	if (!r) return null;
	return { ...r, role: r.role as ChatRole, content: r.content as ChatContentBlock[], changeCard: (r.changeCard as ChatMessageRow['changeCard']) ?? null };
}

export async function appendMessage(params: {
	conversationId: string;
	role: ChatRole;
	content: ChatContentBlock[];
	inputTokens?: number | null;
	outputTokens?: number | null;
	costUsd?: number | null;
	budgetBlocked?: boolean;
	stopped?: boolean;
}): Promise<ChatMessageRow> {
	const [row] = await db
		.insert(chatMessages)
		.values({
			conversationId: params.conversationId,
			role: params.role,
			content: params.content,
			inputTokens: params.inputTokens ?? null,
			outputTokens: params.outputTokens ?? null,
			costUsd: params.costUsd ?? null,
			budgetBlocked: params.budgetBlocked ?? false,
			stopped: params.stopped ?? false
		})
		.returning();
	await touchConversation(params.conversationId);
	return {
		...row,
		role: row.role as ChatRole,
		content: row.content as ChatContentBlock[],
		changeCard: (row.changeCard as ChatMessageRow['changeCard']) ?? null
	};
}

/** Anthropic Messages API `{role, content}` param, straight from a stored row. */
export function toMessageParam(row: ChatMessageRow): { role: ChatRole; content: ChatContentBlock[] } {
	return { role: row.role, content: row.content };
}
