/**
 * `/llms-full.txt` (Lane B1) — the full published content of every page and
 * project, as prose, per the llmstxt.org convention (llms.txt = index,
 * llms-full.txt = everything). ONLY published content: `discovery/build.ts`
 * reads every collection through the same default (non-draft) getters every
 * visitor-facing page uses — there is no way to reach draft content from
 * this file. Cached/regenerated exactly like `/llms.txt` (see that route and
 * `cache/regenerate.ts`).
 */

import { buildLlmsFullTxt } from '$lib/server/cms/discovery/build';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const body = await buildLlmsFullTxt(url.origin);
	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' }
	});
};
