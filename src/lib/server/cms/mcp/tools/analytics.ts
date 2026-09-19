/**
 * First-party analytics tool (Lane B4). Only `read` scope — deliberately
 * NOT gated behind `inbox` like the contact-form tools: an aggregated view
 * count identifies nobody (see `db/schema.ts`'s `pageViewStats` doc
 * comment), so it carries none of the "real people's data" concern that
 * justifies a separate grant for the inbox.
 */

import { queryAnalytics, type AnalyticsGroupBy, type AnalyticsPeriod } from '../../analytics/query';
import { textResult, type ToolDefinition } from '../types';

const PERIODS: AnalyticsPeriod[] = ['today', '7d', '30d', 'all'];
const GROUP_BYS: AnalyticsGroupBy[] = ['path', 'referrer', 'device', 'day'];

export const queryAnalyticsTool: ToolDefinition = {
	name: 'query_analytics',
	description:
		'Answers "how is the site doing" questions from first-party, server-recorded page-view analytics — no ' +
		"third-party tracker, no cookies, nothing that identifies a visitor. Views are pre-aggregated per day/" +
		'page/referrer/device (never per-visit), and known bots are excluded before counting, so numbers here ' +
		'reflect real visits. Pick `groupBy` to match the question: "path" for "which project/page gets the most ' +
		'views" (rows are page paths, sorted by views descending), "referrer" for "where does my traffic come ' +
		'from" (rows are referring domains, or "direct"/"internal"), "device" for a mobile-vs-desktop split, or ' +
		'"day" for a day-by-day trend. Combine with `period` for "this week"-style questions (use "7d") and with ' +
		'`path` to scope any grouping to one specific page (e.g. group by "referrer" with path "/trabajos/racebox" ' +
		'to see where that one project\'s traffic comes from). `totalViews` in the result is the sum across ALL ' +
		'returned rows for the period/filter, not just the top row.',
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			period: {
				type: 'string',
				enum: PERIODS,
				description:
					'Date range, in UTC days: "today", "7d" (last 7 days including today), "30d", or "all" (no ' +
					'lower bound — since analytics recording began). Defaults to "7d".'
			},
			groupBy: {
				type: 'string',
				enum: GROUP_BYS,
				description: 'How to bucket the rows. See the tool description for which to use per question. Defaults to "path".'
			},
			path: {
				type: 'string',
				description:
					'Optional: restrict to one exact page path (e.g. "/trabajos/racebox"). Omit for site-wide.'
			}
		},
		additionalProperties: false
	},
	handler: async (args) => {
		const period = PERIODS.includes(args.period as AnalyticsPeriod)
			? (args.period as AnalyticsPeriod)
			: '7d';
		const groupBy = GROUP_BYS.includes(args.groupBy as AnalyticsGroupBy)
			? (args.groupBy as AnalyticsGroupBy)
			: 'path';
		const path = typeof args.path === 'string' && args.path.length > 0 ? args.path : undefined;

		const result = await queryAnalytics({ period, groupBy, path });
		return textResult(result);
	}
};

export const analyticsTools: ToolDefinition[] = [queryAnalyticsTool];
