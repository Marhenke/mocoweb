/**
 * Preview link tokens (Lane A8). A preview link renders the DRAFT state of a
 * page to whoever holds the link — no MCP auth, no bearer header, since it's
 * meant to be opened directly in a browser. Deliberately NOT a cookie
 * session: this engine's CSRF guard is disabled site-wide
 * (`csrf.trustedOrigins: ['*']`, see Lane A6) because SvelteKit's CSRF check
 * rejects the cross-origin POSTs OAuth clients make, so a cookie-based
 * session here would be a genuine, exploitable vulnerability (any page could
 * silently ride an authenticated cookie into a state-changing request). A
 * bare bearer-style token carried only in the URL's query string has no such
 * exposure — it isn't attached automatically by the browser to requests this
 * site didn't itself construct.
 *
 * The token is a signed, expiring opaque string: `<exp>.<hmac>`. It carries
 * no other claims (no collection/entry binding) because it doesn't need
 * to — draft content is already readable by any `read`-scoped MCP client via
 * get_entry/list_entries (which always return `data` regardless of scope),
 * so a preview link grants no more visibility than the API already does; it
 * just renders it as the actual page instead of JSON.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPreviewTokenSigningKey } from './keys';

/** Generous TTL: this is a share-a-link-with-a-client convenience, not a security-critical short-lived grant. */
export const PREVIEW_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export const PREVIEW_QUERY_PARAM = '__preview';

function hmac(payload: string): string {
	return createHmac('sha256', getPreviewTokenSigningKey()).update(payload).digest('base64url');
}

export function signPreviewToken(ttlSeconds = PREVIEW_TOKEN_TTL_SECONDS): string {
	const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
	const payload = String(exp);
	return `${payload}.${hmac(payload)}`;
}

/** Verifies signature and expiry. Returns false on any malformed/expired/forged token — no distinguishing detail, to avoid an oracle. */
export function verifyPreviewToken(token: string | null | undefined): boolean {
	if (!token) return false;
	const parts = token.split('.');
	if (parts.length !== 2) return false;
	const [payload, signature] = parts;

	const expected = Buffer.from(hmac(payload));
	const actual = Buffer.from(signature);
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

	const exp = Number(payload);
	if (!Number.isFinite(exp)) return false;
	return exp >= Math.floor(Date.now() / 1000);
}
