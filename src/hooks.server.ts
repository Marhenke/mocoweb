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
 *    `csrf.trustedOrigins: ['*']` (Lane A6). Lane B8: a valid preview
 *    response also gets its same-origin relative links rewritten to carry
 *    the same token (`injectPreviewToken`/`rewritePreviewResponse` below)
 *    and `Referrer-Policy: no-referrer`, so clicking around inside a
 *    preview — nav, a project card, "back" — stays in preview instead of
 *    silently landing back on the live site; see `routes/+layout.svelte`
 *    for the client-side half of that same fix.
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
 *
 * 5. Admin panel CSP (Lane B5). Every response to `/admin` (and its
 *    `/api/chat` backend) gets a strict `Content-Security-Policy` header —
 *    added here, unconditionally, on every return path through this
 *    function (GET or POST, cache hit or live render), rather than in the
 *    route itself, so it can never be accidentally skipped by one code path
 *    and not another. `/admin` holds a bearer access token in memory and
 *    renders chat text (including, indirectly, tool output that can
 *    originate from an anonymous site visitor's contact-form message) — an
 *    XSS there would be a real token leak, which is exactly what this
 *    header is for. Scoped to `/admin*` only, not site-wide: the public
 *    pages load Google Fonts' stylesheet (`src/app.html`), and a
 *    site-wide policy would need auditing this lane has no reason to do —
 *    see `addAdminSecurityHeaders`'s own comment for the exact directives.
 *
 * 6. First-party analytics (Lane B4). `recordPageView` is called for every
 *    real page GET that reaches a response — on a cache HIT (line below the
 *    cache read) as much as on a live render — because the brief explicitly
 *    requires counting cache hits: most of this site's traffic IS a cache
 *    hit, so recording only live renders would undercount nearly everything.
 *    It is called WITHOUT `await` (fire-and-forget): the function itself
 *    swallows every error internally (see `analytics/record.ts`) and never
 *    does synchronous work, so it cannot slow down or break the response
 *    being returned in the same tick. Excluded on purpose: preview requests
 *    (the owner testing a draft, not a real visitor — handled by that
 *    branch's own early return, below) and anything already excluded from
 *    the cache path (data requests, sub-requests, non-GET).
 */

import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit';
import { isKnownRoutePath } from '$lib/content.schema';
import { isInternalRenderRequest } from '$lib/server/cms/cache/internal-render';
import { getCachedPage } from '$lib/server/cms/cache/store';
import { verifyPreviewToken, PREVIEW_QUERY_PARAM } from '$lib/server/cms/auth/preview-token';
import { startCacheWarm } from '$lib/server/cms/cache/warm';
import { recordPageView } from '$lib/server/cms/analytics/record';

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
 * Strict CSP for `/admin` and `/api/chat` (Lane B5) — see job 5 above.
 * `script-src 'self'` with no `unsafe-inline`/`unsafe-eval` and no
 * `data:`/external hosts is the directive that actually matters for the
 * "XSS leaks the token" threat: the access token only ever lives in a JS
 * variable, so blocking every script source except this origin's own built
 * bundle is what makes an injected `<script>` (or an `javascript:`/inline
 * event-handler payload) inert. `style-src`/`font-src` allow Google Fonts
 * because `src/app.html` (the one shared shell for every route on this
 * site, admin included) already loads Bricolage Grotesque/Inter from there
 * — styles can't exfiltrate a bearer token the way scripts can, so
 * widening only those two directives to match what the page already loads
 * is a deliberate, narrow relaxation, not a gap in the policy that matters.
 * `frame-ancestors 'none'` stops this page from being framed by another
 * origin (clickjacking a logged-in admin session); `object-src 'none'` and
 * `base-uri 'self'` close the two other classic CSP-bypass corners.
 */
const ADMIN_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"font-src 'self' https://fonts.gstatic.com",
	"img-src 'self' data: blob:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'"
].join('; ');

/**
 * SvelteKit itself always injects one inline `<script>` per HTML page to
 * kick off hydration (the `kit.start(app, element, {...})` call visible in
 * every rendered page's source) — there is no way to make it an external
 * file, and no page-level code chooses to add it. A strict `script-src
 * 'self'` with neither `unsafe-inline` nor a nonce blocks that inline
 * script outright, which was caught by actually driving `/admin` in a real
 * browser (per this lane's brief) rather than assumed: the page hung on
 * "Cargando…" forever, and the console showed the exact CSP violation
 * (`script-src 'self'` rejecting the inline script) plus the hash Chrome
 * itself computed for it.
 *
 * Fix: compute that SAME hash server-side, per response — the CSP3 spec's
 * `'sha256-...'` source lets a specific inline script's exact content
 * authorize itself, which is what SvelteKit's own built-in `kit.csp`
 * feature does automatically. That built-in feature is deliberately NOT
 * used here because it is a site-wide `svelte.config`/vite-plugin option —
 * turning it on would apply to every public route too, including the ones
 * that embed a DIFFERENT inline script (the JSON-LD block on `/` and
 * `/trabajos/{slug}`, Lane B1), which would need its own, separate fix and
 * is out of scope for "add a strict CSP on /admin". Hashing here instead
 * keeps the change scoped to exactly the two routes this lane owns.
 */
async function sha256Base64(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Lane B7 — every PUBLIC page gets `frame-ancestors 'self'`: the preview-
 * approval flow's "Ver preview" embeds a real public page (e.g.
 * /trabajos/sergio-castiglione?__preview=...) in an iframe INSIDE /admin,
 * same origin — which a public page with no `frame-ancestors` at all (the
 * state of every non-admin route before this lane) already permits, so
 * nothing here is required to make that overlay work. What WAS missing:
 * with no policy at all, any OTHER origin could iframe these pages too
 * (clickjacking) — `'self'` keeps the admin's own embed working while
 * closing that off, without adopting the admin's much stricter
 * `frame-ancestors 'none'` (which would also block /admin's own use of
 * itself). Deliberately narrow: only this one directive, not the fuller
 * CSP `ADMIN_CSP` uses — auditing a site-wide `default-src`/`script-src`
 * for every public route (Google Fonts, the JSON-LD block on / and
 * /trabajos/{slug}, etc.) is out of scope here, same reasoning
 * `addAdminSecurityHeaders`'s own header already gives for not turning on
 * SvelteKit's site-wide `kit.csp` option.
 */
function addPublicFrameHeader(response: Response): Response {
	response.headers.append('Content-Security-Policy', "frame-ancestors 'self'");
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	return response;
}

/**
 * Lane B8 — closes the "preview leaks back to the live site" hole: a
 * request carrying a valid `?__preview=<token>` must stay in preview for
 * every link the owner clicks from there, not just the one page they
 * hard-loaded. Every same-origin, site-relative `href`/`action` attribute
 * in the rendered HTML gets the token appended (preserving whatever query/
 * hash it already had). This is the SERVER half of the fix — see
 * `routes/+layout.svelte`'s header for the CLIENT half this pairs with
 * (a client-side navigation re-renders a route's own page content from
 * Svelte's compiled template, which this string rewrite can never reach,
 * since it only ever touches the one document actually served here).
 *
 * Deliberately conservative about what counts as "same-origin, site-
 * relative": the value must start with exactly one `/` (the regex's
 * negative lookahead excludes `//host` protocol-relative URLs). That single
 * check is also what keeps an external link, `mailto:`, `tel:`, or a bare
 * `#fragment` untouched — none of those start with a single `/` — so the
 * token can never attach to anything that leaves this origin. A value that
 * ALREADY contains `__preview=` (a real token from some other path, or the
 * layout's own "Salir de la vista previa" link, which deliberately renders
 * an EMPTY `__preview=` as an explicit opt-out marker — see that link's own
 * comment) is left untouched, so this never double-appends and never
 * overwrites the explicit exit.
 */
const LINK_ATTR_RE = /\b(href|action)=(["'])([^"']*)\2/g;

function injectPreviewToken(html: string, token: string): string {
	return html.replace(LINK_ATTR_RE, (full, attr: string, quote: string, value: string) => {
		if (!/^\/(?!\/)/.test(value)) return full;
		if (value.includes(`${PREVIEW_QUERY_PARAM}=`)) return full;
		const hashIndex = value.indexOf('#');
		const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
		const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
		const qIndex = withoutHash.indexOf('?');
		const base = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
		const query = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : '';
		const params = new URLSearchParams(query);
		params.set(PREVIEW_QUERY_PARAM, token);
		return `${attr}=${quote}${base}?${params.toString()}${hash}${quote}`;
	});
}

/**
 * Rewrites a preview response's HTML body (see `injectPreviewToken` above)
 * and sets `Referrer-Policy: no-referrer` on it — the preview token lives
 * only in the URL, so the ordinary `Referer` header on any outbound
 * navigation (including to a genuinely external site the page links to)
 * would otherwise carry it off this origin. A non-HTML preview response
 * (the client router's own `__data.json` fetches) has no links to rewrite
 * and is returned untouched.
 */
async function rewritePreviewResponse(response: Response, token: string): Promise<Response> {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('text/html')) return response;
	const body = await response.text();
	const headers = new Headers(response.headers);
	headers.set('Referrer-Policy', 'no-referrer');
	return new Response(injectPreviewToken(body, token), { status: response.status, headers });
}

async function addAdminSecurityHeaders(response: Response, pathname: string): Promise<Response> {
	if (pathname !== '/admin' && !pathname.startsWith('/admin/') && pathname !== '/api/chat') {
		return addPublicFrameHeader(response);
	}

	const contentType = response.headers.get('content-type') ?? '';
	let csp = ADMIN_CSP;

	if (contentType.includes('text/html')) {
		const body = await response.text();
		const hashes = new Set<string>();
		for (const match of body.matchAll(INLINE_SCRIPT_RE)) {
			hashes.add(`'sha256-${await sha256Base64(match[1])}'`);
		}
		if (hashes.size > 0) {
			csp = csp.replace("script-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`);
		}
		const headers = new Headers(response.headers);
		headers.set('Content-Security-Policy', csp);
		headers.set('X-Frame-Options', 'DENY');
		headers.set('Referrer-Policy', 'no-referrer');
		return new Response(body, { status: response.status, headers });
	}

	response.headers.set('Content-Security-Policy', csp);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'no-referrer');
	return response;
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
		return addAdminSecurityHeaders(await resolve(event), event.url.pathname);
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
		let response = await resolve(event);
		if (event.locals.preview) {
			// Lane B8 — keep every link on this page inside preview too (see
			// `injectPreviewToken`'s header). Only for a genuinely valid token —
			// an invalid/expired one already renders the live page above, which
			// must never be preview-linked into.
			response = await rewritePreviewResponse(response, previewToken);
		}
		if (event.url.pathname === '/') addMcpLinkHeader(response, event.url.origin);
		return addAdminSecurityHeaders(response, event.url.pathname);
	}

	// SvelteKit normalises client-side navigation requests before this hook
	// runs: a browser asking for `/estudio/__data.json` arrives here with
	// `url.pathname === '/estudio'` and `isDataRequest === true`. Without this
	// guard the cache answers those with the page's HTML, the client router
	// fails to parse it as JSON, and every in-app navigation dies — while a
	// hard page load still works, because that really is an HTML request.
	// Sub-requests (server-side `fetch` during SSR) are excluded for the same
	// reason: the cache only ever holds whole documents, never partial data.
	if (event.isDataRequest || event.isSubRequest) {
		return addAdminSecurityHeaders(await resolve(event), event.url.pathname);
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
			recordPageView({
				pathname: event.url.pathname,
				userAgent: event.request.headers.get('user-agent'),
				referer: event.request.headers.get('referer'),
				origin: event.url.origin
			});
			return addAdminSecurityHeaders(response, event.url.pathname);
		}
	}

	const response = await resolve(event);
	if (event.url.pathname === '/') addMcpLinkHeader(response, event.url.origin);
	recordPageView({
		pathname: event.url.pathname,
		userAgent: event.request.headers.get('user-agent'),
		referer: event.request.headers.get('referer'),
		origin: event.url.origin
	});
	return addAdminSecurityHeaders(response, event.url.pathname);
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
