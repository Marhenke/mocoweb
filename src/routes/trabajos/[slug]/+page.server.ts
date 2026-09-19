import { error } from '@sveltejs/kit';
import { getProjectWithNext } from '$lib/server/cms/content';
import { projectCreativeWorkJsonLd } from '$lib/server/cms/discovery/jsonld';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const result = await getProjectWithNext(params.slug, { draft: locals.preview });
	if (!result) error(404, 'No encontramos ese proyecto');

	// schema.org CreativeWork JSON-LD (Lane B1) — pre-serialized here (a
	// server-only module) rather than imported into the .svelte component,
	// which would cross SvelteKit's server-only import boundary. `</`
	// guards against a content string containing a literal "</script>"
	// prematurely closing this inline script tag.
	const creativeWorkJsonLd = JSON.stringify(
		projectCreativeWorkJsonLd({ origin: url.origin, project: result.project })
	).replaceAll('</', '<\\/');

	return { ...result, creativeWorkJsonLd };
};
