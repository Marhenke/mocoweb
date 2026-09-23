/**
 * Shared client-side chat types (Lane B6) — the shape `ChatPanel.svelte`
 * builds from `/api/chat`'s history (GET) and its SSE stream (POST), and
 * that every other component under `$lib/admin/chat/` renders from. Kept
 * separate from the server's own `ChatMessageRow` (`chat/store.ts`): this is
 * a UI-flattened view (one bubble per row, tool status resolved live), not a
 * database row.
 */

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolActivity {
	id: string;
	name: string;
	label: string;
	status: ToolStatus;
	/** Lane B9 — true when this was a successful `offer_undo_last_change` call reporting something IS undoable. Drives the inline "Deshacer" button on the bubble that made this call — see `ChatPanel.svelte`'s `tool_result` handling. */
	offerUndo?: boolean;
}

export interface ChangeCardPage {
	pattern: string;
	label: string;
	previewUrl: string | null;
}
export interface ChangeCardEntry {
	collection: string;
	slug: string | null;
	label: string;
	isNew: boolean;
	isDeletion: boolean;
	/** One short, plain-language line naming what changed, e.g. "se agregó 1 imagen a la galería" — see `$lib/server/cms/chat/change-card.ts`'s header for why this replaced a field-by-field diff (Lane B8). */
	summary: string;
	pages: ChangeCardPage[];
}
/**
 * Lane B7, redesigned in Lane B8 — the site's ONE open change set. No
 * longer attached to a message (see `$lib/server/cms/chat/pending-
 * changes.ts`'s header) — rendered as a persistent pinned bar
 * (`PendingChangeBar.svelte`), never inside the message thread.
 */
export interface ChangeCard {
	status: 'pending' | 'published';
	entries: ChangeCardEntry[];
	publishedAt?: string;
}

export interface ChatBubble {
	/** The real row id once known; a client-generated temp id for an optimistic send that hasn't been confirmed yet. */
	id: string;
	role: 'user' | 'assistant';
	text: string;
	/** Tool calls that happened as part of producing this bubble, in order — looked up live against `ChatPanel`'s shared `tools` map so a status update (running → done/error) is visible even after this bubble's own content finalized. */
	toolIds: string[];
	images: { url: string; alt: string }[];
	budgetBlocked: boolean;
	stopped: boolean;
	createdAt: string;
	/** True while still receiving text_delta events for this exact bubble — drives the blinking cursor / "still typing" affordance. */
	streaming: boolean;
	/** True for an optimistic user bubble not yet confirmed by the server (no real id yet). */
	pending: boolean;
	/** True if the optimistic send failed outright (network error before any SSE frame arrived) — shows a retry action instead of just sitting there. */
	failed: boolean;
}

export interface PendingAttachment {
	id: string;
	file: File;
	previewUrl: string | null;
	status: 'ready' | 'uploading' | 'done' | 'error';
	errorMessage: string | null;
}
