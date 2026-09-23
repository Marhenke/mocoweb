/**
 * The site's one "change set" card (Lane B7, redesigned in Lane B8) — a
 * plain-language summary of what's pending, which page(s) it affects, real
 * preview links, and Aprobar/Descartar. See `pending-changes.ts` for how the
 * conversation-level pending set (and the last-published snapshot, for
 * Deshacer) is tracked, and `routes/api/chat/+server.ts` /
 * `routes/api/chat/approve`, `.../discard`, `.../undo` for where this is
 * built and consumed.
 *
 * ── Lane B8: stop reconstructing "what changed" — show the real page ────
 * The B7 version of this card computed a field-by-field before/after diff
 * and pulled image THUMBNAILS out of that diff (`diffFields`/
 * `collectGalleryImages`, now removed) — including, for a gallery, always
 * showing the project's EXISTING cover/gallery images, never the newly
 * added one, because the diff heuristic only looked at top-level field
 * identity, not which array entry was actually new. The owner's own
 * feedback: the card showed a reconstruction of the change, and the
 * reconstruction was wrong — worse than showing nothing, because it invites
 * approving while looking at the wrong thing.
 *
 * This version builds exactly two things per entry instead: (1) `summary`,
 * one short plain-language sentence fragment naming what kind of change
 * happened (see `summarizeChange` below) — never a full before/after dump;
 * and (2) `pages`, the real signed preview links this entry affects (this
 * part is unchanged from B7). The UI (`PendingChangeBar.svelte`) renders the
 * ACTUAL page in a live iframe against one of those preview links — the
 * literal thing the visitor will see, not a picture assembled from field
 * values — so what the owner approves is what was really typed/uploaded,
 * never a guess.
 *
 * This is deliberately Moco-specific in one place (`FIELD_LABELS` below) —
 * same as `content.schema.ts` and `system-prompt.ts` already are per their
 * own header comments. A future client site edits this the same way.
 */

import { getCollection } from '../mcp/collections';
import { resolveEntry, type EntryRow } from '../mcp/entry-store';
import { routesForCollection } from '$lib/content.schema';
import { signPreviewToken, PREVIEW_QUERY_PARAM } from '../auth/preview-token';

export interface ChangeCardPage {
	pattern: string;
	label: string;
	/** Absolute URL, draft state, signed — what "Ver preview" (and the pinned bar's own thumbnail) render. Only set for routes that don't need a slug the entry doesn't have (always set in practice). */
	previewUrl: string | null;
}

export interface ChangeCardEntry {
	collection: string;
	slug: string | null;
	/** Human label for this entry, e.g. a project's title, or the collection's own display name for a singleton. */
	label: string;
	/** True if this entry has never been published before (a brand-new draft entry) — shown as "(nuevo)" rather than a diff, since there is no "before". */
	isNew: boolean;
	/** True if this change is a deletion (entry is `pendingDelete`) — shown as "se va a borrar". */
	isDeletion: boolean;
	/**
	 * One short, plain-language sentence fragment naming what changed —
	 * e.g. "se agregó 1 imagen a la galería", "se editó el título",
	 * "cambios en 3 campos". Deliberately NOT a field-by-field diff (see
	 * this file's header) — it names the KIND of change; the actual content
	 * is what the page thumbnail/preview shows, not this text.
	 */
	summary: string;
	pages: ChangeCardPage[];
	/**
	 * Captured only at approval time (see `routes/api/chat/approve`) — what
	 * `publishedData`/`publishedPosition`/`status` were immediately BEFORE
	 * this entry's publish, so "Deshacer" can restore exactly that. Absent
	 * on a still-pending (not yet approved) entry.
	 *
	 * `deletedRow` (Lane B9) is set ONLY when this approval published a
	 * PENDING DELETE — `publish` (`mcp/tools/publish.ts`) doesn't just
	 * change columns on a deletion, it `DELETE`s the row outright (see that
	 * tool's own doc comment: "the next publish call... is what actually
	 * removes the row"). Restoring `publishedData`/`publishedPosition`/
	 * `status` with a plain `UPDATE` is meaningless against a row that no
	 * longer exists, so "Deshacer" on a deletion needs the FULL row snapshot
	 * to re-`INSERT` instead — captured here, before the delete happens, and
	 * consumed by `restorePublishedSnapshot` in `mcp/tools/publish.ts`.
	 */
	approvedSnapshot?: {
		publishedData: unknown;
		publishedPosition: number | null;
		status: string;
		deletedRow?: Record<string, unknown> | null;
	} | null;
}

export interface ChangeCard {
	/**
	 * 'pending': awaiting Aprobar/Descartar. 'published': Aprobar succeeded,
	 * this card's entries are live (each carries `approvedSnapshot` for
	 * Deshacer) — see `pending-changes.ts`'s `getLastPublished`.
	 */
	status: 'pending' | 'published';
	entries: ChangeCardEntry[];
	publishedAt?: string;
}

/** A pending-set item — see `pending-changes.ts`. */
export interface PendingEntryRef {
	collection: string;
	slug: string | null;
}

// ---------------------------------------------------------------------------
// Human-readable field labels (Moco-specific)
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
	title: 'el título',
	headline: 'el título',
	headlineLines: 'el título grande',
	eyebrow: 'la etiqueta chica de arriba',
	category: 'la categoría',
	year: 'el año',
	client: 'el cliente',
	description: 'la descripción',
	intro: 'la intro',
	kicker: 'la etiqueta',
	punchline: 'la frase final',
	cover: 'la portada',
	text: 'el texto',
	name: 'el nombre',
	role: 'el rol',
	value: 'el valor',
	label: 'la etiqueta',
	href: 'el link',
	ctaLabel: 'el texto del botón',
	ctaHref: 'el link del botón',
	gallery: 'la galería'
};

function humanizeFieldKey(key: string): string {
	return FIELD_LABELS[key] ?? key.charAt(0).toLowerCase() + key.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase();
}

/** Counts every cell (image/video/gradient slot) across a gallery-shaped array of rows — best-effort, doesn't error on a non-gallery array, just returns 0. */
function countGalleryCells(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	let n = 0;
	for (const row of value) {
		if (Array.isArray(row)) n += row.length;
	}
	return n;
}

function pluralize(n: number, singular: string, plural: string): string {
	return n === 1 ? singular : plural;
}

/**
 * Builds the one-line, plain-language summary of what changed on an entry —
 * see this file's header for why this replaced a field-by-field diff.
 * Best-effort and deliberately coarse: it names the KIND of change (added/
 * removed media, which field), never the literal before/after values — the
 * page thumbnail is what shows the real content now.
 */
function summarizeChange(
	before: Record<string, unknown> | null,
	after: Record<string, unknown>,
	isNew: boolean,
	isDeletion: boolean
): string {
	// Lane B9 — deleting is destructive, so this summary has to be unmistakable
	// about what disappears (the brief's own words) rather than a generic
	// "changed" line — deliberately the ONLY summary that names the outcome
	// instead of the kind of edit, since "changed" and "about to be removed
	// entirely" are not the same risk level.
	if (isDeletion) return 'se va a eliminar — desaparece del sitio al aprobar';
	if (isNew || !before) return 'contenido nuevo';

	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	const changedFields: string[] = [];
	const parts: string[] = [];

	for (const key of keys) {
		const b = before[key];
		const a = after[key];
		if (JSON.stringify(b) === JSON.stringify(a)) continue;

		if (key === 'gallery') {
			const beforeCount = countGalleryCells(b);
			const afterCount = countGalleryCells(a);
			const diff = afterCount - beforeCount;
			if (diff > 0) {
				parts.push(`se agreg${pluralize(diff, 'ó', 'aron')} ${diff} ${pluralize(diff, 'imagen', 'imágenes')} a la galería`);
			} else if (diff < 0) {
				const removed = -diff;
				parts.push(`se quit${pluralize(removed, 'ó', 'aron')} ${removed} ${pluralize(removed, 'imagen', 'imágenes')} de la galería`);
			} else {
				parts.push('se actualizó la galería');
			}
			continue;
		}
		changedFields.push(key);
	}

	if (changedFields.length === 1) {
		parts.push(`se editó ${humanizeFieldKey(changedFields[0])}`);
	} else if (changedFields.length > 1) {
		parts.push(`cambios en ${changedFields.length} campos`);
	}

	if (parts.length === 0) return 'cambios preparados';
	return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Building one entry's card section
// ---------------------------------------------------------------------------

/** Human page names (Moco-specific, same spirit as `FIELD_LABELS` above) — never the raw route pattern shown to the person, only used internally as a fallback key. */
const PAGE_LABELS: Record<string, string> = {
	'/': 'Inicio',
	'/estudio': 'Estudio',
	'/contacto': 'Contacto',
	'/trabajos': 'Trabajos',
	'/trabajos/{slug}': 'la página del proyecto'
};

function pageLabel(pattern: string): string {
	return PAGE_LABELS[pattern] ?? pattern;
}

async function buildPages(
	origin: string,
	collectionKey: string,
	slug: string | null,
	isDeletion: boolean
): Promise<ChangeCardPage[]> {
	const token = signPreviewToken();
	const routes = routesForCollection(collectionKey);
	const out: ChangeCardPage[] = [];
	for (const route of routes) {
		if (route.dynamic && !slug) continue; // can't build a per-entry preview link without a slug
		// Lane B9 — a deleted entry's OWN dynamic page (e.g. `/trabajos/{slug}`)
		// is excluded from the draft read `content.ts` uses for preview
		// (`fetchList`'s `ne(entries.pendingDelete, true)`, same rule
		// `preview_url`'s own doc comment already states) — visiting it in
		// preview mode 404s, same as it will for real once this is approved.
		// Linking "Ver preview" there by default would show an error page
		// instead of the removal; the collection's LIST route (e.g.
		// `/trabajos`, always present earlier in `routesForCollection`'s
		// order for anything with a dynamic route) is what actually shows the
		// entry now missing, so it stays the only page offered here.
		if (route.dynamic && isDeletion) continue;
		const path = route.dynamic ? route.pattern.replace('{slug}', slug as string) : route.pattern;
		out.push({
			pattern: route.pattern,
			label: pageLabel(route.pattern),
			previewUrl: `${origin}${path}?${PREVIEW_QUERY_PARAM}=${token}`
		});
	}
	return out;
}

/** Human names for singleton collections (Moco-specific) — a singleton's one entry has no title-like field of its own to fall back to (see the general fallback below), so these are hand-picked to match how the owner sees each section. Never the raw collection key. */
const SINGLETON_LABELS: Record<string, string> = {
	homeHero: 'El inicio',
	statement: 'La frase destacada del inicio',
	homeServices: 'La sección de servicios del inicio',
	estudioHero: 'El encabezado de Estudio',
	estudioServices: 'Los servicios de Estudio',
	contactoHero: 'El encabezado de Contacto',
	contactCta: 'El cartel de contacto',
	trabajosHeader: 'El encabezado de Trabajos'
};

function entryLabel(row: EntryRow, collectionKey: string, pages: ChangeCardPage[]): string {
	const data = row.data as Record<string, unknown> | null;
	const candidate = data && (data.title ?? data.name ?? data.headline);
	if (typeof candidate === 'string' && candidate.length > 0) return candidate;
	if (row.slug !== 'default') return row.slug;
	// A singleton with no title-like field — never fall back to the raw
	// collection key (see this lane's brief: no internal names shown to the
	// person). Prefer a hand-picked human name, then the page it lives on.
	return SINGLETON_LABELS[collectionKey] ?? (pages[0] ? pages[0].label : 'esta sección');
}

/**
 * Builds one `ChangeCardEntry` from the entry's CURRENT db state — the
 * summary is always computed from `publishedData` (before) vs `data`
 * (after), live, never cached, so it always reflects whatever the draft
 * looks like right now (including every accumulated edit since the last
 * publish).
 */
export async function buildChangeCardEntry(
	origin: string,
	ref: PendingEntryRef
): Promise<ChangeCardEntry | null> {
	const collection = getCollection(ref.collection);
	if (!collection) return null;
	const row = await resolveEntry(collection, { slug: ref.slug ?? undefined });
	if (!row) return null;

	const after = row.data as Record<string, unknown>;
	const before = (row.publishedData as Record<string, unknown> | null) ?? null;
	const isNew = row.publishedData === null && !row.pendingDelete;
	const pages = await buildPages(
		origin,
		ref.collection,
		collection.kind === 'singleton' ? null : row.slug,
		row.pendingDelete
	);

	return {
		collection: ref.collection,
		slug: collection.kind === 'singleton' ? null : row.slug,
		label: entryLabel(row, ref.collection, pages),
		isNew,
		isDeletion: row.pendingDelete,
		summary: summarizeChange(before, after, isNew, row.pendingDelete),
		pages
	};
}

/** Builds the full pending card from the conversation's pending set. Drops any ref that no longer resolves to a real entry (deleted outright, or bad data) rather than erroring — a stale pointer must never break the whole chat. */
export async function buildChangeCard(origin: string, refs: PendingEntryRef[]): Promise<ChangeCard> {
	const entries: ChangeCardEntry[] = [];
	for (const ref of refs) {
		const entry = await buildChangeCardEntry(origin, ref);
		if (entry) entries.push(entry);
	}
	return { status: 'pending', entries };
}
