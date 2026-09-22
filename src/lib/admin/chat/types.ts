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
}

export interface ChangeCardField {
	label: string;
	before: string;
	after: string;
}
export interface ChangeCardImage {
	url: string;
	alt: string;
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
	fields: ChangeCardField[];
	images: ChangeCardImage[];
	pages: ChangeCardPage[];
}
/** Lane B7 — "approve this preview" card. See `$lib/server/cms/chat/change-card.ts` (the server-side twin of this type) for the full design rationale. */
export interface ChangeCard {
	status: 'pending' | 'published' | 'discarded' | 'undone';
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
	/** Lane B7 — set only on the one assistant row currently showing the pending/published change card, if any. */
	changeCard: ChangeCard | null;
}

export interface PendingAttachment {
	id: string;
	file: File;
	previewUrl: string | null;
	status: 'ready' | 'uploading' | 'done' | 'error';
	errorMessage: string | null;
}
