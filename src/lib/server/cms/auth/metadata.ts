/**
 * Builds the two `.well-known` metadata documents this engine serves as its
 * own Authorization Server (RFC 8414) and Resource Server (RFC 9728), plus
 * the shared "resource_metadata" URL used in `WWW-Authenticate` challenges.
 * Centralized so the routes and `require-auth.ts` can't drift apart on the
 * URL shape.
 */

import { SCOPES } from './scope';

export function protectedResourceMetadataUrl(origin: string): string {
	return `${origin}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata(origin: string) {
	return {
		resource: origin,
		authorization_servers: [origin],
		bearer_methods_supported: ['header'],
		scopes_supported: [...SCOPES]
	};
}

export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/authorize`,
		token_endpoint: `${origin}/token`,
		registration_endpoint: `${origin}/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [...SCOPES]
	};
}
