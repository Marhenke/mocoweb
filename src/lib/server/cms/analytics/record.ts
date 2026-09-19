/**
 * First-party, server-side page-view recording (Lane B4).
 *
 * ── Why server-side, not a third-party analytics product ─────────────────
 * The server already sees every request, so recording costs no external
 * call; the data lands in the same Postgres the MCP reads, so the owner's
 * "how many inquiries this week / which project gets the most views"
 * questions need no separate integration; there is no third-party
 * JavaScript shipped to the browser, so pages stay exactly as fast as
 * before; and because NO personal data is stored (see the aggregation
 * design below), the site needs no cookie banner on any client site this
 * engine is copied to.
 *
 * ── Aggregation, not one row per view ─────────────────────────────────────
 * See `db/schema.ts`'s `pageViewStats` doc comment for the full design
 * rationale. In short: one row per (day, path, referrerHost, device),
 * incremented in place. This function's whole job is computing that row's
 * key and running the `count = count + 1` upsert.
 *
 * ── Must never slow down or break serving a page ─────────────────────────
 * `recordPageView` is called from `hooks.server.ts` WITHOUT being awaited
 * (fire-and-forget) on both a cache hit and a live render, and this
 * function itself swallows every error internally — a failure here is
 * invisible to the visitor and never delays the response by even one tick
 * of the event loop, let alone a database round-trip.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { pageViewStats } from '../db/schema';
import { isAnalyticsPagePath } from '$lib/content.schema';
import { isBotRequest, classifyDevice, classifyReferrer } from './classify';

function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

export interface PageViewInput {
	pathname: string;
	userAgent: string | null;
	referer: string | null;
	origin: string;
}

/**
 * Fire-and-forget entry point: NEVER awaited by the caller, NEVER throws.
 * Filters (in order, cheapest first) anything that isn't worth a row: not
 * a declared static page path, or a bot User-Agent.
 */
export function recordPageView(input: PageViewInput): void {
	if (!isAnalyticsPagePath(input.pathname)) return;
	if (isBotRequest(input.userAgent)) return;

	const day = utcDay(new Date());
	const device = classifyDevice(input.userAgent);
	const referrerHost = classifyReferrer(input.referer, input.origin);

	db.insert(pageViewStats)
		.values({ day, path: input.pathname, referrerHost, device, count: 1 })
		.onConflictDoUpdate({
			target: [
				pageViewStats.day,
				pageViewStats.path,
				pageViewStats.referrerHost,
				pageViewStats.device
			],
			set: { count: sql`${pageViewStats.count} + 1`, updatedAt: new Date() }
		})
		.catch((err) => {
			console.error(
				JSON.stringify({
					at: 'analytics/record:recordPageView',
					pathname: input.pathname,
					error: err instanceof Error ? err.message : String(err)
				})
			);
		});
}
