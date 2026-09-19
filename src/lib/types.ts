/**
 * Client-safe content types, derived from the Zod schemas in
 * `content.schema.ts` via `z.infer`.
 *
 * This file exists so Svelte components (which may end up in the client
 * bundle) can import content *types* without ever importing anything under
 * `src/lib/server/` — even a type-only import of a server module is one
 * mental hop too many given SvelteKit's server-only enforcement is meant to
 * be a hard boundary, not something contributors have to reason about import
 * kind to stay inside. `content.schema.ts` itself only depends on `zod`, so
 * this file (and everything that imports it) is guaranteed client-safe.
 *
 * `Project` adds `slug` on top of `projectSchema`'s shape because the slug is
 * the CMS entry's own identity (see the comment on `projectSchema` in
 * content.schema.ts), not a field inside the validated content — but every
 * component that renders a project (ProjectCard, the /trabajos/[slug] page)
 * needs it to build the project's URL.
 */

import type { z } from 'zod';
import type {
	projectSchema,
	valueSchema,
	processStepSchema,
	homeServiceSchema,
	estudioServiceSchema,
	teamMemberSchema,
	contactMethodSchema,
	homeHeroSchema,
	statementSchema,
	estudioHeroSchema,
	contactoHeroSchema,
	pageHeaderSchema,
	contactCtaSchema
} from './content.schema';

export type Project = z.infer<typeof projectSchema> & { slug: string };
export type Value = z.infer<typeof valueSchema>;
export type ProcessStep = z.infer<typeof processStepSchema>;
export type HomeService = z.infer<typeof homeServiceSchema>;
export type EstudioService = z.infer<typeof estudioServiceSchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type ContactMethod = z.infer<typeof contactMethodSchema>;
export type HomeHero = z.infer<typeof homeHeroSchema>;
export type Statement = z.infer<typeof statementSchema>;
export type EstudioHero = z.infer<typeof estudioHeroSchema>;
export type ContactoHero = z.infer<typeof contactoHeroSchema>;
export type PageHeaderContent = z.infer<typeof pageHeaderSchema>;
export type ContactCta = z.infer<typeof contactCtaSchema>;
