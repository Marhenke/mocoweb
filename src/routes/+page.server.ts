import type { PageServerLoad } from './$types';
import { getHomeHero, getStatement, getHomeServices, getProjects, getContactCta } from '$lib/server/cms/content';
import { organizationJsonLd } from '$lib/server/cms/discovery/jsonld';

export const load: PageServerLoad = async ({ locals, url }) => {
	const opts = { draft: locals.preview };
	const [homeHero, statement, homeServices, projects, contactCta] = await Promise.all([
		getHomeHero(opts),
		getStatement(opts),
		getHomeServices(opts),
		getProjects(opts),
		getContactCta(opts)
	]);

	// Lane B1: the root page carries a discoverable pointer to the MCP
	// endpoint (a <link rel> in <svelte:head>, see +page.svelte) as one of
	// several deliberately redundant discovery paths — see
	// src/hooks.server.ts's Link header for the HTTP-header equivalent, also
	// only on "/". Built from the real request origin, same convention as
	// every other self-referencing URL in this engine.
	const mcpUrl = `${url.origin}/api/mcp`;

	// schema.org Organization JSON-LD (Lane B1), pre-serialized here (a
	// server-only module) rather than imported into the .svelte component,
	// which would cross SvelteKit's server-only import boundary.
	// `</`.replace guards against a content string containing a literal
	// "</script>" prematurely closing this inline script tag.
	const organizationJsonLdJson = JSON.stringify(
		organizationJsonLd({ origin: url.origin, contactCta })
	).replaceAll('</', '<\\/');

	return {
		homeHero,
		statement,
		homeServices,
		projects,
		contactCta,
		mcpUrl,
		organizationJsonLd: organizationJsonLdJson
	};
};
