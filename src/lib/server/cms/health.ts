/**
 * Health check (Lane B2): reports whether this process can actually serve
 * traffic, for Railway's `healthcheckPath` (see ../../../../railway.json) and
 * for a human operator (a non-technical designer) diagnosing "the site looks
 * down" without reading logs.
 *
 * ── Why two dependencies get two different verdicts ──────────────────────
 * The whole resilience architecture (see the migration brief / .migration/)
 * rests on object storage being the one thing that MUST work to serve a
 * visitor at all — every published page is a file there, read with no
 * Postgres involved. Postgres is only needed to RENDER a cache miss, and a
 * miss falls back to the styled error page, not a crash. That asymmetry is
 * deliberate and this check mirrors it exactly:
 *
 *   - storage unreachable → 'not_ready' (HTTP 503). Nothing can be served
 *     with any confidence — not even the cache, the entire ground floor of
 *     the architecture. Railway should hold traffic / not cut a deploy over.
 *   - storage OK, Postgres unreachable → 'degraded' (HTTP 200). The site is
 *     still fully servable from the page cache; only a cache MISS or an MCP
 *     edit would be affected. Reporting this as unhealthy would make
 *     Railway hold back or kill a deployment that is, from a visitor's
 *     point of view, working fine — the opposite of what this lane is for.
 *     'degraded' exists as a distinct status precisely so an operator (or a
 *     future alert) can tell "fully fine" from "fine for now, go look at
 *     Postgres" without either state being confused with "down".
 *   - both OK → 'ok' (HTTP 200).
 *
 * Deliberately NOT part of readiness: whether the startup cache warm
 * (`cache/warm.ts`) has finished. Warming is a self-heal/optimization, not a
 * precondition for serving — a process with a cold warm sweep still serves
 * every previously-published route from the durable cache exactly as well
 * as one that finished warming. Blocking readiness on it would reintroduce
 * the same class of bug this lane fixes (coupling "can I serve" to an
 * unrelated background task's timing). Its status is exposed in the body
 * anyway, for an operator who wants to see it.
 */

import { pingDatabase } from './db/client';
import { pingStorage } from './media/client';
import { getWarmStatus } from './cache/warm';

export type HealthState = 'ok' | 'degraded' | 'not_ready';

export interface HealthResult {
	status: HealthState;
	httpStatus: number;
	checks: {
		storage: boolean;
		database: boolean;
	};
	warm: ReturnType<typeof getWarmStatus>;
	message: string;
}

export async function checkHealth(): Promise<HealthResult> {
	const [storageOk, databaseOk] = await Promise.all([pingStorage(), pingDatabase()]);
	const warm = getWarmStatus();

	if (!storageOk) {
		return {
			status: 'not_ready',
			httpStatus: 503,
			checks: { storage: false, database: databaseOk },
			warm,
			message:
				'Object storage is unreachable. The page cache cannot be read, so this process cannot ' +
				'reliably serve any route yet.'
		};
	}

	if (!databaseOk) {
		return {
			status: 'degraded',
			httpStatus: 200,
			checks: { storage: true, database: false },
			warm,
			message:
				'Postgres is unreachable, but object storage is fine: every previously published page ' +
				'still serves from cache. Editing (MCP) and any never-cached route will fail until ' +
				'Postgres is back.'
		};
	}

	return {
		status: 'ok',
		httpStatus: 200,
		checks: { storage: true, database: true },
		warm,
		message: 'Storage and Postgres are both reachable.'
	};
}
