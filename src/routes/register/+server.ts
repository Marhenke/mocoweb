/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration.
 *
 * No auth required to hit this endpoint — that's the point. This system has
 * no user accounts, so there's no human to paste a pre-issued `client_id`
 * into an MCP client's config; every client (Claude Desktop, Codex, ...)
 * registers itself the first time it connects and gets back its own
 * `client_id`. All registered clients are public (no client secret — see
 * the OAuth AS metadata's `token_endpoint_auth_methods_supported: ["none"]`):
 * PKCE is what protects the authorization code exchange instead. Whatever
 * `token_endpoint_auth_method` a client asks for, the response always says
 * "none", because no other method is ever honored.
 */

import { json } from '@sveltejs/kit';
import { registerClient } from '$lib/server/cms/auth/tokens';
import type { RequestHandler } from './$types';

function isValidRedirectUri(uri: unknown): uri is string {
	if (typeof uri !== 'string' || uri.length === 0) return false;
	try {
		// eslint-disable-next-line no-new
		new URL(uri);
		return true;
	} catch {
		return false;
	}
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'Request body must be JSON.' },
			{ status: 400 }
		);
	}

	if (typeof body !== 'object' || body === null) {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'Request body must be a JSON object.' },
			{ status: 400 }
		);
	}

	const { client_name, redirect_uris } = body as Record<string, unknown>;

	if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
		return json(
			{
				error: 'invalid_redirect_uri',
				error_description: 'redirect_uris must be a non-empty array of absolute URIs.'
			},
			{ status: 400 }
		);
	}
	if (!redirect_uris.every(isValidRedirectUri)) {
		return json(
			{ error: 'invalid_redirect_uri', error_description: 'Every redirect_uri must be a valid absolute URI.' },
			{ status: 400 }
		);
	}
	if (client_name !== undefined && typeof client_name !== 'string') {
		return json(
			{ error: 'invalid_client_metadata', error_description: 'client_name must be a string if present.' },
			{ status: 400 }
		);
	}

	const client = await registerClient({
		clientName: (client_name as string | undefined) ?? null,
		redirectUris: redirect_uris as string[]
	});

	return json(
		{
			client_id: client.clientId,
			client_name: client.clientName,
			redirect_uris: client.redirectUris,
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			scope: 'read write publish'
		},
		{ status: 201 }
	);
};
