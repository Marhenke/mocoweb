import { error } from '@sveltejs/kit';
import { getProjectWithNext } from '$lib/server/cms/content';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const result = await getProjectWithNext(params.slug, { draft: locals.preview });
	if (!result) error(404, 'No encontramos ese proyecto');

	return result;
};
