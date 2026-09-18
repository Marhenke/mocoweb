import type { PageServerLoad } from './$types';
import { getContactoHero, getContactMethods } from '$lib/server/cms/content';

export const load: PageServerLoad = async () => {
	const [contactoHero, methods] = await Promise.all([getContactoHero(), getContactMethods()]);

	return { contactoHero, methods };
};
