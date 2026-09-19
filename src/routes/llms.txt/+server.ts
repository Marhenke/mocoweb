/**
 * `/llms.txt` (Lane B1) — curated index following the llmstxt.org convention,
 * PLUS the operating manual an agent (and the human connecting one) actually
 * needs: real-world testing during this lane showed that pointing an agent
 * at the MCP endpoint alone was not enough — it also needs to know how to
 * authenticate, what the scopes mean, and the concrete tool-call sequence
 * for a content change. See `discovery/build.ts` for the generation logic
 * and its anti-drift measures.
 *
 * Served/cached exactly like a page: `src/hooks.server.ts` answers a cache
 * hit here with the stored Content-Type, and `cache/regenerate.ts`
 * re-renders this path (by hitting this very handler over loopback) on
 * every publish/unpublish of ANY collection, since this file's content
 * spans all of them.
 */

import { buildLlmsTxt } from '$lib/server/cms/discovery/build';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const body = await buildLlmsTxt(url.origin);
	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
};
