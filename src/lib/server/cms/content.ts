/**
 * Server-only content read path for the Moco site.
 *
 * This is the ONLY place a route's `load` function should reach for site
 * content. Every function here reads the `published_data` column (see
 * `entries.publishedData` in ./db/schema.ts) for entries that have actually
 * been published, ordered by `entries.position` — never insertion order,
 * never a hardcoded array. Nothing here imports `src/lib/data/projects.ts`
 * or any hardcoded <script> content; that content is now dead weight kept
 * around for a future cleanup lane, not a fallback.
 *
 * Lives under `src/lib/server/`, SvelteKit's server-only import boundary, so
 * the `db` client it wraps (and the DATABASE_URL it holds) can never end up
 * in a client bundle.
 */

import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { db } from './db/client';
import { entries } from './db/schema';
import type { ProjectInput } from '$lib/content.schema';
import type {
	Project,
	Value,
	ProcessStep,
	TeamMember,
	ContactMethod,
	HomeHero,
	Statement,
	EstudioHero,
	ContactoHero,
	PageHeaderContent,
	ContactCta,
	HomeService,
	EstudioService
} from '$lib/types';

async function fetchPublishedList<T>(collectionKey: string): Promise<{ slug: string; data: T }[]> {
	const rows = await db
		.select({ slug: entries.slug, data: entries.publishedData })
		.from(entries)
		.where(and(eq(entries.collectionKey, collectionKey), isNotNull(entries.publishedData)))
		.orderBy(asc(entries.position));
	return rows.map((row) => ({ slug: row.slug, data: row.data as T }));
}

async function fetchPublishedSingleton<T>(collectionKey: string): Promise<T> {
	const rows = await fetchPublishedList<T>(collectionKey);
	if (rows.length !== 1) {
		throw new Error(
			`Expected exactly 1 published entry for singleton collection "${collectionKey}", found ${rows.length}.`
		);
	}
	return rows[0].data;
}

// ---------------------------------------------------------------------------
// Projects (list; slug is the entry's identity, not part of its data)
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
	const rows = await fetchPublishedList<ProjectInput>('projects');
	return rows.map((row) => ({ slug: row.slug, ...row.data }));
}

/**
 * Fetches a project by slug together with the "next" project, wrapping
 * around at the end of the list. Ordering (and therefore what "next" means)
 * comes from `entries.position` via getProjects() — this preserves the
 * original `src/routes/trabajos/[slug]/+page.ts` logic exactly, just backed
 * by DB order instead of the hardcoded array's order.
 */
export async function getProjectWithNext(
	slug: string
): Promise<{ project: Project; next: Project } | undefined> {
	const projects = await getProjects();
	const index = projects.findIndex((p) => p.slug === slug);
	if (index === -1) return undefined;
	return { project: projects[index], next: projects[(index + 1) % projects.length] };
}

// ---------------------------------------------------------------------------
// Simple ordered lists (the UI never needs the entry's slug)
// ---------------------------------------------------------------------------

export async function getValues(): Promise<Value[]> {
	return (await fetchPublishedList<Value>('values')).map((r) => r.data);
}

export async function getProcessSteps(): Promise<ProcessStep[]> {
	return (await fetchPublishedList<ProcessStep>('process')).map((r) => r.data);
}

export async function getHomeServices(): Promise<HomeService[]> {
	return (await fetchPublishedList<HomeService>('homeServices')).map((r) => r.data);
}

export async function getEstudioServices(): Promise<EstudioService[]> {
	return (await fetchPublishedList<EstudioService>('estudioServices')).map((r) => r.data);
}

export async function getTeam(): Promise<TeamMember[]> {
	return (await fetchPublishedList<TeamMember>('team')).map((r) => r.data);
}

export async function getContactMethods(): Promise<ContactMethod[]> {
	return (await fetchPublishedList<ContactMethod>('contactMethods')).map((r) => r.data);
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

export const getHomeHero = () => fetchPublishedSingleton<HomeHero>('homeHero');
export const getStatement = () => fetchPublishedSingleton<Statement>('statement');
export const getEstudioHero = () => fetchPublishedSingleton<EstudioHero>('estudioHero');
export const getContactoHero = () => fetchPublishedSingleton<ContactoHero>('contactoHero');
export const getTrabajosHeader = () => fetchPublishedSingleton<PageHeaderContent>('trabajosHeader');
export const getContactCta = () => fetchPublishedSingleton<ContactCta>('contactCta');
