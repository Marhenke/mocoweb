/**
 * The authorization endpoint. GET renders the one-field key-entry page;
 * POST validates the submitted key and, on success, issues a single-use
 * authorization code and redirects back to the client's redirect_uri.
 *
 * There is no session and no cookie here by design (no accounts): every
 * request re-validates client_id/redirect_uri/PKCE from scratch, whether
 * it arrived as GET query params or POST form fields.
 */

import { validateAuthorizeRequest } from '$lib/server/cms/auth/authorize-request';
import { renderAuthorizePage, renderAuthorizeErrorPage } from '$lib/server/cms/auth/authorize-page';
import { isOwnerKeyValid, createAuthorizationCode } from '$lib/server/cms/auth/tokens';
import { checkRateLimit } from '$lib/server/cms/auth/rate-limit';
import { isContentScope, contentPartOf } from '$lib/server/cms/auth/scope';
import type { RequestHandler } from './$types';

function htmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export const GET: RequestHandler = async ({ url }) => {
	const validated = await validateAuthorizeRequest(url.searchParams);
	if ('error' in validated) {
		return htmlResponse(
			renderAuthorizeErrorPage(validated.error, validated.description),
			400
		);
	}

	return htmlResponse(
		renderAuthorizePage({
			clientName: validated.client.clientName,
			clientId: validated.client.clientId,
			responseType: 'code',
			redirectUri: validated.redirectUri,
			state: validated.state,
			codeChallenge: validated.codeChallenge,
			codeChallengeMethod: 'S256',
			defaultScope: validated.requestedScope
		})
	);
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
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

	const validated = await validateAuthorizeRequest(params);
	if ('error' in validated) {
		// Params were tampered with between GET and POST (or this is a
		// forged request) — never issue a code, never redirect anywhere
		// unverified.
		return htmlResponse(renderAuthorizeErrorPage(validated.error, validated.description), 400);
	}

	const submittedKey = form.get('owner_key');
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
	const grantedScope = grantedInbox ? `${grantedContent} inbox` : grantedContent;

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
				errorMessage: 'Incorrect key. No access was granted.'
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
