/**
 * Fixed-window rate limiter, in-memory.
 *
 * This guards `POST /authorize` — per the design brief, "the only thing
 * standing between the internet and full content control." OWNER_KEY is 32
 * random bytes (see scripts/generate-owner-key.ts), so brute force is
 * infeasible regardless; this is defense in depth against someone hammering
 * the endpoint, not the primary defense.
 *
 * In-memory and per-process is a deliberate, scale-appropriate choice: this
 * engine targets a single small Railway service instance with no horizontal
 * scaling, so a shared store (Redis, etc.) would be infrastructure this
 * project doesn't otherwise need. If this engine is ever deployed with
 * multiple instances behind a load balancer, this limiter should move to a
 * shared store — each instance would otherwise enforce its own independent
 * budget.
 */

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
	allowed: boolean;
	retryAfterSeconds?: number;
}

export function checkRateLimit(
	key: string,
	{ windowMs = WINDOW_MS, maxAttempts = MAX_ATTEMPTS } = {}
): RateLimitResult {
	const now = Date.now();
	const bucket = buckets.get(key);

	if (!bucket || bucket.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { allowed: true };
	}

	if (bucket.count >= maxAttempts) {
		return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
	}

	bucket.count++;
	return { allowed: true };
}
