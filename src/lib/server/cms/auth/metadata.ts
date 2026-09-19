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

export function authorizationServerMetadataUrl(origin: string): string {
	return `${origin}/.well-known/oauth-authorization-server`;
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
		scopes_supported: [...SCOPES],
		// Non-standard extension field (no RFC 8414 field covers this). A cold
		// agent has no other way to know, before fetching it, that GET
		// authorization_endpoint returns an HTML key-entry FORM to render/open
		// for a human — not a 302 redirect to a separate hosted login page,
		// which is what "authorization_endpoint" implies in most OAuth setups
		// an agent has seen before. Discovered the hard way in Lane A7's
		// cold-start test: the agent had to fetch the page speculatively to
		// find out. See scopes_supported above for what each level in
		// granted_scope on that form actually grants.
		moco_authorization_endpoint_ui:
			'form: GET returns a self-contained HTML page with a single owner-key password field, a content ' +
			'access-level radio group (read / write / publish), and a SEPARATE "inbox" checkbox — not a redirect ' +
			'to a hosted login provider. inbox is independent of the content radio group: it grants (or withholds) ' +
			'access to contact-form submissions regardless of which content level is chosen, and must be checked ' +
			'explicitly — no content level implies it. Render/open the page for a human to fill in; there is no ' +
			'programmatic way to complete authorization without one.'
	};
}
