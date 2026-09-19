/**
 * Not a real content endpoint. This exists solely so Lane A6 can prove
 * `requireAuth` end-to-end over HTTP before Lane A7's real MCP endpoint
 * exists to protect. GET requires "read" scope, POST requires "write"
 * scope — exactly the pattern A7 should copy: call `requireAuth`, return
 * its Response immediately if it gives you one, otherwise trust the
 * returned `{ clientId, clientName, scope }`.
 *
 * Safe to delete once A7 lands a real protected endpoint that exercises the
 * same guard.
 */

import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/cms/auth/require-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'read');
	if (auth instanceof Response) return auth;
	return json({ ok: true, operation: 'read', clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope });
};

export const POST: RequestHandler = async ({ request }) => {
	const auth = await requireAuth(request, 'write');
	if (auth instanceof Response) return auth;
	return json({ ok: true, operation: 'write', clientId: auth.clientId, clientName: auth.clientName, scope: auth.scope });
};
