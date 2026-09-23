/**
 * Lane B8, narrowed in Lane B9 — resolves what the site's ONE persistent
 * pinned bar should show right now, for a given conversation: the
 * live-rebuilt pending set if anything is pending, else null (bar absent).
 * Shared by `routes/api/chat/+server.ts` (GET, so a reload/re-login sees the
 * same bar) and the three approve/discard/undo endpoints (so every action's
 * response tells the browser exactly what to show next, without a second
 * round trip).
 *
 * ── Lane B9: the bar is for OPEN work only ───────────────────────────────
 * The B8 version also fell back to a frozen "published, still undoable"
 * card (`getLastPublished`) whenever nothing was pending, so the bar kept
 * showing "Publicado ✓ · Ver preview · Deshacer" — indefinitely, with no
 * way to dismiss it short of clicking Deshacer — after every single Aprobar,
 * permanently occupying the screen above the composer while the owner tried
 * to keep chatting. The owner's own feedback after testing in production:
 * the bar has to clear once there's nothing left to approve or discard.
 * `last_published` (see `pending-changes.ts`) still exists and is still
 * written by `routes/api/chat/approve` — it's just no longer surfaced
 * through THIS function/the persistent bar. It now backs two things
 * instead: (1) a brief, self-dismissing confirmation toast the browser
 * shows for itself right after a successful Aprobar
 * (`ChatPanel.svelte`'s `approvalToast`), entirely client-side, never a
 * second render of this card; (2) the new `offer_undo_last_change` chat-only
 * tool (`chat-only-tools.ts`), which the model calls when the owner asks in
 * chat to undo the last change — it reports whether one exists and lets the
 * OWNER click a button to actually run it (`routes/api/chat/undo`, unchanged
 * — still the only thing that touches production here).
 */

import { buildChangeCard, type ChangeCard } from './change-card';
import { getPendingChange } from './pending-changes';

export async function getOpenChangeSet(conversationId: string, origin: string): Promise<ChangeCard | null> {
	const pending = await getPendingChange(conversationId);
	if (pending && pending.entries.length > 0) {
		return buildChangeCard(origin, pending.entries);
	}
	return null;
}
