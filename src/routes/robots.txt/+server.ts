/**
 * `/robots.txt` (Lane B1) — was a static 63-byte file with no Sitemap
 * directive and no mention of the agent-discovery files this lane adds. Now
 * a route (not `static/robots.txt`, which is removed) so it can reference
 * `/sitemap.xml` and `/llms.txt` as absolute URLs built from the real
 * request origin, the same convention every other self-referencing URL in
 * this engine follows (see `auth/require-auth.ts`, the two `oauth-*`
 * `.well-known` routes).
 *
 * Not cached/regenerated: crawling permissions and the sitemap/llms.txt
 * pointers don't depend on published content, so this renders fresh per
 * request, same as the `.well-known` manifests.
 */

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const body = [
		'User-agent: *',
		'Disallow:',
		'',
		`Sitemap: ${url.origin}/sitemap.xml`,
		'',
		'# Agent-operable site (Model Context Protocol) — start here:',
		`# ${url.origin}/llms.txt`
	].join('\n') + '\n';
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
