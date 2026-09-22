/**
 * Lane B8 — hands the root layout (`+layout.svelte`) whether THIS request is
 * a validated preview render (`event.locals.preview`, set in
 * `hooks.server.ts` from a signed `?__preview=<token>`), so it can show the
 * persistent "estás viendo una vista previa" banner with an explicit way
 * out. Deliberately reads `locals.preview` (server-validated) rather than
 * just checking whether the URL happens to carry a `__preview` param client-
 * side — an invalid/expired token must never show the banner (or draft
 * content), exactly like it must never actually render drafts; see
 * `hooks.server.ts`'s preview branch.
 */
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	return { preview: locals.preview };
};
