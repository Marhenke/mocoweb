import type { PageServerLoad } from './$types';
import { getHomeHero, getStatement, getHomeServices, getProjects, getContactCta } from '$lib/server/cms/content';

export const load: PageServerLoad = async () => {
	const [homeHero, statement, homeServices, projects, contactCta] = await Promise.all([
		getHomeHero(),
		getStatement(),
		getHomeServices(),
		getProjects(),
		getContactCta()
	]);

	return { homeHero, statement, homeServices, projects, contactCta };
};
