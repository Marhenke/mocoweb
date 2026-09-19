/**
 * The token endpoint. Two grant types:
 *
 *  - authorization_code: exchanges a single-use code (+ PKCE verifier) for
 *    an access token and a refresh token.
 *  - refresh_token: rotates a refresh token for a new access token and a
 *    new refresh token, invalidating the old one.
 *
 * Accepts both `application/x-www-form-urlencoded` (the RFC 6749 standard,
 * what most OAuth libraries send) and JSON, since MCP client SDKs aren't
 * fully consistent about it and being liberal here costs nothing.
 */

import { json } from '@sveltejs/kit';
import { consumeAuthorizationCode, rotateRefreshToken, getClient, createRefreshToken } from '$lib/server/cms/auth/tokens';
import { verifyPkce } from '$lib/server/cms/auth/pkce';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '$lib/server/cms/auth/jwt';
import type { RequestHandler } from './$types';

function oauthError(error: string, description: string, status = 400) {
	return json({ error, error_description: description }, { status });
}

async function parseBody(request: Request): Promise<Record<string, string>> {
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		const body = await request.json().catch(() => ({}));
		const out: Record<string, string> = {};
		if (typeof body === 'object' && body !== null) {
			for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
				if (typeof v === 'string') out[k] = v;
			}
		}
		return out;
	}
	const form = await request.formData();
	const out: Record<string, string> = {};
	for (const [k, v] of form.entries()) {
		if (typeof v === 'string') out[k] = v;
	}
	return out;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await parseBody(request);
	const grantType = body.grant_type;

	if (grantType === 'authorization_code') {
		const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body;
		if (!code || !redirectUri || !clientId || !codeVerifier) {
			return oauthError(
				'invalid_request',
				'code, redirect_uri, client_id, and code_verifier are all required.'
			);
		}

		const consumed = await consumeAuthorizationCode(code);
		if (!consumed) {
			return oauthError('invalid_grant', 'The authorization code is invalid, expired, or already used.');
		}
		if (consumed.clientId !== clientId) {
			return oauthError('invalid_grant', 'client_id does not match the one that requested this code.');
		}
		if (consumed.redirectUri !== redirectUri) {
			return oauthError('invalid_grant', 'redirect_uri does not match the one used at /authorize.');
		}
		if (!verifyPkce(codeVerifier, consumed.codeChallenge)) {
			return oauthError('invalid_grant', 'PKCE verification failed: code_verifier does not match code_challenge.');
		}

		const client = await getClient(consumed.clientId);
		const accessToken = signAccessToken({
			client_id: consumed.clientId,
			client_name: client?.clientName ?? null,
			scope: consumed.scope
		});
		const refreshToken = await createRefreshToken(consumed.clientId, consumed.scope);

		return json({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_TTL_SECONDS,
			refresh_token: refreshToken,
			scope: consumed.scope
		});
	}

	if (grantType === 'refresh_token') {
		const refreshTokenRaw = body.refresh_token;
		if (!refreshTokenRaw) {
			return oauthError('invalid_request', 'refresh_token is required.');
		}

		const rotated = await rotateRefreshToken(refreshTokenRaw);
		if (!rotated) {
			return oauthError('invalid_grant', 'The refresh token is invalid, expired, revoked, or already used.');
		}
		if (body.client_id && body.client_id !== rotated.clientId) {
			return oauthError('invalid_grant', 'client_id does not match this refresh token.');
		}

		const client = await getClient(rotated.clientId);
		const accessToken = signAccessToken({
			client_id: rotated.clientId,
			client_name: client?.clientName ?? null,
			scope: rotated.scope
		});

		return json({
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_TTL_SECONDS,
			refresh_token: rotated.refreshToken,
			scope: rotated.scope
		});
	}

	return oauthError('unsupported_grant_type', 'grant_type must be "authorization_code" or "refresh_token".');
};
