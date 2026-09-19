/**
 * Thin route wrapper (Lane B2) — all logic lives in
 * `$lib/server/cms/health.ts` (generic engine code, see its header) so this
 * file is the only Moco-specific-location bit: where SvelteKit requires the
 * route to physically live, and what `railway.json`'s `healthcheckPath`
 * points at.
 */

import { json } from '@sveltejs/kit';
import { checkHealth } from '$lib/server/cms/health';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const result = await checkHealth();
	return json(result, { status: result.httpStatus });
};
