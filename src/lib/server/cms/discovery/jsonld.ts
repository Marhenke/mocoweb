/**
 * schema.org JSON-LD builders (Lane B1). Two shapes, matching what actually
 * earns rich results (unlike llms.txt, whose SEO value is unproven):
 *   - `organizationJsonLd`: the studio itself, on the home page.
 *   - `projectCreativeWorkJsonLd`: one CreativeWork per project, on its
 *     detail page.
 *
 * These are plain data builders (no fetch, no cache) — the page's own
 * `+page.server.ts` load already has the published content in hand from the
 * normal content.ts read path, so these just reshape it. Embedded directly
 * in each page's rendered HTML (a <script type="application/ld+json"> in
 * <svelte:head>), so they are automatically part of the same static-page
 * cache/regeneration as the rest of that page's HTML — no separate
 * invalidation path needed.
 */

import type { Project, ContactCta } from '$lib/types';

export interface OrganizationJsonLdInput {
	origin: string;
	contactCta: ContactCta;
}

export function organizationJsonLd({ origin, contactCta }: OrganizationJsonLdInput) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Organization',
		name: 'Moco',
		url: origin,
		description:
			'Moco — Estudio creativo. Branding, diseño y desarrollo web con personalidad.',
		email: contactCta.email,
		sameAs: [contactCta.instagramHref]
	};
}

export interface ProjectJsonLdInput {
	origin: string;
	project: Project;
}

export function projectCreativeWorkJsonLd({ origin, project }: ProjectJsonLdInput) {
	return {
		'@context': 'https://schema.org',
		'@type': 'CreativeWork',
		name: project.title,
		url: `${origin}/trabajos/${project.slug}`,
		description: project.summary,
		image: project.cover ? `${origin}${project.cover}` : `${origin}${project.bg}`,
		datePublished: project.year,
		creator: {
			'@type': 'Organization',
			name: 'Moco',
			url: origin
		},
		about: project.client,
		keywords: project.services.join(', ')
	};
}
