import type { PageServerLoad } from './$types';
import {
	getEstudioHero,
	getValues,
	getEstudioServices,
	getProcessSteps,
	getTeam,
	getContactCta
} from '$lib/server/cms/content';

export const load: PageServerLoad = async () => {
	const [estudioHero, values, services, process, team, contactCta] = await Promise.all([
		getEstudioHero(),
		getValues(),
		getEstudioServices(),
		getProcessSteps(),
		getTeam(),
		getContactCta()
	]);

	return { estudioHero, values, services, process, team, contactCta };
};
