/**
 * The conversation-level "pending change set" (Lane B7) — which draft
 * entries the panel agent has touched since the last Aprobar/Descartar, and
 * which `chat_messages` row currently shows the change card for them. See
 * `change-card.ts` for what gets built FROM this, and `chat/agent.ts` for
 * where entries get ADDED to it (right after a successful create_entry/
 * update_entry/delete_entry tool call).
 *
 * Stored on `chat_conversations.pending_change` (one row, since this whole
 * app has exactly one conversation per site — see `chat/store.ts`'s
 * header). A plain read-modify-write, not a transaction: the admin chat is
 * single-owner (one bearer token holder at a time in practice) and a lost
 * update here would at worst mean an entry falls out of the pending set a
 * turn late, never data loss on the entry itself (that's still governed by
 * the entries table's own writes).
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chatConversations, chatMessages } from '../db/schema';
import type { PendingEntryRef } from './change-card';

export interface PendingChangeState {
	cardMessageId: string | null;
	entries: PendingEntryRef[];
}

function refKey(ref: PendingEntryRef): string {
	return `${ref.collection}::${ref.slug ?? ''}`;
}

export async function getPendingChange(conversationId: string): Promise<PendingChangeState | null> {
	const rows = await db
		.select({ pendingChange: chatConversations.pendingChange })
		.from(chatConversations)
		.where(eq(chatConversations.id, conversationId))
		.limit(1);
	const value = rows[0]?.pendingChange as PendingChangeState | null | undefined;
	if (!value || !Array.isArray(value.entries)) return null;
	return { cardMessageId: value.cardMessageId ?? null, entries: value.entries };
}

async function setPendingChange(conversationId: string, state: PendingChangeState | null): Promise<void> {
	await db
		.update(chatConversations)
		.set({ pendingChange: state })
		.where(eq(chatConversations.id, conversationId));
}

/**
 * Merges `refs` into the conversation's pending set (deduped by
 * collection+slug) and returns the full merged list. Never removes an
 * existing entry — only Aprobar/Descartar clear the set (see
 * `routes/api/chat/approve`/`discard`).
 */
export async function addPendingEntries(
	conversationId: string,
	refs: PendingEntryRef[]
): Promise<PendingEntryRef[]> {
	if (refs.length === 0) {
		const existing = await getPendingChange(conversationId);
		return existing?.entries ?? [];
	}
	const existing = await getPendingChange(conversationId);
	const byKey = new Map<string, PendingEntryRef>();
	for (const r of existing?.entries ?? []) byKey.set(refKey(r), r);
	for (const r of refs) byKey.set(refKey(r), r);
	const merged = [...byKey.values()];
	await setPendingChange(conversationId, { cardMessageId: existing?.cardMessageId ?? null, entries: merged });
	return merged;
}

/**
 * Points the pending set at a (new) card message, clearing `change_card` on
 * whatever message previously held it — this is what keeps "one card, not
 * stacked" true turn over turn: the card visually relocates to the latest
 * assistant reply that touched something, rather than a second one
 * appearing. See `chat/agent.ts`'s call site.
 */
export async function relocateCard(
	conversationId: string,
	entries: PendingEntryRef[],
	newCardMessageId: string
): Promise<void> {
	const existing = await getPendingChange(conversationId);
	if (existing?.cardMessageId && existing.cardMessageId !== newCardMessageId) {
		await db
			.update(chatMessages)
			.set({ changeCard: null })
			.where(eq(chatMessages.id, existing.cardMessageId));
	}
	await setPendingChange(conversationId, { cardMessageId: newCardMessageId, entries });
}

/** Clears the pending set entirely (Aprobar/Descartar, once every entry in it has been resolved). Does NOT touch `change_card` on the card message — callers set that to its final ('published'/'discarded') state themselves before/after calling this. */
export async function clearPendingChange(conversationId: string): Promise<void> {
	await setPendingChange(conversationId, null);
}

/**
 * Replaces the pending set with exactly `refs` (used by approve/discard when
 * only SOME entries in the set could be resolved — the ones that succeeded
 * are removed, the ones that failed stay pending) — keeps the same
 * `cardMessageId` so the card doesn't relocate over a partial failure.
 */
export async function setPendingEntries(conversationId: string, refs: PendingEntryRef[]): Promise<void> {
	const existing = await getPendingChange(conversationId);
	if (refs.length === 0) {
		await clearPendingChange(conversationId);
		return;
	}
	await setPendingChange(conversationId, { cardMessageId: existing?.cardMessageId ?? null, entries: refs });
}
