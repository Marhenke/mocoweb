/**
 * Two jobs, both Lane A8:
 *
 * 1. Static page cache. An anonymous GET to a known page route
 *    (`isKnownRoutePath`) is answered straight from the object-store page
 *    cache (`src/lib/server/cms/cache/store.ts`) when present, WITHOUT
 *    running the route's own `load` (so without touching Postgres). A miss
 *    falls through to a normal live render — the cache is only ever
 *    populated by the regeneration engine at publish/unpublish time (see
 *    `cache/regenerate.ts`), never lazily by visitor traffic, which is what
 *    keeps invalidation simple: a cached page's bytes change at exactly one
 *    moment, not as a side effect of who happens to hit it first.
 *
 * 2. Preview mode. A request carrying a valid `?__preview=<token>` (see
 *    `auth/preview-token.ts`) always bypasses the cache and sets
 *    `event.locals.preview = true`, which every route's `+page.server.ts`
 *    reads to render DRAFT content instead of live content. No cookie is
 *    ever set for this — see `preview-token.ts`'s header comment for why a
 *    cookie session would be a real vulnerability given this app's
 *    `csrf.trustedOrigins: ['*']` (Lane A6).
 *
 * The regeneration engine's own self-fetches (internal-render.ts) skip both
 * of the above entirely — they need a genuine, fresh, non-preview render to
 * snapshot into the cache.
 */

import type { Handle } from '@sveltejs/kit';
import { isKnownRoutePath } from '$lib/content.schema';
import { isInternalRenderRequest } from '$lib/server/cms/cache/internal-render';
import { getCachedPage } from '$lib/server/cms/cache/store';
import { verifyPreviewToken, PREVIEW_QUERY_PARAM } from '$lib/server/cms/auth/preview-token';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.preview = false;

	if (event.request.method !== 'GET') {
		return resolve(event);
	}

	if (isInternalRenderRequest(event.request)) {
		// The regeneration engine rendering a page for real, to snapshot into
		// the cache. Never intercept this with the cache itself, and it is
		// never a preview render either.
		return resolve(event);
	}

	const previewToken = event.url.searchParams.get(PREVIEW_QUERY_PARAM);
	if (previewToken !== null) {
		event.locals.preview = verifyPreviewToken(previewToken);
		// Whether or not the token was valid, a request carrying a preview
		// param is never served from the (published-only) page cache — an
		// invalid/expired token should fall through to a normal LIVE render
		// (locals.preview is false), not accidentally serve stale cached HTML.
		return resolve(event);
	}

	if (isKnownRoutePath(event.url.pathname)) {
		const cached = await getCachedPage(event.url.pathname);
		if (cached !== null) {
			return new Response(cached, {
				status: 200,
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
					'X-Mocoweb-Cache': 'HIT'
				}
			});
		}
	}

	return resolve(event);
};
