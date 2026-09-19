/**
 * Three jobs. The first two are Lane A8:
 *
 * 1. Static page cache. An anonymous GET to a known cacheable path
 *    (`isKnownRoutePath` — every page route AND, since Lane B1, the
 *    generated discovery files /llms.txt, /llms-full.txt, /sitemap.xml) is
 *    answered straight from the object-store cache
 *    (`src/lib/server/cms/cache/store.ts`) when present, WITHOUT running the
 *    route's own `load`/handler (so without touching Postgres). A miss falls
 *    through to a normal live render — the cache is only ever populated by
 *    the regeneration engine at publish/unpublish time (see
 *    `cache/regenerate.ts`), never lazily by visitor traffic, which is what
 *    keeps invalidation simple: a cached path's bytes change at exactly one
 *    moment, not as a side effect of who happens to hit it first. The
 *    content type served on a cache hit is whatever was stored with that
 *    object (HTML for a page, text/plain or application/xml for a discovery
 *    file) — never hardcoded.
 *
 * 2. Preview mode. A request carrying a valid `?__preview=<token>` (see
 *    `auth/preview-token.ts`) always bypasses the cache and sets
 *    `event.locals.preview = true`, which every route's `+page.server.ts`
 *    reads to render DRAFT content instead of live content. No cookie is
 *    ever set for this — see `preview-token.ts`'s header comment for why a
 *    cookie session would be a real vulnerability given this app's
 *    `csrf.trustedOrigins: ['*']` (Lane A6).
 *
 * 3. Agent discovery (Lane B1). Every response to the site root (`/`) gets
 *    an HTTP `Link: <.../api/mcp>; rel="mcp-server"` header, one of the
 *    several deliberately redundant discovery paths the Lane B1 brief calls
 *    for (alongside `/.well-known/mcp-server`, `/llms.txt`, and a `<link
 *    rel>` tag in the root HTML) — added here, not in a route, so it's
 *    present whether `/` is served live or from the page cache.
 *
 * The regeneration engine's own self-fetches (internal-render.ts) skip jobs
 * 1 and 2 entirely — they need a genuine, fresh, non-preview render to
 * snapshot into the cache.
 *
 * 4. Resilience (Lane B2). Two additions, both generic engine behavior, not
 *    Moco-specific:
 *      - `init` kicks off the startup cache warm (`cache/warm.ts`) in the
 *        background as soon as this process is about to start serving — see
 *        that module's header for why it self-heals a cold/empty cache
 *        without ever blocking or being a precondition for readiness.
 *      - The cache lookup itself is wrapped in try/catch: object storage
 *        being unreachable must fall through to a live render (Layer 2 of
 *        the architecture), never bubble up as an unhandled rejection that
 *        would turn into exactly the raw, unstyled crash this lane exists
 *        to prevent. `handleError` (below) is the last-resort net for
 *        anything that still throws past this — from here, from `resolve`,
 *        or from a route's own `load`.
 */

import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { isKnownRoutePath } from '$lib/content.schema';
import { isInternalRenderRequest } from '$lib/server/cms/cache/internal-render';
import { getCachedPage } from '$lib/server/cms/cache/store';
import { verifyPreviewToken, PREVIEW_QUERY_PARAM } from '$lib/server/cms/auth/preview-token';
import { startCacheWarm } from '$lib/server/cms/cache/warm';

/**
 * There is no IANA-registered `rel` value for "this is where the MCP server
 * for this site lives" — the whole point of Lane B1 is that this convention
 * isn't settled yet (see `.well-known/mcp-server/+server.ts`'s doc comment
 * for the state of the IETF draft). "mcp-server" mirrors the well-known
 * path's own name and is used consistently across all 4 discovery paths this
 * lane adds; a future settled spec may call for a different value, at which
 * point this is the one place to change it.
 */
const MCP_LINK_REL = 'mcp-server';

function addMcpLinkHeader(response: Response, origin: string): void {
	response.headers.append('Link', `<${origin}/api/mcp>; rel="${MCP_LINK_REL}"`);
}

/**
 * Reads the page cache defensively: a storage outage (or any other
 * unexpected error from the S3 client) must be treated exactly like a cache
 * miss — fall through to a live render — never propagate and crash the
 * request. This is the one line the whole "storage down ≠ site down"
 * guarantee hinges on; see `cache/store.ts` and the health endpoint for the
 * rest of that story.
 */
async function safeGetCachedPage(
	pathname: string
): Promise<Awaited<ReturnType<typeof getCachedPage>>> {
	try {
		return await getCachedPage(pathname);
	} catch (err) {
		console.error(
			JSON.stringify({
				at: 'hooks.server:safeGetCachedPage',
				pathname,
				error: err instanceof Error ? err.message : String(err)
			})
		);
		return null;
	}
}

/**
 * Kicks off the startup cache warm in the background. Per SvelteKit's `init`
 * contract this runs once, before the server answers its first request —
 * but `startCacheWarm` itself returns immediately (the actual warm sweep is
 * an un-awaited background promise), so this never delays the process from
 * accepting traffic. See `cache/warm.ts` for the full reasoning.
 */
export const init: ServerInit = () => {
	startCacheWarm();
};

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
		const response = await resolve(event);
		if (event.url.pathname === '/') addMcpLinkHeader(response, event.url.origin);
		return response;
	}

	if (isKnownRoutePath(event.url.pathname)) {
		const cached = await safeGetCachedPage(event.url.pathname);
		if (cached !== null) {
			const response = new Response(cached.body, {
				status: 200,
				headers: {
					'Content-Type': cached.contentType,
					'X-Mocoweb-Cache': 'HIT'
				}
			});
			if (event.url.pathname === '/') addMcpLinkHeader(response, event.url.origin);
			return response;
		}
	}

	const response = await resolve(event);
	if (event.url.pathname === '/') addMcpLinkHeader(response, event.url.origin);
	return response;
};

/**
 * Last-resort net (Lane B2): every unexpected error that reaches SvelteKit
 * — thrown from `handle`, from a route's `load`, or anywhere else in a
 * request's lifecycle — comes through here before `+error.svelte` renders.
 * Two jobs, deliberately separated:
 *
 *   1. Log it with enough context (path, method, a generated id) to actually
 *      debug from Railway's logs — before this lane, a failure here simply
 *      vanished into an unstyled fallback page with no server-side trace at
 *      all tying it to a specific request.
 *   2. Return a message with NO internals — no stack trace, no raw
 *      exception text, no error code — because `+error.svelte`'s 500 branch
 *      shows generic copy regardless and this value is only ever surfaced
 *      to a non-technical visitor. The `errorId` is the one thing worth
 *      surfacing: it's what lets the site's owner say "error abc123" to
 *      whoever reads the logs, without either of them needing to understand
 *      what actually broke.
 */
export const handleError: HandleServerError = ({ error, event, status }) => {
	const errorId = crypto.randomUUID();
	console.error(
		JSON.stringify({
			at: 'hooks.server:handleError',
			errorId,
			status,
			method: event.request.method,
			pathname: event.url.pathname,
			error: error instanceof Error ? (error.stack ?? error.message) : String(error)
		})
	);
	return {
		message: 'Ocurrió un error inesperado de nuestro lado.',
		errorId
	};
};
