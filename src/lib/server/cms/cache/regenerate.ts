/**
 * Static regeneration (Lane A8): turns "collection X was just
 * published/unpublished" into concrete HTML written to the page cache.
 *
 * Fan-out (which concrete paths to touch) comes entirely from
 * `routesForCollection` in `src/lib/content.schema.ts` — the same
 * route→collection declaration `get_site_map` reads — plus whichever
 * entries in the collection are CURRENTLY published (queried fresh here,
 * after the publish/unpublish that triggered this has already committed).
 * No second, separately-maintained list of "which pages does this
 * collection affect" exists anywhere in this codebase.
 *
 * Rendering a route means making a real HTTP request to this same running
 * server (self-fetch over loopback, using `process.env.PORT` — the exact
 * port this process is itself bound to) carrying the internal-render header
 * from `internal-render.ts`, so `src/hooks.server.ts` lets it through to a
 * real SvelteKit render (hitting Postgres) instead of answering from the
 * cache it would otherwise intercept. That real render already reads
 * `published_data`/`publishedPosition` — the same columns `publish` just
 * wrote — so the HTML captured here is exactly what a visitor would see.
 */

import { routesForCollection, generatedDiscoveryFiles } from '$lib/content.schema';
import { listEntryRows } from '../mcp/entry-store';
import { internalRenderHeaders } from './internal-render';
import { putCachedPage, deleteCachedPage } from './store';

interface RenderedPage {
	body: string;
	contentType: string;
}

async function renderPath(path: string): Promise<RenderedPage | null> {
	const port = process.env.PORT || '3000';
	const url = `http://127.0.0.1:${port}${path}`;
	try {
		const res = await fetch(url, { headers: internalRenderHeaders() });
		if (!res.ok) return null;
		const body = await res.text();
		const contentType = res.headers.get('content-type') ?? 'text/html; charset=utf-8';
		return { body, contentType };
	} catch {
		// The regeneration self-fetch failing (e.g. this process isn't
		// actually listening on PORT yet, or DNS/socket hiccup) must not
		// throw out of publish/unpublish — the DB write (the thing that
		// actually matters) already succeeded. A failed regeneration just
		// means this path falls back to a live, uncached render next visit.
		return null;
	}
}

export interface RegenerateResult {
	/** Paths freshly re-rendered and written to the cache. */
	regenerated: string[];
	/** Paths removed from the cache without being re-rendered (see removedSlug). */
	invalidated: string[];
}

export interface FanOutOptions {
	changedSlug?: string;
	removedSlugs?: string[];
	fullCollection?: boolean;
}

async function currentlyPublishedSlugs(collectionKey: string): Promise<string[]> {
	const rows = await listEntryRows(collectionKey);
	return rows
		.filter((r) => r.publishedData !== null)
		.sort((a, b) => (a.publishedPosition ?? 0) - (b.publishedPosition ?? 0))
		.map((r) => r.slug);
}

interface FanOut {
	toRegenerate: Set<string>;
	toInvalidate: Set<string>;
}

/**
 * Turns "collection X changed" into the concrete set of cache paths to
 * re-render (`toRegenerate`) and the set to drop outright (`toInvalidate`,
 * pages that no longer exist). Pure computation — touches Postgres to read
 * currently-published slugs, but never touches the cache itself. Shared by
 * both `regenerateForCollection` (tolerant of individual render failures,
 * used by `unpublish` and the startup cache warm) and `validateRegeneration`
 * (Lane B2, used by `publish` — see its doc comment for why publish needs a
 * stricter, all-or-nothing version of the same fan-out).
 *
 *   - `changedSlug`: the one entry that was individually published (single-
 *     entry publish mode). Only used for a dynamic route whose
 *     `regenerateScope` is 'entry' — a 'collection'-scope dynamic route
 *     always regenerates every currently-published entry regardless, since
 *     by definition its content depends on the whole list, not just the one
 *     entry that changed.
 *   - `fullCollection`: a collection-wide publish (every entry's content
 *     may have changed, not just one) — an 'entry'-scope dynamic route
 *     regenerates every currently-published slug too in this mode, same as
 *     a 'collection'-scope route always does, since there is no single
 *     `changedSlug` to point at.
 *   - `removedSlugs`: entries that just stopped being published (unpublish,
 *     or a publish that processed one or more pending deletes). Each one's
 *     own dynamic page is DELETED from the cache (not re-rendered — it no
 *     longer exists) so a stale "live" copy can never be served; they are
 *     correctly excluded from every other regenerated page's listing
 *     because `currentlyPublishedSlugs` is queried fresh, after the DB
 *     write that removed them.
 */
async function computeFanOut(collectionKey: string, opts: FanOutOptions): Promise<FanOut> {
	const routes = routesForCollection(collectionKey);
	const toRegenerate = new Set<string>();
	const toInvalidate = new Set<string>();

	// Lane B1: the generated discovery files (/llms.txt, /llms-full.txt,
	// /sitemap.xml) aggregate content from every collection, not just this
	// one, so — unlike a `siteRoutes` region — there is no collection-specific
	// fan-out to compute here; every publish/unpublish of ANY collection
	// regenerates all three, unconditionally. See the doc comment on
	// `generatedDiscoveryFiles` in content.schema.ts for why they are a
	// separate declaration rather than a region on every route.
	for (const file of generatedDiscoveryFiles) {
		toRegenerate.add(file.pattern);
	}

	for (const removedSlug of opts.removedSlugs ?? []) {
		for (const route of routes) {
			if (route.dynamic) {
				toInvalidate.add(route.pattern.replace('{slug}', removedSlug));
			}
		}
	}

	let publishedSlugsCache: string[] | null = null;
	const getPublishedSlugs = async () =>
		(publishedSlugsCache ??= await currentlyPublishedSlugs(collectionKey));

	for (const route of routes) {
		if (!route.dynamic) {
			toRegenerate.add(route.pattern);
			continue;
		}
		if (route.regenerateScope === 'collection' || opts.fullCollection) {
			for (const slug of await getPublishedSlugs()) {
				toRegenerate.add(route.pattern.replace('{slug}', slug));
			}
		} else if (opts.changedSlug) {
			toRegenerate.add(route.pattern.replace('{slug}', opts.changedSlug));
		}
	}
	// Never regenerate something we're about to invalidate (it no longer exists).
	for (const path of toInvalidate) toRegenerate.delete(path);

	return { toRegenerate, toInvalidate };
}

/**
 * Regenerates every route this collection affects, per its declared fan-out.
 * Tolerant of individual render failures (a path that fails to render is
 * simply skipped, per-path, and left exactly as it was in the cache — see
 * `renderPath`'s doc comment for why that must never throw out of here).
 * Used by `unpublish` (removing content essentially never breaks a render)
 * and the startup cache warm. `publish` uses the stricter
 * `validateRegeneration` below instead — see its doc comment.
 */
export async function regenerateForCollection(
	collectionKey: string,
	opts: FanOutOptions = {}
): Promise<RegenerateResult> {
	const { toRegenerate, toInvalidate } = await computeFanOut(collectionKey, opts);

	for (const path of toInvalidate) await deleteCachedPage(path);

	const regenerated: string[] = [];
	for (const path of toRegenerate) {
		const rendered = await renderPath(path);
		if (rendered !== null) {
			await putCachedPage(path, rendered.body, rendered.contentType);
			regenerated.push(path);
		}
	}

	return { regenerated, invalidated: [...toInvalidate] };
}

export interface RenderFailure {
	/** The path that failed to render. */
	path: string;
}

export interface ValidatedRegeneration {
	/** True only if every path in the fan-out rendered successfully. */
	ok: boolean;
	/** One entry per path that failed to render (empty when `ok`). */
	failures: RenderFailure[];
	/**
	 * Commits the validated render to the cache: deletes every invalidated
	 * path, then writes every regenerated path using the EXACT bytes already
	 * rendered during validation (never re-rendered — what gets cached is
	 * provably what was validated, with no window for content to drift
	 * between the two). Throws if called when `ok` is false — callers must
	 * check `ok` first, exactly like the "refuse the publish" contract this
	 * exists for.
	 */
	commit: () => Promise<RegenerateResult>;
}

/**
 * The property the migration brief calls "publish must validate by
 * rendering": renders (but does NOT write to the cache) every path this
 * collection's fan-out touches, so a caller (`publish`, see
 * `mcp/tools/publish.ts`) can decide whether the underlying DB change is
 * safe to keep BEFORE any visitor-facing artifact (the cache) is touched.
 *
 * This is deliberately a two-phase render-then-commit split rather than a
 * single all-or-nothing transaction, because rendering happens via an HTTP
 * self-fetch to this same running process (`renderPath`/`internal-render.ts`)
 * — a genuinely separate request on a separate Postgres connection from
 * whatever DB transaction a caller might wrap around this — so it can never
 * see uncommitted writes. `publish` therefore writes its DB change FIRST
 * (so the render reflects it), validates by rendering, and only on success
 * calls `commit()` to actually touch the cache; on failure it restores the
 * DB to what it was before (a compensating write, not a rolled-back
 * transaction) and never calls `commit()` at all, so nothing already cached
 * is touched, deleted, or overwritten — the previous published version
 * keeps serving exactly as it did before the attempt.
 */
export async function validateRegeneration(
	collectionKey: string,
	opts: FanOutOptions = {}
): Promise<ValidatedRegeneration> {
	const { toRegenerate, toInvalidate } = await computeFanOut(collectionKey, opts);

	const rendered = new Map<string, { body: string; contentType: string }>();
	const failures: RenderFailure[] = [];
	for (const path of toRegenerate) {
		const result = await renderPath(path);
		if (result === null) {
			failures.push({ path });
		} else {
			rendered.set(path, result);
		}
	}

	const ok = failures.length === 0;

	return {
		ok,
		failures,
		commit: async () => {
			if (!ok) {
				throw new Error(
					'validateRegeneration().commit() called after a failed validation — refuse the ' +
						'publish and roll back instead of committing.'
				);
			}
			for (const path of toInvalidate) await deleteCachedPage(path);
			const regenerated: string[] = [];
			for (const [path, page] of rendered) {
				await putCachedPage(path, page.body, page.contentType);
				regenerated.push(path);
			}
			return { regenerated, invalidated: [...toInvalidate] };
		}
	};
}
