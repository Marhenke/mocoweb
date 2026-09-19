import type { PageServerLoad } from './$types';
import {
	getEstudioHero,
	getValues,
	getEstudioServices,
	getProcessSteps,
	getTeam,
	getContactCta
} from '$lib/server/cms/content';

export const load: PageServerLoad = async ({ locals }) => {
	const opts = { draft: locals.preview };
	const [estudioHero, values, services, process, team, contactCta] = await Promise.all([
		getEstudioHero(opts),
		getValues(opts),
		getEstudioServices(opts),
		getProcessSteps(opts),
		getTeam(opts),
		getContactCta(opts)
	]);

	return { estudioHero, values, services, process, team, contactCta };
};
