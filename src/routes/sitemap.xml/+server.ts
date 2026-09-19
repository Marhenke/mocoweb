/**
 * `/sitemap.xml` (Lane B1) — did not exist before this lane (a genuine SEO
 * gap, per the brief). Generated from the same route data `get_site_map`
 * reads (`siteRoutes` in content.schema.ts) for the static pages, plus every
 * currently PUBLISHED project for the dynamic `/trabajos/{slug}` pages.
 * Cached/regenerated exactly like `/llms.txt` (see that route and
 * `cache/regenerate.ts`).
 */

import { buildSitemapXml } from '$lib/server/cms/discovery/build';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const body = await buildSitemapXml(url.origin);
	return new Response(body, {
		headers: { 'Content-Type': 'application/xml; charset=utf-8' }
	});
};
