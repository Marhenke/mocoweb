/**
 * The authorization endpoint. GET renders the one-field key-entry page;
 * POST validates the submitted key and, on success, issues a single-use
 * authorization code and redirects back to the client's redirect_uri.
 *
 * There is no session and no cookie here by design (no accounts): every
 * request re-validates client_id/redirect_uri/PKCE from scratch, whether
 * it arrived as GET query params or POST form fields.
 *
 * ── Internal panel auto-grant (Lane B5 follow-up) ────────────────────────
 * When the request's `client_id`/`redirect_uri` pair is EXACTLY the fixed
 * internal panel client (`auth/internal-client.ts`'s
 * `isInternalPanelRequest`), the scope screen is hidden and the grant is
 * forced to `publish inbox` (full access) — because that request can only
 * legitimately come from this site's own `/admin`, run by the person who
 * already holds the owner key. This check runs on BOTH the GET (what page
 * to render) and the POST (what scope to actually grant) independently of
 * each other and of whatever the submitted form fields say — a forged POST
 * that sets `granted_scope=read` while claiming the internal client_id
 * still gets the full grant, and a forged POST that claims the internal
 * client_id from any OTHER redirect_uri gets the ordinary scope screen and
 * ordinary grant, same as any external client. See `internal-client.ts`'s
 * header for why the client_id+redirect_uri pair can't be produced by
 * `POST /register`.
 */

import { validateAuthorizeRequest } from '$lib/server/cms/auth/authorize-request';
import { renderAuthorizePage, renderAuthorizeErrorPage } from '$lib/server/cms/auth/authorize-page';
import { isOwnerKeyValid, createAuthorizationCode } from '$lib/server/cms/auth/tokens';
import { checkRateLimit } from '$lib/server/cms/auth/rate-limit';
import { isContentScope, contentPartOf } from '$lib/server/cms/auth/scope';
import {
	INTERNAL_PANEL_CLIENT_ID,
	ensureInternalPanelClient,
	isInternalPanelRequest
} from '$lib/server/cms/auth/internal-client';
import type { RequestHandler } from './$types';

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export const GET: RequestHandler = async ({ url }) => {
	if (url.searchParams.get('client_id') === INTERNAL_PANEL_CLIENT_ID) {
		// Self-provisions the fixed client row on first-ever use of this
		// origin (a fresh DB, or a new deployment URL) — see
		// internal-client.ts. A harmless no-op once it already exists.
		await ensureInternalPanelClient(url.origin);
	}

	const validated = await validateAuthorizeRequest(url.searchParams);
	if ('error' in validated) {
		return htmlResponse(renderAuthorizeErrorPage(validated.error, validated.description), 400);
	}

	const internal = isInternalPanelRequest(validated.client.clientId, validated.redirectUri, url.origin);

	return htmlResponse(
		renderAuthorizePage({
			clientName: validated.client.clientName,
			clientId: validated.client.clientId,
			responseType: 'code',
			redirectUri: validated.redirectUri,
			state: validated.state,
			codeChallenge: validated.codeChallenge,
			codeChallengeMethod: 'S256',
			defaultScope: internal ? 'publish inbox' : validated.requestedScope,
			internalFullAccess: internal
		})
	);
};

export const POST: RequestHandler = async ({ request, getClientAddress, url }) => {
	const rateLimit = checkRateLimit(`authorize:${getClientAddress()}`);
	if (!rateLimit.allowed) {
		return new Response('Too many attempts. Please wait before trying again.', {
			status: 429,
			headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) }
		});
	}

	const form = await request.formData();
	const params = new URLSearchParams();
	for (const key of [
		'response_type',
		'client_id',
		'redirect_uri',
		'state',
		'code_challenge',
		'code_challenge_method'
	]) {
		const value = form.get(key);
		if (typeof value === 'string') params.set(key, value);
	}

	if (params.get('client_id') === INTERNAL_PANEL_CLIENT_ID) {
		await ensureInternalPanelClient(url.origin);
	}

	const validated = await validateAuthorizeRequest(params);
	if ('error' in validated) {
		// Params were tampered with between GET and POST (or this is a
		// forged request) — never issue a code, never redirect anywhere
		// unverified.
		return htmlResponse(renderAuthorizeErrorPage(validated.error, validated.description), 400);
	}

	const internal = isInternalPanelRequest(validated.client.clientId, validated.redirectUri, url.origin);

	const submittedKey = form.get('owner_key');

	let grantedScope: string;
	if (internal) {
		// Forced, regardless of what the submitted form claims — see this
		// file's header. `granted_scope`/`granted_scope_inbox` are simply
		// never read on this path.
		grantedScope = 'publish inbox';
	} else {
		const grantedScopeRaw = form.get('granted_scope');
		// The content level (read/write/publish) is a radio group — exactly one
		// value or none. `inbox` is a wholly separate checkbox, independently
		// combinable with any content level (see scope.ts's header comment): its
		// presence/absence here does not affect which content-level radio was
		// picked, and vice versa.
		const grantedContent = isContentScope(grantedScopeRaw)
			? grantedScopeRaw
			: contentPartOf(validated.requestedScope);
		const grantedInbox = form.get('granted_scope_inbox') === 'inbox';
		grantedScope = grantedInbox ? `${grantedContent} inbox` : grantedContent;
	}

	if (typeof submittedKey !== 'string' || submittedKey.length === 0 || !isOwnerKeyValid(submittedKey)) {
		return htmlResponse(
			renderAuthorizePage({
				clientName: validated.client.clientName,
				clientId: validated.client.clientId,
				responseType: 'code',
				redirectUri: validated.redirectUri,
				state: validated.state,
				codeChallenge: validated.codeChallenge,
				codeChallengeMethod: 'S256',
				defaultScope: grantedScope,
				errorMessage: 'Clave incorrecta. No se otorgó acceso.',
				internalFullAccess: internal
			}),
			401
		);
	}

	const code = await createAuthorizationCode({
		clientId: validated.client.clientId,
		redirectUri: validated.redirectUri,
		codeChallenge: validated.codeChallenge,
		scope: grantedScope
	});

	const redirectTarget = new URL(validated.redirectUri);
	redirectTarget.searchParams.set('code', code);
	if (validated.state !== null) redirectTarget.searchParams.set('state', validated.state);

	// 303: this was a POST that shouldn't be replayed by a naive redirect
	// follow. Built manually (not SvelteKit's `redirect()` helper) because
	// we also need to hand back a plain, inspectable Response object from
	// the other branches of this handler.
	return new Response(null, { status: 303, headers: { Location: redirectTarget.toString() } });
};
