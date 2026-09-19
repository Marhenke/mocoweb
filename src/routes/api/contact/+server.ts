/**
 * The contact form's submission endpoint (Lane B4) — the first anonymous
 * WRITE path into this system; until now visitors only ever read. Replaces
 * the old `mailto:` link, which silently lost an inquiry on any device with
 * no mail client configured (most phones, most of the time).
 *
 * ── Storage is the source of truth, email is the notification ───────────
 * The inquiry is written to Postgres FIRST. Only once that succeeds do we
 * attempt a best-effort notification email (`notify/email.ts`, which never
 * throws) — a broken/misconfigured mail provider can never lose a message
 * or turn a real submission into a visible failure, only delay the owner
 * noticing it in their inbox (they can still list unread inquiries over
 * MCP). This ordering is the whole point of this lane's Part 1.
 *
 * ── Graceful degradation ─────────────────────────────────────────────────
 * If Postgres itself is unreachable, storing throws. That is caught here
 * and turned into a 503 with a plain-language message AND the studio's
 * email address, so a visitor is never left with a silent failure or a raw
 * error — they get a concrete alternative right in the same form. This
 * mirrors the rest of the site's "storage down ≠ visitor stuck" posture
 * (see `hooks.server.ts`/`health.ts`), applied to the one route that can't
 * fall back to a cached response because it's a write.
 *
 * ── This route is genuinely dynamic ──────────────────────────────────────
 * Registered in `content.schema.ts`'s `siteRoutes` as `caching: 'dynamic'`
 * (Lane B2's field, used here for the first time for real) — a per-visitor
 * POST with no shared response to cache. In practice `hooks.server.ts`
 * already never touches the page cache for a non-GET request regardless of
 * that classification (see its own `method !== 'GET'` guard), so this is
 * belt-and-suspenders: `isKnownRoutePath`/`routesForCollection` correctly
 * treat this path as invisible to caching/regeneration by construction, not
 * by every future contributor remembering the method check.
 *
 * ── Attack-surface hardening ──────────────────────────────────────────────
 * Rate-limited per (hashed) IP, a honeypot field that silently no-ops
 * without tipping off the bot, and strict length-bounded validation on
 * every field (`contact/validate.ts`). No CAPTCHA — a third-party
 * dependency and bad UX for exactly the visitors most likely to be on a
 * slow connection.
 */

import { json } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/server/cms/auth/rate-limit';
import { hashIp } from '$lib/server/cms/contact/ip-hash';
import { contactSubmissionSchema, isHoneypotTriggered } from '$lib/server/cms/contact/validate';
import { createInquiry, markNotified } from '$lib/server/cms/contact/store';
import { sendInquiryNotification } from '$lib/server/cms/notify/email';
import type { RequestHandler } from './$types';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

const FALLBACK_EMAIL = 'mocoestudiocreativo@gmail.com';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'invalid_request', message: 'Solicitud inválida.' }, { status: 400 });
	}

	// Honeypot: a real visitor never sees or fills this field. Pretend
	// success without touching the database or sending anything — a bot
	// that gets a 4xx here just learns to try a different field name.
	if (isHoneypotTriggered(body)) {
		return json({ ok: true });
	}

	const ipHash = hashIp(getClientAddress());
	const rateLimit = checkRateLimit(`contact:${ipHash}`, {
		windowMs: RATE_LIMIT_WINDOW_MS,
		maxAttempts: RATE_LIMIT_MAX_ATTEMPTS
	});
	if (!rateLimit.allowed) {
		return json(
			{
				ok: false,
				error: 'rate_limited',
				message: 'Demasiados intentos. Esperá unos minutos antes de volver a escribirnos.'
			},
			{ status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds ?? 60) } }
		);
	}

	const parsed = contactSubmissionSchema.safeParse(body);
	if (!parsed.success) {
		const message = parsed.error.issues[0]?.message ?? 'Datos inválidos.';
		return json({ ok: false, error: 'invalid_fields', message }, { status: 400 });
	}

	let inquiry;
	try {
		inquiry = await createInquiry({
			name: parsed.data.name,
			email: parsed.data.email,
			message: parsed.data.message,
			ipHash
		});
	} catch (err) {
		// Postgres unreachable (or any other storage failure): never a silent
		// failure, never a raw error — a clear message plus a working
		// fallback (the studio's own email address) right in the response.
		console.error(
			JSON.stringify({
				at: 'api/contact:POST',
				error: err instanceof Error ? err.message : String(err)
			})
		);
		return json(
			{
				ok: false,
				error: 'storage_unavailable',
				message:
					'El formulario no está disponible en este momento. Escribinos directamente a ' +
					`${FALLBACK_EMAIL} y te respondemos igual.`,
				fallbackEmail: FALLBACK_EMAIL
			},
			{ status: 503 }
		);
	}

	// The inquiry is safely stored. Everything below is best-effort
	// notification — its outcome never changes the response the visitor
	// gets.
	const sendResult = await sendInquiryNotification(inquiry);
	if (sendResult.sent) {
		await markNotified(inquiry.id);
	}

	return json({ ok: true });
};
