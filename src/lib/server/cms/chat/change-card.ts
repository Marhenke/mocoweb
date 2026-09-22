/**
 * The panel's "change card" (Lane B7) — replaces the old "borrador"/"draft"
 * language the owner found confusing with something concrete: a plain-
 * language summary of what changed, before/after text, image thumbnails,
 * which page(s) it affects, a preview link, and Aprobar/Descartar. See
 * `pending-changes.ts` for how the conversation-level pending set is
 * tracked, and `routes/api/chat/+server.ts` / `routes/api/chat/approve`,
 * `.../discard`, `.../undo` for where this is built and consumed.
 *
 * This is deliberately Moco-specific in one place (`FIELD_LABELS` below,
 * plus the image-field heuristic) — same as `content.schema.ts` and
 * `system-prompt.ts` already are per their own header comments. A future
 * client site edits this the same way.
 */

import { getCollection } from '../mcp/collections';
import { resolveEntry, type EntryRow } from '../mcp/entry-store';
import { routesForCollection } from '$lib/content.schema';
import { signPreviewToken, PREVIEW_QUERY_PARAM } from '../auth/preview-token';

export interface ChangeCardField {
	label: string;
	before: string;
	after: string;
}

export interface ChangeCardImage {
	url: string;
	alt: string;
}

export interface ChangeCardPage {
	pattern: string;
	label: string;
	/** Absolute URL, draft state, signed — what "Ver preview" opens. Only set for routes that don't need a slug the entry doesn't have (always set in practice). */
	previewUrl: string | null;
}

export interface ChangeCardEntry {
	collection: string;
	slug: string | null;
	/** Human label for this entry, e.g. a project's title, or the collection's own display name for a singleton. */
	label: string;
	/** True if this entry has never been published before (a brand-new draft entry) — shown as "(nuevo)" rather than a before/after diff, since there is no "before". */
	isNew: boolean;
	/** True if this change is a deletion (entry is `pendingDelete`) — shown as "se va a borrar", not a field diff. */
	isDeletion: boolean;
	fields: ChangeCardField[];
	images: ChangeCardImage[];
	pages: ChangeCardPage[];
	/**
	 * Captured only at approval time (see `routes/api/chat/approve`) — what
	 * `publishedData`/`publishedPosition`/`status` were immediately BEFORE
	 * this entry's publish, so "Deshacer" can restore exactly that. Absent
	 * on a still-pending (not yet approved) entry.
	 */
	approvedSnapshot?: {
		publishedData: unknown;
		publishedPosition: number | null;
		status: string;
	} | null;
}

export interface ChangeCard {
	/**
	 * 'pending': awaiting Aprobar/Descartar. 'published': Aprobar succeeded,
	 * this card's entries are live (each carries `approvedSnapshot` for
	 * Deshacer). 'discarded': Descartar reverted every entry back to what
	 * was live, nothing was ever published from this card. 'undone': this
	 * card WAS published, then Deshacer restored the site to what it was
	 * before — distinct from 'discarded' (the draft edit itself is
	 * untouched by Deshacer, only what's live) so the UI can say "Deshecho"
	 * rather than implying the change itself is gone.
	 */
	status: 'pending' | 'published' | 'discarded' | 'undone';
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
	title: 'Título',
	headline: 'Título',
	headlineLines: 'El título grande',
	eyebrow: 'La etiqueta chica de arriba',
	category: 'Categoría',
	year: 'Año',
	client: 'Cliente',
	description: 'Descripción',
	intro: 'Intro',
	kicker: 'Etiqueta',
	punchline: 'Frase final',
	cover: 'Portada',
	text: 'Texto',
	name: 'Nombre',
	role: 'Rol',
	value: 'Valor',
	label: 'Etiqueta',
	href: 'Link',
	ctaLabel: 'Texto del botón',
	ctaHref: 'Link del botón'
};

function humanizeFieldKey(key: string): string {
	return FIELD_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
}

/** Heuristic for "this string value is a media path, show it as a thumbnail, not text" — matches this engine's `mediaPath` schema shape (see `content.schema.ts`): always starts with "/". */
function looksLikeMediaPath(value: unknown): value is string {
	return typeof value === 'string' && /^\/(media|projects)\//.test(value);
}

function toAbsoluteMedia(origin: string, path: string): string {
	return path.startsWith('http') ? path : `${origin}${path}`;
}

/** Collects every `src`/`video` path out of a gallery-shaped array (array of rows of cells — see `gallerySchema`), best-effort: doesn't error on a non-gallery array, just returns nothing. */
function collectGalleryImages(origin: string, value: unknown, alt: string): ChangeCardImage[] {
	if (!Array.isArray(value)) return [];
	const out: ChangeCardImage[] = [];
	for (const row of value) {
		if (!Array.isArray(row)) continue;
		for (const cell of row) {
			if (cell && typeof cell === 'object') {
				const src = (cell as Record<string, unknown>).src;
				if (typeof src === 'string' && src.length > 0) {
					out.push({ url: toAbsoluteMedia(origin, src), alt });
				}
			}
		}
	}
	return out;
}

/** Shallow top-level diff between two entry `data` objects (or `publishedData: null` for a never-published entry) — matches `update_entry`'s own "shallow, top-level merge" semantics, so a diff here means exactly what caused a real write. */
function diffFields(
	origin: string,
	before: Record<string, unknown> | null,
	after: Record<string, unknown>
): { fields: ChangeCardField[]; images: ChangeCardImage[] } {
	const fields: ChangeCardField[] = [];
	const images: ChangeCardImage[] = [];
	const keys = new Set([...(before ? Object.keys(before) : []), ...Object.keys(after)]);
	for (const key of keys) {
		const b = before ? before[key] : undefined;
		const a = after[key];
		if (JSON.stringify(b) === JSON.stringify(a)) continue;

		if (looksLikeMediaPath(a) || looksLikeMediaPath(b)) {
			if (looksLikeMediaPath(a)) images.push({ url: toAbsoluteMedia(origin, a), alt: humanizeFieldKey(key) });
			continue;
		}
		if (key === 'gallery' || Array.isArray(a) || Array.isArray(b)) {
			const galleryImgs = collectGalleryImages(origin, a, humanizeFieldKey(key));
			if (galleryImgs.length > 0) {
				images.push(...galleryImgs.slice(0, 6));
				continue;
			}
			// A simple array of strings (e.g. `headlineLines`, `marqueeItems`)
			// reads fine joined as text — this is the common case for
			// site-copy fields that happen to be modeled as an array for
			// layout reasons, not "structured data" a non-technical reader
			// would find confusing.
			const isStringArray = (v: unknown): v is string[] =>
				Array.isArray(v) && v.every((x) => typeof x === 'string');
			if (isStringArray(a) && (before === null || isStringArray(b))) {
				fields.push({
					label: humanizeFieldKey(key),
					before: isStringArray(b) ? b.join(' / ') : '',
					after: a.join(' / ')
				});
				continue;
			}
			// A structured array/object field that changed but isn't
			// media-shaped and isn't simple strings either (e.g. a services
			// list of {title, description}) — summarize rather than dump raw
			// JSON at a non-technical reader.
			fields.push({ label: humanizeFieldKey(key), before: before ? '(como estaba)' : '', after: '(cambió)' });
			continue;
		}
		if (typeof a === 'string' || typeof b === 'string' || Array.isArray(a) === false) {
			const asText = (v: unknown): string => {
				if (v === undefined || v === null) return '';
				if (Array.isArray(v)) return v.join(' / ');
				return String(v);
			};
			fields.push({ label: humanizeFieldKey(key), before: asText(b), after: asText(a) });
		}
	}
	return { fields, images };
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

async function buildPages(origin: string, collectionKey: string, slug: string | null): Promise<ChangeCardPage[]> {
	const token = signPreviewToken();
	const routes = routesForCollection(collectionKey);
	const out: ChangeCardPage[] = [];
	for (const route of routes) {
		if (route.dynamic && !slug) continue; // can't build a per-entry preview link without a slug
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
 * Builds one `ChangeCardEntry` from the entry's CURRENT db state — the diff
 * is always `publishedData` (before) vs `data` (after), computed live, never
 * cached, so it always reflects whatever the draft looks like right now
 * (including every accumulated edit since the last publish).
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
	const { fields, images } = diffFields(origin, before, after);
	const pages = await buildPages(origin, ref.collection, collection.kind === 'singleton' ? null : row.slug);

	return {
		collection: ref.collection,
		slug: collection.kind === 'singleton' ? null : row.slug,
		label: entryLabel(row, ref.collection, pages),
		isNew: row.publishedData === null && !row.pendingDelete,
		isDeletion: row.pendingDelete,
		fields,
		images,
		pages
	};
}

/** Builds the full card from the conversation's pending set. Drops any ref that no longer resolves to a real entry (deleted outright, or bad data) rather than erroring — a stale pointer must never break the whole chat. */
export async function buildChangeCard(origin: string, refs: PendingEntryRef[]): Promise<ChangeCard> {
	const entries: ChangeCardEntry[] = [];
	for (const ref of refs) {
		const entry = await buildChangeCardEntry(origin, ref);
		if (entry) entries.push(entry);
	}
	return { status: 'pending', entries };
}
