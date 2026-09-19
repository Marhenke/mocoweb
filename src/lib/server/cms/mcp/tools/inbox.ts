/**
 * Contact-form inbox tools (Lane B4) — the ONLY tools in this server gated
 * behind `inbox` scope rather than the read/write/publish content ladder.
 * Inquiries contain a real visitor's name, email, and message; an agent
 * trusted to edit or even publish site copy must not automatically be able
 * to read every visitor's correspondence — see `auth/scope.ts`'s header
 * comment for the full reasoning. A content-scoped token (even `publish`)
 * is refused here with a 403 naming "inbox" as the missing scope; only a
 * token whose grant explicitly includes "inbox" succeeds.
 */

import { listInquiries, getInquiryById, setInquiryStatus } from '../../contact/store';
import { textResult, type ToolDefinition } from '../types';

function serializeInquiry(row: Awaited<ReturnType<typeof getInquiryById>>) {
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		message: row.message,
		status: row.status,
		notified: row.notifiedAt !== null,
		createdAt: row.createdAt.toISOString()
	};
}

export const listInquiriesTool: ToolDefinition = {
	name: 'list_inquiries',
	description:
		'Lists contact-form submissions from site visitors, newest first. Each one has a name, email, message, ' +
		'`status` ("unread" or "read"), whether the owner\'s notification email for it was sent (`notified`), and ' +
		'when it arrived. Use `status: "unread"` to answer "read me the new messages" / "any new inquiries?" — ' +
		'use `status: "all"` for a fuller history. This is real personal data from real people who contacted the ' +
		'studio; requires "inbox" scope, a separate grant from ordinary content read/write/publish access.',
	scope: 'inbox',
	inputSchema: {
		type: 'object',
		properties: {
			status: {
				type: 'string',
				enum: ['all', 'unread', 'read'],
				description: 'Filter by read status. Defaults to "all".'
			},
			limit: {
				type: 'number',
				description: 'Maximum number of inquiries to return (1-200). Defaults to 50.'
			}
		},
		additionalProperties: false
	},
	handler: async (args) => {
		const status =
			args.status === 'unread' || args.status === 'read' || args.status === 'all'
				? args.status
				: 'all';
		const limit = typeof args.limit === 'number' ? args.limit : undefined;
		const rows = await listInquiries({ status, limit });
		return textResult({ status, count: rows.length, inquiries: rows.map(serializeInquiry) });
	}
};

export const getInquiryTool: ToolDefinition = {
	name: 'get_inquiry',
	description:
		'Reads one contact-form submission in full by its id (from list_inquiries). Does NOT mark it read — call ' +
		'mark_inquiry_read explicitly for that, so reading and acknowledging stay two separate, intentional ' +
		'actions. Requires "inbox" scope.',
	scope: 'inbox',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', description: "The inquiry's id (uuid), from list_inquiries." }
		},
		required: ['id'],
		additionalProperties: false
	},
	handler: async (args) => {
		const id = String(args.id ?? '');
		const row = await getInquiryById(id);
		if (!row) {
			return textResult(`No inquiry found with id "${id}". Call list_inquiries to see what exists.`, true);
		}
		return textResult(serializeInquiry(row));
	}
};

export const markInquiryReadTool: ToolDefinition = {
	name: 'mark_inquiry_read',
	description:
		'Marks a contact-form submission as read (or, with `read: false`, back to unread — e.g. to flag one for ' +
		'follow-up later). This only changes `status`; it never modifies the inquiry\'s own content. Requires ' +
		'"inbox" scope.',
	scope: 'inbox',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'string', description: "The inquiry's id (uuid), from list_inquiries." },
			read: {
				type: 'boolean',
				description: 'True (default) to mark read; false to mark unread again.'
			}
		},
		required: ['id'],
		additionalProperties: false
	},
	handler: async (args) => {
		const id = String(args.id ?? '');
		const read = args.read === false ? false : true;
		const row = await setInquiryStatus(id, read ? 'read' : 'unread');
		if (!row) {
			return textResult(`No inquiry found with id "${id}". Call list_inquiries to see what exists.`, true);
		}
		return textResult(serializeInquiry(row));
	}
};

export const inboxTools: ToolDefinition[] = [listInquiriesTool, getInquiryTool, markInquiryReadTool];
