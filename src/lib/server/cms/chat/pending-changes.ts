/**
 * The site's one "open change set" (Lane B7, redesigned in Lane B8) — which
 * draft entries the panel agent has touched since the last Aprobar/
 * Descartar (`pendingChange`), and, separately, what was most recently
 * approved-and-not-yet-undone (`lastPublished`, for "Deshacer"). See
 * `change-card.ts` for what gets built FROM either of these, and
 * `chat/agent.ts` for where entries get ADDED to the pending set (right
 * after a successful create_entry/update_entry/delete_entry tool call).
 *
 * ── Lane B8: no message ties to a change set anymore ─────────────────────
 * The B7 shape also stored `cardMessageId` — which `chat_messages` row
 * currently rendered the card — because the card used to be a message
 * bubble. The owner's own feedback: an old card could sit in the thread
 * next to a later, unrelated question, and it must be impossible to have
 * more than one open at a time. The fix removes the message tie entirely:
 * there is exactly one persistent, pinned change-set indicator
 * (`PendingChangeBar.svelte`), never a message, so there is nothing here to
 * point at a row anymore — just the plain list of touched entries (and,
 * separately, the last-published snapshot for Deshacer). Both are plain
 * columns on `chat_conversations` (this whole app has exactly one
 * conversation per site — see `chat/store.ts`'s header), so both survive a
 * reload/re-login by construction, same as everything else read back from
 * that row.
 *
 * A plain read-modify-write, not a transaction: the admin chat is
 * single-owner (one bearer token holder at a time in practice) and a lost
 * update here would at worst mean an entry falls out of the pending set a
 * turn late, never data loss on the entry itself (that's still governed by
 * the entries table's own writes).
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { chatConversations } from '../db/schema';
import type { PendingEntryRef, ChangeCardEntry } from './change-card';

export interface PendingChangeState {
	entries: PendingEntryRef[];
}

/** What "Deshacer" acts on — a frozen snapshot of the last successful Aprobar, built once at approval time (unlike the pending set, which is rebuilt live). Null once Deshacer runs, or if nothing has ever been approved. */
export interface LastPublishedState {
	entries: ChangeCardEntry[];
	publishedAt: string;
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
	return { entries: value.entries };
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
	await setPendingChange(conversationId, { entries: merged });
	return merged;
}

/** Clears the pending set entirely (Aprobar/Descartar, once every entry in it has been resolved). */
export async function clearPendingChange(conversationId: string): Promise<void> {
	await setPendingChange(conversationId, null);
}

/**
 * Replaces the pending set with exactly `refs` (used by approve when only
 * SOME entries in the set could be resolved — the ones that succeeded are
 * removed, the ones that failed stay pending).
 */
export async function setPendingEntries(conversationId: string, refs: PendingEntryRef[]): Promise<void> {
	if (refs.length === 0) {
		await clearPendingChange(conversationId);
		return;
	}
	await setPendingChange(conversationId, { entries: refs });
}

// ---------------------------------------------------------------------------
// Last-published snapshot — Lane B8, "Deshacer" without losing the work
// ---------------------------------------------------------------------------

export async function getLastPublished(conversationId: string): Promise<LastPublishedState | null> {
	const rows = await db
		.select({ lastPublished: chatConversations.lastPublished })
		.from(chatConversations)
		.where(eq(chatConversations.id, conversationId))
		.limit(1);
	const value = rows[0]?.lastPublished as LastPublishedState | null | undefined;
	if (!value || !Array.isArray(value.entries)) return null;
	return value;
}

export async function setLastPublished(conversationId: string, state: LastPublishedState | null): Promise<void> {
	await db
		.update(chatConversations)
		.set({ lastPublished: state })
		.where(eq(chatConversations.id, conversationId));
}
