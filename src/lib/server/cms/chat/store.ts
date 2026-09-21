/**
 * Postgres-backed persistence for the admin chat (Lane B5) — conversations
 * survive a page reload or a fresh /admin login, per the brief. `content` on
 * a `chat_messages` row is stored in the exact shape the Anthropic Messages
 * API expects for one `{role, content}` entry (see `db/schema.ts`'s doc
 * comment on `chatMessages`), so `toMessageParam` below is a direct,
 * lossless round-trip — no reshaping needed to resend history to the model.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
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
	createdAt: Date;
}

export interface ChatConversationRow {
	id: string;
	clientId: string;
	title: string | null;
	createdAt: Date;
	updatedAt: Date;
}

function deriveTitle(firstUserText: string): string {
	const trimmed = firstUserText.trim().replace(/\s+/g, ' ');
	if (trimmed.length === 0) return 'Conversación';
	return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

export async function createConversation(clientId: string, firstUserText: string): Promise<ChatConversationRow> {
	const [row] = await db
		.insert(chatConversations)
		.values({ clientId, title: deriveTitle(firstUserText) })
		.returning();
	return row;
}

export async function getConversation(id: string): Promise<ChatConversationRow | null> {
	const rows = await db.select().from(chatConversations).where(eq(chatConversations.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function listConversations(clientId: string, limit = 50): Promise<ChatConversationRow[]> {
	return db
		.select()
		.from(chatConversations)
		.where(eq(chatConversations.clientId, clientId))
		.orderBy(desc(chatConversations.updatedAt))
		.limit(limit);
}

async function touchConversation(id: string): Promise<void> {
	await db.update(chatConversations).set({ updatedAt: new Date() }).where(eq(chatConversations.id, id));
}

export async function listMessages(conversationId: string): Promise<ChatMessageRow[]> {
	const rows = await db
		.select()
		.from(chatMessages)
		.where(eq(chatMessages.conversationId, conversationId))
		.orderBy(asc(chatMessages.createdAt));
	return rows.map((r) => ({ ...r, role: r.role as ChatRole, content: r.content as ChatContentBlock[] }));
}

export async function appendMessage(params: {
	conversationId: string;
	role: ChatRole;
	content: ChatContentBlock[];
	inputTokens?: number | null;
	outputTokens?: number | null;
	costUsd?: number | null;
	budgetBlocked?: boolean;
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
			budgetBlocked: params.budgetBlocked ?? false
		})
		.returning();
	await touchConversation(params.conversationId);
	return { ...row, role: row.role as ChatRole, content: row.content as ChatContentBlock[] };
}

/** True if `conversationId` belongs to `clientId` — the one authorization check this store needs, since a conversation is scoped to the panel's own OAuth client, not a person. */
export async function conversationBelongsToClient(conversationId: string, clientId: string): Promise<boolean> {
	const rows = await db
		.select({ id: chatConversations.id })
		.from(chatConversations)
		.where(and(eq(chatConversations.id, conversationId), eq(chatConversations.clientId, clientId)))
		.limit(1);
	return rows.length > 0;
}

/** Anthropic Messages API `{role, content}` param, straight from a stored row. */
export function toMessageParam(row: ChatMessageRow): { role: ChatRole; content: ChatContentBlock[] } {
	return { role: row.role, content: row.content };
}
