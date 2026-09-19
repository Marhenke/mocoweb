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

import { routesForCollection } from '$lib/content.schema';
import { listEntryRows } from '../mcp/entry-store';
import { internalRenderHeaders } from './internal-render';
import { putCachedPage, deleteCachedPage } from './store';

async function renderPath(path: string): Promise<string | null> {
	const port = process.env.PORT || '3000';
	const url = `http://127.0.0.1:${port}${path}`;
	try {
		const res = await fetch(url, { headers: internalRenderHeaders() });
		if (!res.ok) return null;
		return await res.text();
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

async function currentlyPublishedSlugs(collectionKey: string): Promise<string[]> {
	const rows = await listEntryRows(collectionKey);
	return rows
		.filter((r) => r.publishedData !== null)
		.sort((a, b) => (a.publishedPosition ?? 0) - (b.publishedPosition ?? 0))
		.map((r) => r.slug);
}

/**
 * Regenerates every route this collection affects, per its declared fan-out.
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
export async function regenerateForCollection(
	collectionKey: string,
	opts: { changedSlug?: string; removedSlugs?: string[]; fullCollection?: boolean } = {}
): Promise<RegenerateResult> {
	const routes = routesForCollection(collectionKey);
	const toRegenerate = new Set<string>();
	const toInvalidate = new Set<string>();

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

	for (const path of toInvalidate) await deleteCachedPage(path);

	const regenerated: string[] = [];
	for (const path of toRegenerate) {
		const html = await renderPath(path);
		if (html !== null) {
			await putCachedPage(path, html);
			regenerated.push(path);
		}
	}

	return { regenerated, invalidated: [...toInvalidate] };
}
