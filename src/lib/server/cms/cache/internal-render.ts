/**
 * Marks an HTTP request as an internal, self-issued "render this route for
 * real" call — used by the static-regeneration engine (`regenerate.ts`) when
 * it re-renders a page after `publish`/`unpublish` to snapshot into the page
 * cache.
 *
 * Every anonymous GET to a cacheable route is normally intercepted by
 * `src/hooks.server.ts` and answered straight from the cache, without
 * touching Postgres. That is exactly wrong for the regeneration engine
 * itself: it needs a FRESH render (hitting Postgres, picking up whatever
 * `publish` just wrote) precisely when the cache is stale. This header is
 * how the hook tells the two cases apart.
 *
 * The secret is a random value generated once per process and never
 * persisted or exposed over the network in either direction except as this
 * exact header on a loopback request this same process makes to itself — an
 * external client cannot obtain it by any means (it isn't derived from
 * OWNER_KEY, isn't logged, isn't in any response), so it cannot be used to
 * force a visitor-facing request to bypass the cache and load Postgres on
 * every hit.
 */

import { randomBytes } from 'node:crypto';

export const INTERNAL_RENDER_HEADER = 'x-mocoweb-internal-render';

const SECRET = randomBytes(32).toString('hex');

export function internalRenderHeaders(): Record<string, string> {
	return { [INTERNAL_RENDER_HEADER]: SECRET };
}

export function isInternalRenderRequest(request: Request): boolean {
	return request.headers.get(INTERNAL_RENDER_HEADER) === SECRET;
}
