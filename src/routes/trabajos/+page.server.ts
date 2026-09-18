import type { PageServerLoad } from './$types';
import { getTrabajosHeader, getProjects, getContactCta } from '$lib/server/cms/content';

export const load: PageServerLoad = async () => {
	const [trabajosHeader, projects, contactCta] = await Promise.all([
		getTrabajosHeader(),
		getProjects(),
		getContactCta()
	]);

	return { trabajosHeader, projects, contactCta };
};
