/**
 * Shared validation for an /authorize request's OAuth params, used by both
 * the GET (render the key-entry form) and POST (submit the key) handlers in
 * src/routes/authorize/+server.ts — the POST re-validates everything from
 * its hidden fields rather than trusting them, since they round-tripped
 * through the client's browser.
 */

import { getClient, type RegisteredClient } from './tokens';
import { isSupportedChallengeMethod } from './pkce';
import { parseScope, type Scope } from './scope';

export interface ValidAuthorizeRequest {
	client: RegisteredClient;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	requestedScope: Scope;
}

export type AuthorizeValidationError = { error: string; description: string };

/**
 * Validates response_type/client_id/redirect_uri/code_challenge(_method).
 * Deliberately never redirects the browser back to an unverified
 * redirect_uri on failure — a client_id that doesn't exist, or a
 * redirect_uri that doesn't match what that client registered, gets a
 * plain in-page error instead of a redirect, to avoid turning this endpoint
 * into an open redirector.
 */
export async function validateAuthorizeRequest(
	params: URLSearchParams
): Promise<ValidAuthorizeRequest | AuthorizeValidationError> {
	const responseType = params.get('response_type');
	if (responseType !== 'code') {
		return { error: 'unsupported_response_type', description: 'response_type must be "code".' };
	}

	const clientId = params.get('client_id');
	if (!clientId) {
		return { error: 'invalid_request', description: 'client_id is required.' };
	}
	const client = await getClient(clientId);
	if (!client) {
		return { error: 'invalid_client', description: 'Unknown client_id. Register it at /register first.' };
	}

	const redirectUri = params.get('redirect_uri');
	if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
		return {
			error: 'invalid_request',
			description: 'redirect_uri is missing or does not match a URI this client registered.'
		};
	}

	const codeChallenge = params.get('code_challenge');
	const codeChallengeMethod = params.get('code_challenge_method');
	if (!codeChallenge) {
		return { error: 'invalid_request', description: 'code_challenge is required.' };
	}
	if (!isSupportedChallengeMethod(codeChallengeMethod)) {
		return {
			error: 'invalid_request',
			description: 'code_challenge_method must be "S256". "plain" is not supported.'
		};
	}

	const requestedScope = parseScope(params.get('scope')) ?? 'write';

	return {
		client,
		redirectUri,
		state: params.get('state'),
		codeChallenge,
		requestedScope
	};
}
