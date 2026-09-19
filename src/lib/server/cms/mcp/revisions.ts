/**
 * Revision logging for MCP writes. Every write that changes an entry's
 * `data` records a row in `revisions` carrying the `client_id` from the
 * OAuth auth context (see `requireAuth`), which is how a change stays
 * attributable when every agent shares the one owner key / client
 * population — there are no per-user accounts in this system, `client_id`
 * (one per registered MCP client application) is the only identity there is.
 *
 * Reading this back for review is `list_revisions`; restoring an old state
 * is `rollback` (both Lane A8, `mcp/tools/publish.ts`).
 *
 * ── The seeded floor (Lane A8 follow-up) ─────────────────────────────────
 * A revision records what a write changed `data` TO, never what it was
 * before — so an entry that no agent has ever touched has zero revisions,
 * and `rollback` has nothing to restore to. Measured on this project's own
 * 39 seeded entries: 2 had ever been written through `update_entry`, so 37
 * had no rollback target at all — a silent hole that only appears the
 * moment someone actually needs it, on a system with one environment and no
 * staging. `SEED_REVISION_CLIENT_ID` is the marker `scripts/seed.ts` uses to
 * write one revision per entry for its seeded state, so the chain always
 * has a floor: revision N is the state after write N, revision 0 (this one)
 * is where the content started, and rolling back to it undoes every agent
 * write ever made to that entry.
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { revisions } from '../db/schema';
import { SEED_REVISION_CLIENT_ID } from './revision-constants';

export { SEED_REVISION_CLIENT_ID };

export async function recordRevision(params: {
	entryId: string;
	data: unknown;
	clientId: string;
	note?: string | null;
}): Promise<void> {
	await db.insert(revisions).values({
		entryId: params.entryId,
		data: params.data,
		clientId: params.clientId,
		note: params.note ?? null
	});
}

/**
 * Records the initial "floor" revision for an entry if (and only if) it has
 * none yet — used by `scripts/seed.ts` so every entry gets exactly one
 * seeded-state revision on first seed, and re-running seed (it's idempotent)
 * never adds a second one or overwrites a real agent revision that came
 * after it.
 */
export async function recordSeedRevisionIfMissing(entryId: string, data: unknown): Promise<boolean> {
	const existing = await db
		.select({ id: revisions.id })
		.from(revisions)
		.where(eq(revisions.entryId, entryId))
		.limit(1);
	if (existing.length > 0) return false;
	await recordRevision({
		entryId,
		data,
		clientId: SEED_REVISION_CLIENT_ID,
		note: 'initial seeded state'
	});
	return true;
}
