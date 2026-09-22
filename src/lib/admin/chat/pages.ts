/**
 * Lane B8 — flattens every page across every entry in a change set, deduped
 * by route pattern (two entries can legitimately share a page, e.g. both
 * back the home preview grid). Shared by `PendingChangeBar.svelte` (the
 * thumbnail + its "switch page" control) and `PreviewOverlay.svelte` (the
 * full-screen tabs) so both pick the same set of pages the same way.
 */
import type { ChangeCard, ChangeCardPage } from './types';

export function dedupePages(card: ChangeCard): ChangeCardPage[] {
	const seen = new Map<string, ChangeCardPage>();
	for (const entry of card.entries) {
		for (const p of entry.pages) {
			if (p.previewUrl) seen.set(p.pattern, p);
		}
	}
	return [...seen.values()];
}
