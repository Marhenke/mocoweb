/**
 * Revision logging for MCP writes. Every write that changes an entry's
 * `data` records a row in `revisions` carrying the `client_id` from the
 * OAuth auth context (see `requireAuth`), which is how a change stays
 * attributable when every agent shares the one owner key / client
 * population — there are no per-user accounts in this system, `client_id`
 * (one per registered MCP client application) is the only identity there is.
 *
 * This only writes history. Reading it back for review/rollback is Lane
 * A8's job, not this one.
 */

import { db } from '../db/client';
import { revisions } from '../db/schema';

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
