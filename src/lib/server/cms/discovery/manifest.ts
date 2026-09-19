/**
 * `/.well-known/mcp-server` (Lane B1) — the discovery document defined by
 * `draft-serra-mcp-discovery-uri` (IETF individual Internet-Draft, currently
 * revision 04, https://datatracker.ietf.org/doc/draft-serra-mcp-discovery-uri/).
 *
 * STATE OF THE STANDARD (checked live against the draft, not assumed): this
 * is one competing, NOT-yet-adopted proposal. As of this writing there is no
 * IETF working group, no RFC, and a parallel, differently-shaped discussion
 * in the MCP project itself (`.well-known/mcp/` directory + a
 * `server-card.json`, modelcontextprotocol/modelcontextprotocol discussions
 * #84 / #1147, SEP-1649, SEP-1960) that has NOT converged with this draft.
 * The MCP spec's own 2026-07-28 release scoped `.well-known` to OAuth
 * discovery only, deliberately leaving server-capability discovery
 * unresolved. Nothing here should be read as "the" standard — it's the most
 * concrete, specific, actually-shaped proposal available today, implemented
 * as ONE of several deliberately redundant discovery paths (see
 * `src/hooks.server.ts`'s Link header, `<link rel>` in the root layout, and
 * `/llms.txt`) precisely because no single one of them is safe to bet on
 * alone.
 *
 * Fields used here (draft-04 §3):
 *   - mcp_version, name, endpoint, transport: REQUIRED.
 *   - description, auth, capabilities, trust_class: RECOMMENDED (SHOULD).
 *   - docs: OPTIONAL, pointed at /llms.txt (Lane B1's operating manual).
 * `auth` is this draft's optional OAuth 2.0 Authorization Server Metadata
 * pointer — reuses the exact same metadata endpoint and scope list the real
 * OAuth engine serves (`auth/metadata.ts`, `auth/scope.ts`), never a second
 * hand-typed copy.
 *
 * This document does NOT depend on published content (unlike llms.txt /
 * llms-full.txt / sitemap.xml) — it only needs the request's own origin — so
 * it is NOT part of the publish-triggered regeneration in
 * `cache/regenerate.ts`; it's rendered fresh on every request, same as the
 * existing `/.well-known/oauth-protected-resource` and
 * `/.well-known/oauth-authorization-server` routes it sits next to.
 */

import { PROTOCOL_VERSION, SERVER_INFO } from '../mcp/server';
import { authorizationServerMetadataUrl } from '../auth/metadata';
import { SCOPES } from '../auth/scope';

export function mcpServerManifest(origin: string) {
	return {
		mcp_version: PROTOCOL_VERSION,
		name: SERVER_INFO.title,
		endpoint: `${origin}/api/mcp`,
		transport: 'http',
		description:
			'Moco (creative studio) content CMS, operated entirely over MCP tools — no separate admin UI. ' +
			'Requires OAuth authorization (see `auth`); an unauthenticated call gets a 401 that starts the same ' +
			'discovery chain.',
		capabilities: ['tools'],
		trust_class: 'public',
		auth: {
			type: 'oauth2',
			authorization_server_metadata: authorizationServerMetadataUrl(origin),
			scopes_supported: [...SCOPES]
		},
		docs: `${origin}/llms.txt`
	};
}
