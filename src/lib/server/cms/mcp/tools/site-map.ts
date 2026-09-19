import { siteRoutes } from '$lib/content.schema';
import { getCollection } from '../collections';
import { textResult, type ToolDefinition } from '../types';

export const getSiteMapTool: ToolDefinition = {
	name: 'get_site_map',
	description:
		'Returns every route this site has. For each route: its URL pattern, what the page is, and the content ' +
		'regions it renders — and for each region, which collection governs it. This is the starting point for ' +
		'any task phrased in terms of a page ("fix the typo on the homepage", "add a project"): find the route, ' +
		"find the region, read `collection`, then call describe_collection(collection) for that region's full " +
		'schema. A region\'s `collectionKind` tells you whether to use list_entries (kind "list", many entries, ' +
		'each with its own slug) or get_entry with no slug (kind "singleton", exactly one entry). The same ' +
		'collection can govern regions on more than one route (e.g. `projects` backs the home preview, /trabajos, ' +
		'and /trabajos/{slug}; `contactCta` backs a shared band on three pages) — editing that collection changes ' +
		'every route that lists it here.',
	scope: 'read',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	handler: async () => {
		const routes = siteRoutes.map((route) => ({
			pattern: route.pattern,
			label: route.label,
			description: route.description,
			regions: route.regions.map((region) => {
				const collection = getCollection(region.collection);
				return {
					region: region.region,
					collection: region.collection,
					collectionKind: collection?.kind ?? 'unknown',
					note: region.note
				};
			})
		}));
		return textResult({ routes });
	}
};
