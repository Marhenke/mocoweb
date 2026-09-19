/**
 * `requireAuth` — the guard every protected endpoint (the MCP endpoint in
 * Lane A7, and `src/routes/api/auth-probe/+server.ts` here as a stand-in
 * used to prove this module end-to-end) should call first.
 *
 * Usage:
 *
 *   const auth = await requireAuth(request, 'write');
 *   if (auth instanceof Response) return auth; // 401 or 403, already built
 *   // auth.clientId / auth.clientName / auth.scope are now trustworthy
 *
 * Returning a Response instead of throwing keeps this framework-agnostic
 * (no dependency on SvelteKit's `error()`, which can't attach a
 * `WWW-Authenticate` header) and keeps the call site a plain, testable
 * two-line check.
 */

import type { Scope } from './scope';
import { satisfiesScope } from './scope';
import { verifyAccessToken } from './jwt';
import { protectedResourceMetadataUrl } from './metadata';

export interface AuthContext {
	clientId: string;
	clientName: string | null;
	/** The granted scope SET (e.g. "write" or "write inbox"), not a single Scope. See scope.ts. */
	scope: string;
}

function challenge(origin: string, error: string, description: string): string {
	const resourceMetadata = protectedResourceMetadataUrl(origin);
	return `Bearer resource_metadata="${resourceMetadata}", error="${error}", error_description="${description}"`;
}

function jsonError(status: number, body: Record<string, string>, wwwAuthenticate: string): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'WWW-Authenticate': wwwAuthenticate
		}
	});
}

export async function requireAuth(request: Request, minScope: Scope): Promise<AuthContext | Response> {
	const origin = new URL(request.url).origin;
	const authHeader = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(.+)$/i.exec(authHeader);

	if (!match) {
		return jsonError(
			401,
			{ error: 'invalid_token', error_description: 'Missing bearer token.' },
			challenge(origin, 'invalid_token', 'Missing bearer token.')
		);
	}

	const payload = verifyAccessToken(match[1]);
	if (!payload) {
		return jsonError(
			401,
			{ error: 'invalid_token', error_description: 'The access token is invalid or expired.' },
			challenge(origin, 'invalid_token', 'The access token is invalid or expired.')
		);
	}

	if (!satisfiesScope(payload.scope, minScope)) {
		return jsonError(
			403,
			{ error: 'insufficient_scope', error_description: `This operation requires "${minScope}" scope.` },
			challenge(origin, 'insufficient_scope', `This operation requires "${minScope}" scope.`)
		);
	}

	return { clientId: payload.client_id, clientName: payload.client_name, scope: payload.scope };
}
