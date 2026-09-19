import type { PageServerLoad } from './$types';
import { getContactoHero, getContactMethods } from '$lib/server/cms/content';

export const load: PageServerLoad = async ({ locals }) => {
	const opts = { draft: locals.preview };
	const [contactoHero, methods] = await Promise.all([
		getContactoHero(opts),
		getContactMethods(opts)
	]);

	return { contactoHero, methods };
};
