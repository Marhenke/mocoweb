import { error } from '@sveltejs/kit';
import { projects, getProject } from '$lib/data/projects';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	const project = getProject(params.slug);
	if (!project) error(404, 'No encontramos ese proyecto');

	const index = projects.findIndex((p) => p.slug === params.slug);
	const next = projects[(index + 1) % projects.length];

	return { project, next };
};
