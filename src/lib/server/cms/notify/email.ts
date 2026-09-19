/**
 * Outbound transactional email (Lane B4), used today for exactly one thing:
 * notifying the site owner that a new contact-form inquiry arrived.
 *
 * ── Provider: Resend ─────────────────────────────────────────────────────
 * Chosen (see the Lane B4 report for the full comparison) because: a free
 * tier that realistically covers several small client sites (3,000
 * emails/month, 100/day — a portfolio contact form will never get close);
 * setup simple enough for a non-technical designer (sign up, copy one API
 * key into an env var — no SMTP config, no server to run); and no lock-in
 * (a plain HTTPS POST with a bearer token, isolated to this one file — a
 * future provider swap touches only `sendViaResend` below, nothing that
 * calls `sendInquiryNotification`).
 *
 * ── Why no DNS setup is required for THIS use case ──────────────────────
 * Resend's shared sandbox sender (`onboarding@resend.dev`) is restricted to
 * delivering only to the email address of the Resend account itself — this
 * is normally a blocker for sending to real visitors, but Moco's contact
 * form only ever notifies the STUDIO'S OWN inbox
 * (`mocoestudiocreativo@gmail.com`). If the studio signs up for Resend
 * using that same address, the sandbox sender delivers with ZERO DNS
 * records — no SPF/DKIM/CNAME, nothing a non-technical designer could get
 * stuck on. This only holds because the recipient is fixed and is the
 * account owner; sending to any OTHER address (a different studio inbox, a
 * future "reply to visitor" feature) requires verifying a real domain the
 * studio owns, which DOES need DNS records the designer likely cannot set
 * up alone — see NOTIFY_FROM_EMAIL below and the Lane B4 report.
 *
 * ── Isolation from the storage path ──────────────────────────────────────
 * This module is only ever called AFTER an inquiry is durably stored (see
 * `src/routes/contacto/+server.ts`). Every function here is best-effort:
 * failures are caught, logged, and returned as `false` — never thrown —
 * so a broken/missing API key degrades to "the owner checks the inbox
 * later" instead of losing the visitor's message or their success page.
 */

import type { InquiryRow } from '../contact/store';

const RESEND_API_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 5000;

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

interface SendResult {
	sent: boolean;
	reason?: string;
}

/**
 * Provider-specific: the only function that knows this is Resend. Swapping
 * providers later means rewriting this one function's body, nothing else.
 */
async function sendViaResend(params: {
	to: string;
	from: string;
	subject: string;
	html: string;
	text: string;
}): Promise<SendResult> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		return { sent: false, reason: 'RESEND_API_KEY is not set.' };
	}

	try {
		const response = await fetch(RESEND_API_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: params.from,
				to: [params.to],
				subject: params.subject,
				html: params.html,
				text: params.text
			}),
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			return { sent: false, reason: `Resend responded ${response.status}: ${body.slice(0, 300)}` };
		}
		return { sent: true };
	} catch (err) {
		return { sent: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Notifies the studio owner of a new inquiry. Storage (see
 * `contact/store.ts`) is the source of truth and has already succeeded by
 * the time this is called — this can fail silently (missing/invalid API
 * key, Resend outage, network issue) with no effect on the visitor's
 * experience or the stored data. Always resolves, never throws.
 */
export async function sendInquiryNotification(inquiry: InquiryRow): Promise<SendResult> {
	const to = process.env.NOTIFY_TO_EMAIL || 'mocoestudiocreativo@gmail.com';
	// Defaults to Resend's zero-setup sandbox sender, which only works
	// because `to` above is the studio's own address (see this file's header
	// comment). A studio that wants a branded "from" address instead sets
	// NOTIFY_FROM_EMAIL to one on a domain verified in Resend.
	const from = process.env.NOTIFY_FROM_EMAIL || 'Moco Web <onboarding@resend.dev>';

	const subject = `Nuevo mensaje de contacto: ${inquiry.name}`;
	const text =
		`Nombre: ${inquiry.name}\n` +
		`Email: ${inquiry.email}\n\n` +
		`Mensaje:\n${inquiry.message}\n\n` +
		`Recibido: ${inquiry.createdAt.toISOString()}`;
	const html =
		`<p><strong>Nombre:</strong> ${escapeHtml(inquiry.name)}</p>` +
		`<p><strong>Email:</strong> ${escapeHtml(inquiry.email)}</p>` +
		`<p><strong>Mensaje:</strong></p><p>${escapeHtml(inquiry.message).replaceAll('\n', '<br>')}</p>`;

	const result = await sendViaResend({ to, from, subject, html, text });
	if (!result.sent) {
		console.error(
			JSON.stringify({
				at: 'notify/email:sendInquiryNotification',
				inquiryId: inquiry.id,
				reason: result.reason
			})
		);
	}
	return result;
}
