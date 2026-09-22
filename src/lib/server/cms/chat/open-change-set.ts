/**
 * Lane B8 — resolves what the site's ONE persistent pinned bar should show
 * right now, for a given conversation: the live-rebuilt pending set if
 * anything is pending (status 'pending'), else the frozen last-published
 * snapshot if Deshacer is still available (status 'published'), else null
 * (bar absent). Shared by `routes/api/chat/+server.ts` (GET, so a reload/
 * re-login sees the same bar) and the three approve/discard/undo endpoints
 * (so every action's response tells the browser exactly what to show next,
 * without a second round trip).
 */

import { buildChangeCard, type ChangeCard } from './change-card';
import { getPendingChange, getLastPublished } from './pending-changes';

export async function getOpenChangeSet(conversationId: string, origin: string): Promise<ChangeCard | null> {
	const pending = await getPendingChange(conversationId);
	if (pending && pending.entries.length > 0) {
		return buildChangeCard(origin, pending.entries);
	}
	const lastPublished = await getLastPublished(conversationId);
	if (lastPublished && lastPublished.entries.length > 0) {
		return { status: 'published', entries: lastPublished.entries, publishedAt: lastPublished.publishedAt };
	}
	return null;
}
