/**
 * Read-side aggregation over `page_view_stats` (Lane B4) — what the
 * `query_analytics` MCP tool calls. Every function here just sums the
 * already-aggregated `count` column across whatever grouping/date-range was
 * asked for; there is no per-view data left to re-derive anything more
 * granular than the rollup itself stores (see `db/schema.ts`).
 */

import { and, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '../db/client';
import { pageViewStats } from '../db/schema';

export type AnalyticsPeriod = 'today' | '7d' | '30d' | 'all';
export type AnalyticsGroupBy = 'path' | 'referrer' | 'device' | 'day';

function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** Inclusive UTC-day lower bound for a period, or null for 'all' (no lower bound). */
function periodStartDay(period: AnalyticsPeriod): string | null {
	const now = new Date();
	if (period === 'today') return utcDay(now);
	if (period === '7d') {
		const d = new Date(now);
		d.setUTCDate(d.getUTCDate() - 6);
		return utcDay(d);
	}
	if (period === '30d') {
		const d = new Date(now);
		d.setUTCDate(d.getUTCDate() - 29);
		return utcDay(d);
	}
	return null;
}

export interface AnalyticsRow {
	key: string;
	views: number;
}

export interface AnalyticsQueryResult {
	period: AnalyticsPeriod;
	groupBy: AnalyticsGroupBy;
	pathFilter: string | null;
	totalViews: number;
	rows: AnalyticsRow[];
}

const GROUP_COLUMN = {
	path: pageViewStats.path,
	referrer: pageViewStats.referrerHost,
	device: pageViewStats.device,
	day: pageViewStats.day
} as const;

export async function queryAnalytics(opts: {
	period: AnalyticsPeriod;
	groupBy: AnalyticsGroupBy;
	path?: string;
}): Promise<AnalyticsQueryResult> {
	const startDay = periodStartDay(opts.period);
	const conditions = [
		startDay ? gte(pageViewStats.day, startDay) : undefined,
		opts.path ? eq(pageViewStats.path, opts.path) : undefined
	].filter((c): c is NonNullable<typeof c> => c !== undefined);

	const groupCol = GROUP_COLUMN[opts.groupBy];
	const viewsExpr = sum(pageViewStats.count);

	const rows = await db
		.select({ key: groupCol, views: viewsExpr })
		.from(pageViewStats)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.groupBy(groupCol)
		.orderBy(opts.groupBy === 'day' ? groupCol : sql`2 desc`);

	const parsed = rows.map((r) => ({ key: r.key, views: Number(r.views ?? 0) }));
	const totalViews = parsed.reduce((acc, r) => acc + r.views, 0);

	return {
		period: opts.period,
		groupBy: opts.groupBy,
		pathFilter: opts.path ?? null,
		totalViews,
		rows: parsed
	};
}
