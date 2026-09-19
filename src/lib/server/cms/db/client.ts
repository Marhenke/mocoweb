/**
 * Database client for the CMS engine.
 *
 * Uses the postgres.js driver (not node-postgres or a query-engine binary)
 * specifically so the production build stays a single self-contained Node
 * process — no extra native binary to ship alongside the app.
 *
 * This file lives under `src/lib/server/`, SvelteKit's server-only import
 * boundary: it can never end up in a client bundle, which is what we want
 * for a database connection string.
 *
 * ── Pool configuration (Lane B2) ─────────────────────────────────────────
 * postgres.js connects lazily on first query, with NO timeout and NO limits
 * by default — that combination is exactly what turned a slow DNS
 * resolution / unreachable host into the incident this lane exists to fix:
 * a request's first query just hangs, with infinite patience, until
 * whatever called it (a page render, a health check, an MCP tool) gives up
 * or the platform kills the process. `connect_timeout` bounds that hang to a
 * few seconds so a dead/slow Postgres fails FAST and loud instead of hanging
 * quietly; `max`/`idle_timeout`/`max_lifetime` bound how many connections this
 * one process can hold open and for how long, so a spike in traffic (or a
 * connection that Postgres's own side silently dropped) can't leak the pool
 * dry. This is deliberately just the driver-level connect/pool config, NOT a
 * retry loop around every query — a query that fails should fail loudly and
 * immediately (Layer 3 of the resilience architecture: "editing may fail
 * loudly"), not silently retry and hide a real outage from the MCP caller.
 * Retry-with-backoff for the cases that DO want it (a health check or the
 * startup cache warm deciding "is Postgres reachable yet") lives in
 * `pingDatabase` below instead, as a deliberately separate, opt-in helper.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is not set. Copy .env.example to .env and adjust it.');
}

// A single shared connection pool for the process's lifetime.
const client = postgres(connectionString, {
	// Fail a connection attempt after this many seconds instead of hanging
	// indefinitely (postgres.js default: no timeout at all).
	connect_timeout: 10,
	// Close an idle pooled connection after this many seconds so a quiet
	// period doesn't hold sockets open against Postgres/Railway forever.
	idle_timeout: 30,
	// Hard cap on concurrent connections this one process will open. This is
	// a single small site (Moco), not a high-concurrency API — 10 is ample
	// headroom above expected load and keeps one runaway process from
	// starving Postgres's own connection limit.
	max: 10,
	// Recycle a connection after 30 minutes even if it's been continuously
	// useful, so a connection sitting behind a load balancer/proxy that
	// silently times out long-lived TCP sessions never gets a chance to look
	// "healthy" to postgres.js while actually being dead.
	max_lifetime: 60 * 30
});

export const db = drizzle(client, { schema });

/**
 * Best-effort "is Postgres reachable right now" check with a few quick
 * retries, used by the health endpoint (`/api/health`) and the startup cache
 * warm — NOT by ordinary request/tool code paths, which must fail on the
 * first real error rather than silently retrying (see the file header).
 *
 * Each attempt is additionally raced against its own short timeout, NOT
 * just left to `connect_timeout`: `connect_timeout` only bounds opening a
 * BRAND NEW connection — a query dispatched on an already-established
 * pooled connection whose other end just disappeared (the exact shape of
 * "Postgres container was stopped mid-session") can sit waiting on a dead
 * socket for however long the OS takes to notice, which is not bounded by
 * `connect_timeout` at all. Without this, a health check or the startup
 * warm could hang far longer than a visitor-facing check is allowed to.
 */
export async function pingDatabase(
	opts: { retries?: number; backoffMs?: number; attemptTimeoutMs?: number } = {}
): Promise<boolean> {
	const retries = opts.retries ?? 2;
	const backoffMs = opts.backoffMs ?? 75;
	const attemptTimeoutMs = opts.attemptTimeoutMs ?? 3000;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await Promise.race([
				client`select 1`,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('pingDatabase attempt timed out')), attemptTimeoutMs)
				)
			]);
			return true;
		} catch {
			if (attempt === retries) return false;
			await new Promise((resolve) => setTimeout(resolve, backoffMs * 2 ** attempt));
		}
	}
	return false;
}
