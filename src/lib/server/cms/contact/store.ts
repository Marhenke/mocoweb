/**
 * DB-backed operations on the `inquiries` table (Lane B4). This is the
 * source of truth for a contact-form submission — see `+server.ts`'s doc
 * comment for why storage happens before, and independently of, the
 * notification email.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { inquiries } from '../db/schema';

export interface NewInquiry {
	name: string;
	email: string;
	message: string;
	ipHash: string | null;
}

export interface InquiryRow {
	id: string;
	name: string;
	email: string;
	message: string;
	status: string;
	ipHash: string | null;
	notifiedAt: Date | null;
	createdAt: Date;
}

export async function createInquiry(input: NewInquiry): Promise<InquiryRow> {
	const [row] = await db
		.insert(inquiries)
		.values({
			name: input.name,
			email: input.email,
			message: input.message,
			ipHash: input.ipHash,
			status: 'unread'
		})
		.returning();
	return row;
}

/** Best-effort: records that the notification email was sent. Never throws — a failure here must not turn a stored inquiry into an apparent error. */
export async function markNotified(id: string): Promise<void> {
	try {
		await db.update(inquiries).set({ notifiedAt: new Date() }).where(eq(inquiries.id, id));
	} catch (err) {
		console.error(
			JSON.stringify({
				at: 'contact/store:markNotified',
				id,
				error: err instanceof Error ? err.message : String(err)
			})
		);
	}
}

export interface ListInquiriesOptions {
	status?: 'all' | 'unread' | 'read';
	limit?: number;
}

export async function listInquiries(opts: ListInquiriesOptions = {}): Promise<InquiryRow[]> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const status = opts.status ?? 'all';
	const where = status === 'all' ? undefined : eq(inquiries.status, status);
	const rows = await db
		.select()
		.from(inquiries)
		.where(where ? and(where) : undefined)
		.orderBy(desc(inquiries.createdAt))
		.limit(limit);
	return rows;
}

export async function getInquiryById(id: string): Promise<InquiryRow | null> {
	const rows = await db.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
	return rows[0] ?? null;
}

export async function setInquiryStatus(
	id: string,
	status: 'read' | 'unread'
): Promise<InquiryRow | null> {
	const [row] = await db
		.update(inquiries)
		.set({ status })
		.where(eq(inquiries.id, id))
		.returning();
	return row ?? null;
}
