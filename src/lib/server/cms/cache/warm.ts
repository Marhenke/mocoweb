/**
 * Startup cache warm (Lane B2).
 *
 * Before this lane, the page cache (`store.ts`) was populated ONLY as a side
 * effect of `publish`/`unpublish` (Lane A8) — which is exactly the incident
 * this lane exists to fix: nothing ever re-populates the cache just because
 * a fresh process started, so a brand-new environment (an empty bucket, a
 * bucket pointed at by a fresh deploy, or one cache entry that never made it
 * in for some past reason) has NO safety net until the next unrelated
 * publish happens to touch it, however far in the future that is.
 *
 * This module reuses `regenerateForCollection` verbatim — the same
 * render → cache-write path `publish` already trusts — rather than
 * inventing a second way to turn "a collection's published entries" into
 * "cached HTML". It is intentionally NOT conditional on "only if this path's
 * cache entry is currently missing": every collection is fully
 * re-rendered-and-cached on every boot. For a site this size that is cheap,
 * and it doubles as a self-heal for any past entry whose cached bytes
 * silently went stale for a reason nobody noticed (a code/template change
 * since the last publish, e.g.) — the opposite failure mode (a route that
 * LOOKS cached but renders content nobody actually asked for) is worse than
 * one extra Postgres read per collection at boot.
 *
 * Because this is inherently best-effort against a process whose own HTTP
 * listener may not have bound yet (the self-fetch in `regenerate.ts` needs
 * something to fetch), and against dependencies that may be the very thing
 * mid-outage (the literal incident this lane fixes), failure here is always
 * silent and never blocks startup or the health endpoint: `getWarmStatus()`
 * just reports what happened for operators/diagnostics, and every visitor
 * request is served exactly as it would be with no warm step at all — from
 * whatever the cache already had (Layer 1), falling through to a live
 * render (Layer 2) otherwise.
 */

import { collectionDefinitions } from '$lib/content.schema';
import { regenerateForCollection } from './regenerate';

export interface WarmStatus {
	/** Epoch ms when the warm sweep was kicked off. */
	startedAt: number;
	/** Epoch ms when the warm sweep finished (all passes), or null while in progress. */
	finishedAt: number | null;
	/** How many top-level attempts (full sweeps over every collection) were made. */
	passes: number;
	/** Distinct paths successfully rendered and cached, across all passes. */
	warmed: string[];
	/** True once a pass has produced at least one warmed path, or the retry budget ran out. */
	settled: boolean;
}

const status: WarmStatus = {
	startedAt: 0,
	finishedAt: null,
	passes: 0,
	warmed: [],
	settled: false
};

let started = false;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One sweep: regenerate (render + cache) every route every collection backs.
 * Returns the distinct set of paths that were successfully warmed this pass.
 */
async function warmSweep(): Promise<string[]> {
	const warmedThisPass = new Set<string>();
	for (const { key } of collectionDefinitions) {
		try {
			const result = await regenerateForCollection(key, { fullCollection: true });
			for (const path of result.regenerated) warmedThisPass.add(path);
		} catch {
			// A genuinely thrown (not just "renderPath returned null") failure
			// for one collection must never stop the others from being tried.
		}
	}
	return [...warmedThisPass];
}

/**
 * Retries the full sweep with backoff while it keeps warming NOTHING at
 * all — the signature of "the HTTP listener isn't accepting connections
 * yet" (every self-fetch in `regenerate.ts` fails, caught there, so every
 * path comes back null). A sweep that warms at least one path is treated as
 * proof the process can reach itself, so it stops there even if some OTHER
 * paths individually failed (e.g. a genuine Postgres outage) — those simply
 * keep serving whatever the durable cache already had, per the architecture.
 */
async function runWarm(): Promise<void> {
	status.startedAt = Date.now();
	const backoffMs = [300, 1000, 2500, 5000];
	for (let pass = 0; pass <= backoffMs.length; pass++) {
		status.passes += 1;
		const warmed = await warmSweep();
		if (warmed.length > 0) {
			status.warmed = warmed;
			status.settled = true;
			break;
		}
		if (pass < backoffMs.length) await sleep(backoffMs[pass]);
	}
	status.finishedAt = Date.now();
}

/** Idempotent: only the first call actually starts the (backgrounded) warm sweep. */
export function startCacheWarm(): void {
	if (started) return;
	started = true;
	void runWarm();
}

export function getWarmStatus(): Readonly<WarmStatus> {
	return status;
}
