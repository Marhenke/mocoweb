/**
 * `/.well-known/mcp-server` (Lane B1) — see `discovery/manifest.ts` for the
 * standard this follows (an unadopted IETF individual draft, checked against
 * its actual current text, not assumed) and why this is one of several
 * deliberately redundant discovery paths rather than the one true answer.
 *
 * Not cached/regenerated (see `manifest.ts`'s header comment) — rendered
 * fresh per request from just the origin, same as the two
 * `oauth-*` `.well-known` routes it sits next to.
 */

import { json } from '@sveltejs/kit';
import { mcpServerManifest } from '$lib/server/cms/discovery/manifest';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	return json(mcpServerManifest(url.origin));
};
