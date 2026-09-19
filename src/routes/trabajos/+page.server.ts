import type { PageServerLoad } from './$types';
import { getTrabajosHeader, getProjects, getContactCta } from '$lib/server/cms/content';

export const load: PageServerLoad = async ({ locals }) => {
	const opts = { draft: locals.preview };
	const [trabajosHeader, projects, contactCta] = await Promise.all([
		getTrabajosHeader(opts),
		getProjects(opts),
		getContactCta(opts)
	]);

	return { trabajosHeader, projects, contactCta };
};
