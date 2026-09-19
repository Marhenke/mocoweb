/**
 * Server-only content read path for the Moco site.
 *
 * This is the ONLY place a route's `load` function should reach for site
 * content. By default every function here reads the `published_data` column
 * (see `entries.publishedData` in ./db/schema.ts) for entries that have
 * actually been published, ordered by `entries.publishedPosition` — the
 * frozen, publish-time live order, never `entries.position` (the draft
 * order an agent can reorder at will) and never insertion order. Nothing
 * here imports `src/lib/data/projects.ts` or any hardcoded <script>
 * content; that content is now dead weight kept around for a future cleanup
 * lane, not a fallback.
 *
 * Every getter also accepts an optional `{ draft: true }` — Lane A8's
 * preview mode (see `src/hooks.server.ts` and the `preview_url` MCP tool).
 * In draft mode, reads come from `data` (the working draft) ordered by
 * `position` (the draft order), and an entry flagged `pendingDelete` is
 * excluded — preview is meant to show what the site will look like AFTER
 * the next publish, not the intermediate bookkeeping state.
 *
 * Lives under `src/lib/server/`, SvelteKit's server-only import boundary, so
 * the `db` client it wraps (and the DATABASE_URL it holds) can never end up
 * in a client bundle.
 */

import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
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

export interface ReadOpts {
	/** True to read the DRAFT state instead of what's live. Lane A8 preview mode. */
	draft?: boolean;
}

async function fetchList<T>(
	collectionKey: string,
	opts: ReadOpts = {}
): Promise<{ slug: string; data: T }[]> {
	if (opts.draft) {
		const rows = await db
			.select({ slug: entries.slug, data: entries.data })
			.from(entries)
			.where(and(eq(entries.collectionKey, collectionKey), ne(entries.pendingDelete, true)))
			.orderBy(asc(entries.position));
		return rows.map((row) => ({ slug: row.slug, data: row.data as T }));
	}
	const rows = await db
		.select({ slug: entries.slug, data: entries.publishedData })
		.from(entries)
		.where(and(eq(entries.collectionKey, collectionKey), isNotNull(entries.publishedData)))
		.orderBy(asc(entries.publishedPosition));
	return rows.map((row) => ({ slug: row.slug, data: row.data as T }));
}

async function fetchSingleton<T>(collectionKey: string, opts: ReadOpts = {}): Promise<T> {
	const rows = await fetchList<T>(collectionKey, opts);
	if (rows.length !== 1) {
		throw new Error(
			`Expected exactly 1 ${opts.draft ? 'draft' : 'published'} entry for singleton collection "${collectionKey}", found ${rows.length}.`
		);
	}
	return rows[0].data;
}

// ---------------------------------------------------------------------------
// Projects (list; slug is the entry's identity, not part of its data)
// ---------------------------------------------------------------------------

export async function getProjects(opts: ReadOpts = {}): Promise<Project[]> {
	const rows = await fetchList<ProjectInput>('projects', opts);
	return rows.map((row) => ({ slug: row.slug, ...row.data }));
}

/**
 * Fetches a project by slug together with the "next" project, wrapping
 * around at the end of the list. Ordering (and therefore what "next" means)
 * comes from getProjects() above — draft order in preview, live order
 * otherwise — this preserves the original
 * `src/routes/trabajos/[slug]/+page.ts` logic exactly, just backed by DB
 * order instead of the hardcoded array's order.
 */
export async function getProjectWithNext(
	slug: string,
	opts: ReadOpts = {}
): Promise<{ project: Project; next: Project } | undefined> {
	const projects = await getProjects(opts);
	const index = projects.findIndex((p) => p.slug === slug);
	if (index === -1) return undefined;
	return { project: projects[index], next: projects[(index + 1) % projects.length] };
}

// ---------------------------------------------------------------------------
// Simple ordered lists (the UI never needs the entry's slug)
// ---------------------------------------------------------------------------

export async function getValues(opts: ReadOpts = {}): Promise<Value[]> {
	return (await fetchList<Value>('values', opts)).map((r) => r.data);
}

export async function getProcessSteps(opts: ReadOpts = {}): Promise<ProcessStep[]> {
	return (await fetchList<ProcessStep>('process', opts)).map((r) => r.data);
}

export async function getHomeServices(opts: ReadOpts = {}): Promise<HomeService[]> {
	return (await fetchList<HomeService>('homeServices', opts)).map((r) => r.data);
}

export async function getEstudioServices(opts: ReadOpts = {}): Promise<EstudioService[]> {
	return (await fetchList<EstudioService>('estudioServices', opts)).map((r) => r.data);
}

export async function getTeam(opts: ReadOpts = {}): Promise<TeamMember[]> {
	return (await fetchList<TeamMember>('team', opts)).map((r) => r.data);
}

export async function getContactMethods(opts: ReadOpts = {}): Promise<ContactMethod[]> {
	return (await fetchList<ContactMethod>('contactMethods', opts)).map((r) => r.data);
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

export const getHomeHero = (opts: ReadOpts = {}) => fetchSingleton<HomeHero>('homeHero', opts);
export const getStatement = (opts: ReadOpts = {}) => fetchSingleton<Statement>('statement', opts);
export const getEstudioHero = (opts: ReadOpts = {}) =>
	fetchSingleton<EstudioHero>('estudioHero', opts);
export const getContactoHero = (opts: ReadOpts = {}) =>
	fetchSingleton<ContactoHero>('contactoHero', opts);
export const getTrabajosHeader = (opts: ReadOpts = {}) =>
	fetchSingleton<PageHeaderContent>('trabajosHeader', opts);
export const getContactCta = (opts: ReadOpts = {}) =>
	fetchSingleton<ContactCta>('contactCta', opts);
