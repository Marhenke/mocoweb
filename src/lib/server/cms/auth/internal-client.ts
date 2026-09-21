/**
 * The admin panel's fixed, server-owned OAuth client (Lane B5 follow-up) —
 * the ONLY thing that makes "the internal panel gets a full grant with no
 * scope screen" safe rather than spoofable. See
 * `$lib/admin/internal-client-id.ts` for why the id itself being public is
 * fine; this module is what actually enforces trust.
 *
 * `ensureInternalPanelClient(origin)` upserts a row for
 * `INTERNAL_PANEL_CLIENT_ID` whose `redirect_uris` contains exactly
 * `${origin}/admin` — called from `routes/authorize/+server.ts` before
 * validating a request that claims this client_id, so the row exists (with
 * the right redirect_uri for whatever origin this deployment is actually
 * running on — Railway prod, a preview URL, or local dev) without a manual
 * seed step. `isInternalPanelRequest` is the single predicate every
 * authorize-flow decision point uses to ask "is this really the panel,
 * talking to its own /admin, or something pretending to be it" — it checks
 * BOTH the exact client_id AND the exact redirect_uri, never one alone:
 * checking client_id only would trust the string itself (public, so
 * meaningless as a credential); checking redirect_uri only would let any
 * DCR-registered client that also happens to choose `/admin` as its
 * redirect claim the same trust. Both together is what `POST /register`
 * can never produce, because DCR never lets a caller choose its own
 * client_id (see `tokens.ts`'s `registerClient`).
 */

import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { oauthClients } from '../db/schema';
import { INTERNAL_PANEL_CLIENT_ID } from '$lib/admin/internal-client-id';

export { INTERNAL_PANEL_CLIENT_ID };

/** The one redirect_uri the internal client is ever allowed to use, for a given origin. */
export function internalPanelRedirectUri(origin: string): string {
	return `${origin}/admin`;
}

export async function ensureInternalPanelClient(origin: string): Promise<void> {
	const redirectUri = internalPanelRedirectUri(origin);
	const rows = await db
		.select({ redirectUris: oauthClients.redirectUris })
		.from(oauthClients)
		.where(eq(oauthClients.clientId, INTERNAL_PANEL_CLIENT_ID))
		.limit(1);

	if (rows.length === 0) {
		await db.insert(oauthClients).values({
			clientId: INTERNAL_PANEL_CLIENT_ID,
			clientName: 'Panel del sitio',
			redirectUris: [redirectUri]
		});
		return;
	}

	// Already exists — add this origin's /admin URL if it's not already
	// registered (a deployment can legitimately be reached at more than one
	// origin over its lifetime: local dev, a Railway preview URL, prod).
	const existing = (rows[0].redirectUris as string[]) ?? [];
	if (!existing.includes(redirectUri)) {
		await db
			.update(oauthClients)
			.set({ redirectUris: [...existing, redirectUri] })
			.where(eq(oauthClients.clientId, INTERNAL_PANEL_CLIENT_ID));
	}
}

/**
 * True only when BOTH the client_id is the fixed internal id AND the
 * redirect_uri is exactly this origin's own `/admin` — see this file's
 * header for why both checks together (never either alone) is what makes
 * this unspoofable.
 */
export function isInternalPanelRequest(clientId: string, redirectUri: string, origin: string): boolean {
	return clientId === INTERNAL_PANEL_CLIENT_ID && redirectUri === internalPanelRedirectUri(origin);
}
