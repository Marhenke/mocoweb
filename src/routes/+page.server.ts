import type { PageServerLoad } from './$types';
import { getHomeHero, getStatement, getHomeServices, getProjects, getContactCta } from '$lib/server/cms/content';

export const load: PageServerLoad = async ({ locals }) => {
	const opts = { draft: locals.preview };
	const [homeHero, statement, homeServices, projects, contactCta] = await Promise.all([
		getHomeHero(opts),
		getStatement(opts),
		getHomeServices(opts),
		getProjects(opts),
		getContactCta(opts)
	]);

	return { homeHero, statement, homeServices, projects, contactCta };
};
