/**
 * Content model for the Moco site, expressed as Zod schemas.
 *
 * This file is the Moco-specific artifact of the CMS migration. Everything
 * under `src/lib/server/cms/` is a generic engine meant to be reused across
 * client projects; this file is the opposite — it is what makes the engine
 * *this* site.
 *
 * WHO READS THIS: an AI agent operating the site over MCP, with no other
 * context. It will fetch a collection's `schema_json` (generated from these
 * schemas via `z.toJSONSchema`) and must be able to make a correct edit from
 * that alone — it has never seen this site, doesn't know the studio's
 * conventions, and can't ask a human "what looks right here." Every
 * `.describe()` below is written for that reader. It states what the field
 * is for, what a good value looks like, what breaks if you get it wrong, and
 * where the value should come from — not a restatement of the type.
 *
 * Two kinds of collection:
 *   - `singleton`: exactly one entry. Used for a page's one-off hero/intro
 *     copy that has no notion of "another one" — you don't add a second
 *     home page hero, you edit the one that exists.
 *   - `list`: an ordered sequence of many entries, each independently
 *     addable/removable/reorderable (a project, a team member, a value
 *     card). If a future agent's natural next action is "add another one of
 *     these," it's a list.
 *
 * Mechanically-checkable rules from the prose below are additionally
 * enforced as Zod refinements, so a violation is rejected at write time
 * instead of relying on the agent having read the description carefully.
 * Every refinement here was verified against the current production content
 * before being added — see the seed/verification scripts in this same lane.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * A site-internal path (starts with "/") pointing at an uploaded media file
 * under /static — e.g. "/projects/racebox/portada.jpg". This is NOT a full
 * URL and never starts with "http": external links use a different field.
 * The file must actually exist in the project's static assets; this schema
 * cannot verify that, so a value that doesn't resolve to a real file is a
 * broken image/video on the live site with no error anywhere else.
 */
const mediaPath = z
	.string()
	.regex(/^\//, 'Must be a site-relative path starting with "/", not a full URL.')
	.describe(
		'Path to an uploaded media file, relative to the site root (e.g. "/projects/racebox/portada.jpg"). ' +
			'Must start with "/". Not an external URL — this file must be uploaded into the project\'s own ' +
			'static assets. A path to a file that was never uploaded silently breaks that image or video ' +
			'with no build error.'
	);

/** A full external URL (http/https), for links off-site. */
const externalUrl = z
	.string()
	.regex(/^https?:\/\//, 'Must be a full external URL starting with http:// or https://.')
	.describe(
		'A complete external URL, including the protocol (https://…). Used for links that leave the site ' +
			'— social profiles, external services. Never a site-relative path.'
	);

// ---------------------------------------------------------------------------
// Gallery — the hardest and most important structure on the site
// ---------------------------------------------------------------------------

/**
 * One cell in a gallery row: exactly one of an image, a video, or a
 * gradient placeholder, plus the ratio that governs how much width it gets.
 */
export const galleryCellSchema = z
	.object({
		src: mediaPath
			.optional()
			.describe(
				'An image to show in this cell. Set this OR `video` OR `gradient` — never more than one. ' +
					'Use this for a static photo, screenshot, or graphic.'
			),
		video: mediaPath
			.optional()
			.describe(
				'A video (mp4) to show in this cell, e.g. a reel or a screen-recording clip. It autoplays, ' +
					'loops, and is muted on the live site — so pick a clip that reads fine with no sound and ' +
					'no beginning/end (it loops seamlessly-ish). Set this OR `src` OR `gradient` — never more ' +
					'than one.'
			),
		gradient: z
			.string()
			.optional()
			.describe(
				'A CSS background value (a color or gradient() function, e.g. "linear-gradient(...)") used as ' +
					'a placeholder cell when no real photo/video exists yet for that slot. Not currently used by ' +
					'any live project — every real cell today has a `src` or `video` — so treat this as a ' +
					'stand-in to swap out once real media is ready, not a permanent design choice. Set this OR ' +
					'`src` OR `video` — never more than one.'
			),
		ratio: z
			.number()
			.positive()
			.describe(
				'Width divided by height (e.g. a 1920×1080 image is 1.777, a 1080×1350 portrait photo is ' +
					'0.8). This MUST be measured from the actual uploaded file\'s real pixel dimensions — never ' +
					'estimated, never copied from another cell that "looks similar." Every cell in a row is ' +
					'forced to the same rendered height, and each cell\'s width is set proportional to its ' +
					'ratio (a flex-basis), so a wrong ratio does not just look slightly off — it stretches or ' +
					'squashes that one image/video while its neighbors stay correct, which is immediately ' +
					'visible. As a guide: landscape media in this gallery runs roughly 1.2–1.8, portrait media ' +
					'roughly 0.55–0.85; anything far outside that is almost certainly a mistake, not a new style.'
			)
	})
	.describe(
		'One slot in a gallery row. Holds exactly one piece of media (image, video, or placeholder) and the ' +
			'ratio that controls its share of the row\'s width.'
	)
	.superRefine((cell, ctx) => {
		const mediaKindsSet = [cell.src, cell.video, cell.gradient].filter((v) => v !== undefined).length;
		if (mediaKindsSet !== 1) {
			ctx.addIssue({
				code: 'custom',
				message: `A gallery cell must set exactly one of src, video, or gradient (found ${mediaKindsSet}).`
			});
		}
	});

export type GalleryCellInput = z.infer<typeof galleryCellSchema>;

/**
 * A row is a strict, small array of cells with a checkable shape:
 *   - 3 cells: always all-portrait in real usage (a photo/reel/photo triad).
 *   - 1 or 2 cells: freer — most 2-cell rows are two landscape pieces
 *     side by side, but the real data also has 2-cell rows that pair one
 *     landscape piece with one portrait piece (see the note in the row
 *     description). That combination is NOT an error — do not "fix" it.
 */
export const galleryRowSchema = z
	.array(galleryCellSchema)
	.min(1)
	.max(3)
	.describe(
		'One row of the gallery. Every cell in a row is rendered at the same height; each cell\'s rendered ' +
			'width is its `ratio` divided by the sum of all ratios in the row, times the row\'s total width — ' +
			'so cells are never manually sized, only ratio-sized. Valid row shapes seen in production:\n' +
			'  - 3 cells, all portrait (ratio ~0.55–0.85) — the most common gallery pattern, usually photo + ' +
			'reel + photo.\n' +
			'  - 2 cells, both landscape (ratio ~1.2–1.8) — two wide screenshots or photos side by side.\n' +
			'  - 2 cells, one landscape + one portrait — a wide "hero" piece (video or photo) paired with a ' +
			'narrower one. This is real, intentional, and appears repeatedly in production galleries — it is ' +
			'NOT the same rule violation as mixing orientations in a 3-cell row, so do not reject or "correct" ' +
			'it.\n' +
			'  - 1 cell — renders left-aligned at a capped height instead of stretching full-width. Use ' +
			'sparingly: two single-cell rows back to back looks like a mistake, so put other rows between them.\n' +
			'Never mix more than 2 orientations of logic in one row and never exceed 3 cells — the layout has ' +
			'no design for a 4-wide row.'
	)
	.superRefine((row, ctx) => {
		if (row.length === 3) {
			row.forEach((cell, i) => {
				if (cell.ratio < 0.5 || cell.ratio > 0.85) {
					ctx.addIssue({
						code: 'custom',
						path: [i, 'ratio'],
						message:
							'A 3-cell row is a portrait triad in every production gallery today: each cell\'s ratio ' +
							'must be roughly 0.5–0.85 (portrait). This ratio falls outside that band — either the ' +
							'ratio is wrong, or this cell does not belong in a 3-cell row.'
					});
				}
			});
		}
	});

export type GalleryRowInput = z.infer<typeof galleryRowSchema>;

export const gallerySchema = z
	.array(galleryRowSchema)
	.describe(
		'The project\'s image/video gallery, as an ORDERED array of rows, rendered top to bottom in this ' +
			'exact order. There is no separate "order" field — reordering the gallery means reordering this ' +
			'array. See the row schema for what makes a valid row. Rows are commonly a mix of 3-portrait rows ' +
			'and 2-landscape rows, occasionally broken up by a single full-bleed piece; there is no fixed count ' +
			'of rows per project (production galleries range from 2 to 7 rows).'
	)
	.superRefine((rows, ctx) => {
		for (let i = 1; i < rows.length; i++) {
			if (rows[i].length === 1 && rows[i - 1].length === 1) {
				ctx.addIssue({
					code: 'custom',
					path: [i],
					message:
						'Two single-cell rows in a row (rows ' +
						(i - 1) +
						' and ' +
						i +
						') both render left-aligned and small — back to back they read as a layout mistake, not a ' +
						'style choice. Put a multi-cell row between them, or merge into one row.'
				});
			}
		}
	});

export type GalleryInput = z.infer<typeof gallerySchema>;

// ---------------------------------------------------------------------------
// Projects (list)
// ---------------------------------------------------------------------------

/**
 * A project entry. WHY A LIST: each project is independently added, removed,
 * and reordered (the portfolio grows over time as new client work ships),
 * and the site links to each one at its own URL (/trabajos/{slug}). The
 * entry's `slug` is the CMS entry's own identity (see `entries.slug` in the
 * engine schema) and therefore is NOT a field inside this content shape —
 * an agent renames a project by renaming the entry, not by editing a `slug`
 * field buried in the data.
 */
export const projectSchema = z
	.object({
		title: z
			.string()
			.min(1)
			.describe(
				'The project\'s display name, shown as the big heading on its detail page and on its card in ' +
					'the /trabajos grid. Usually the client\'s name or the campaign\'s name (e.g. "Racebox", ' +
					'"REF × Summit de Empresas Familiares"). Keep it short enough to read at 5xl/8xl heading size ' +
					'— under ~45 characters is safe.'
			),
		category: z
			.string()
			.min(1)
			.describe(
				'A short, "·"-separated list of the services performed on this project, shown as a small ' +
					'label above the title (e.g. "Contenido · Ads" or "Web · CM · Producción"). This is a ' +
					'human-scannable summary, distinct from the full `services` array below — keep it to 2-5 ' +
					'short phrases joined by " · ".'
			),
		year: z
			.string()
			.min(1)
			.describe(
				'The year (or year range) the work was done, shown next to the category, e.g. "2025" or ' +
					'"2025 - 2026" for ongoing/multi-year engagements. Free text, not a number, specifically so ' +
					'a range can be expressed.'
			),
		client: z
			.string()
			.min(1)
			.describe(
				'The client\'s name, shown in the project detail page\'s fact sheet ("Cliente"). May differ ' +
					'slightly from `title` (e.g. title "Outobox" with client "Outbox") when the display name and ' +
					'the legal/brand name have diverged — that is not a typo, preserve it deliberately.'
			),
		services: z
			.array(z.string().min(1))
			.min(1)
			.describe(
				'The full list of services performed, one short phrase per item, shown as a row of pill-badges ' +
					'in the project\'s fact sheet (e.g. ["Diseño web", "Community Management", "Producción de ' +
					'reels"]). This is the long-form counterpart to `category` above — it is fine, and normal, ' +
					'for the two to use different phrasing for the same work.'
			),
		bg: mediaPath.describe(
			'The background image used for this project\'s card on the /trabajos grid and home page preview. ' +
				'Almost always the same file as `cover`. This field is REQUIRED even when `cover` is set, ' +
				'because the grid card and the detail-page cover are rendered by different components that each ' +
				'read their own field.'
		),
		cover: mediaPath
			.optional()
			.describe(
				'The large cover image at the top of the project\'s detail page, above the fact sheet. If ' +
					'omitted, the detail page falls back to rendering `bg` as a plain color/background block ' +
					'instead of a photo — so for a real photographic project, always set this explicitly rather ' +
					'than relying on the fallback.'
			),
		ink: z
			.string()
			.regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Must be a hex color, e.g. "#f4f0e6".')
			.describe(
				'A hex color used as the text color drawn over `bg`/`cover` in places that show text on top of ' +
					'the image (currently every project uses "#f4f0e6", the site\'s cream color, because every ' +
					'cover photo is dark enough for light text — pick a darker ink color instead if a future ' +
					'project\'s cover is a light/bright image).'
			),
		summary: z
			.string()
			.min(1)
			.describe(
				'A one-to-two sentence overview of the project, shown directly under the title on the detail ' +
					'page and used as that page\'s meta description for search engines/link previews. Should ' +
					'make sense completely out of context — it is often the only sentence a visitor reads before ' +
					'deciding to click in from a search result or shared link.'
			),
		challenge: z
			.string()
			.min(1)
			.describe(
				'The "El desafío" (the challenge) paragraph on the detail page: what problem the client had ' +
					'before Moco got involved. Written in first-person-plural/client voice, in Spanish, matching ' +
					'the rest of the site\'s copy. One paragraph, no line breaks.'
			),
		solution: z
			.string()
			.min(1)
			.describe(
				'The "Lo que hicimos" (what we did) paragraph on the detail page: what Moco actually delivered, ' +
					'in enough detail to be a real case-study, not just a restatement of `summary`. One ' +
					'paragraph, no line breaks, same voice as `challenge`.'
			),
		gallery: gallerySchema
	})
	.describe(
		'A single portfolio project, rendered at /trabajos/{entry-slug} and as a card on /trabajos and the ' +
			'home page. The entry\'s slug (its identity in the CMS, not a field here) becomes that URL segment ' +
			'— choose it URL-safe (lowercase, hyphenated) when creating a new project.'
	);

export type ProjectInput = z.infer<typeof projectSchema>;

// ---------------------------------------------------------------------------
// Estudio page content
// ---------------------------------------------------------------------------

/** One card in the "En qué creemos" (values) grid on /estudio. */
export const valueSchema = z
	.object({
		title: z
			.string()
			.min(1)
			.describe('A single word or very short phrase naming the value (e.g. "Explorar", "Claridad").'),
		desc: z
			.string()
			.min(1)
			.describe(
				'A 1-2 sentence explanation of what that value means in practice for the studio. Written in ' +
					'first-person-plural Spanish ("Nos gusta...", "Trabajamos..."), matching the rest of the ' +
					'studio\'s voice.'
			)
	})
	.describe(
		'One value card on the /estudio page\'s "En qué creemos" grid. There are 6 today; the grid lays out ' +
			'in 2-3 columns and has no fixed maximum, but going much past 6-8 will make the section very tall.'
	);

/** One step in the "Cómo trabajamos" (process) list on /estudio. */
export const processStepSchema = z
	.object({
		title: z
			.string()
			.min(1)
			.describe(
				'A single-word verb naming this step of the studio\'s process (e.g. "Escuchamos", "Creamos"), ' +
					'shown next to a numbered badge (1, 2, 3…) that is generated automatically from this item\'s ' +
					'position — do not include the number in the text.'
			),
		desc: z
			.string()
			.min(1)
			.describe('One sentence describing what happens during this step.')
	})
	.describe(
		'One step of the studio\'s work process, shown in order on the dark "Cómo trabajamos" band on ' +
			'/estudio. Order matters — this is a sequence (listen → explore → create → deliver), not an ' +
			'unordered set, so reordering entries changes the story being told.'
	);

/**
 * A service the studio offers. IMPORTANT: this exact shape is used in TWO
 * separate places with independently-written copy — see the two collections
 * below (`homeServices`, `estudioServices`). They describe the same six
 * services but currently have different titles and different-length
 * descriptions in each location; that is real, current production content,
 * not a bug this schema should paper over. Edit the one the task actually
 * asks about.
 */
export const homeServiceSchema = z
	.object({
		n: z
			.string()
			.regex(/^\d{2}$/, 'Two-digit, zero-padded index, e.g. "01".')
			.describe(
				'A two-digit index string ("01".."06") shown as a small label on the tile, purely decorative ' +
					'numbering — it must be zero-padded to 2 digits and should match this item\'s position (1st ' +
					'item is "01", 2nd is "02", etc.); it is not read or auto-generated, so update it if you ' +
					'reorder items.'
			),
		title: z
			.string()
			.min(1)
			.describe(
				'The service name shown on the home page\'s "¿Qué necesitás?" tile grid. Short — 1-4 words, ' +
					'fits a bold heading inside a grid tile.'
			),
		desc: z
			.string()
			.min(1)
			.describe(
				'A one-sentence, punchy summary of the service for the home page tile. Shorter and more casual ' +
					'than the equivalent entry in `estudioServices` — home page copy is a teaser, not the full ' +
					'explanation.'
			)
	})
	.describe(
		'One tile in the home page\'s "¿Qué necesitás?" services grid. Every tile links to /estudio ' +
			'regardless of content, so this is a teaser for the fuller explanation there, not a unique ' +
			'destination.'
	);

export const estudioServiceSchema = z
	.object({
		title: z
			.string()
			.min(1)
			.describe(
				'The service name shown as the collapsed header of an accordion item on /estudio. May use ' +
					'slightly different wording than the same service\'s tile on the home page (e.g. "Branding & ' +
					'Identidad" here vs. potentially shorter phrasing on the home tile) — keep it descriptive ' +
					'since this is the canonical, fuller listing of the service.'
			),
		desc: z
			.string()
			.min(1)
			.describe(
				'A full paragraph (3-5 sentences) explaining what the service includes, shown when the ' +
					'accordion item is expanded. This is the authoritative, detailed description — longer and ' +
					'more thorough than the home page teaser for the same service.'
			)
	})
	.describe(
		'One accordion item in the "Nuestros servicios" section on /estudio — the studio\'s full, detailed ' +
			'service listing (as opposed to the shorter teaser tiles on the home page).'
	);

/** One team member on the "Quiénes somos" grid on /estudio. */
export const teamMemberSchema = z
	.object({
		name: z
			.string()
			.min(1)
			.describe('The person\'s first name (or preferred short name), shown as a heading under their photo.'),
		photo: mediaPath.describe(
			'A photo of the person, cropped/displayed at a 4:5 (portrait) aspect ratio — pick or crop source ' +
				'images with the subject roughly centered so an automatic 4:5 crop still looks intentional.'
		),
		role: z.string().min(1).describe('Their title/role, shown under their name (e.g. "Lic. en Diseño").'),
		socials: z
			.array(
				z.object({
					name: z
						.enum(['instagram', 'tiktok', 'youtube', 'spotify'])
						.describe(
							'Which platform this link is for. Limited to this exact set of four values because ' +
								'each one maps to a hand-drawn icon in the site\'s icon component — a platform not in ' +
								'this list has no icon to render and will break the page, not just look wrong.'
						),
					href: externalUrl.describe('The full URL to that person\'s profile on the named platform.')
				})
			)
			.describe(
				'This person\'s social links, shown as a row of small icon buttons under their role. Order is ' +
					'display order. Can be empty if they have none.'
			)
	})
	.describe(
		'One person on the studio team, shown on /estudio\'s "Quiénes somos" grid. There are 2 today; the ' +
			'grid is 2 columns on mobile and 4 on desktop.'
	);

// ---------------------------------------------------------------------------
// Contacto page content
// ---------------------------------------------------------------------------

/** One contact method row on /contacto (Email, Instagram, Ubicación, …). */
export const contactMethodSchema = z
	.object({
		label: z
			.string()
			.min(1)
			.describe('A short category label shown above the value, e.g. "Email", "Instagram", "Ubicación".'),
		value: z
			.string()
			.min(1)
			.describe(
				'The human-readable value shown to the visitor — the actual email address, @handle, or ' +
					'location string. If `href` is set, this text becomes the link\'s visible label, so keep it ' +
					'matching what `href` points to (don\'t show one address and link to another).'
			),
		href: z
			.union([externalUrl, z.string().regex(/^mailto:/, 'Must be an external URL or a mailto: link.')])
			.nullable()
			.describe(
				'Where clicking this method\'s value takes the visitor: a "mailto:" link for an email address, ' +
					'a full https:// URL for a social profile, or null when the method has no clickable ' +
					'destination (e.g. a physical location shown as plain text).'
			)
	})
	.describe('One row in the "how to reach us" list on the left column of /contacto.');

// ---------------------------------------------------------------------------
// Page hero / one-off prose singletons
// ---------------------------------------------------------------------------

export const homeHeroSchema = z
	.object({
		eyebrow: z
			.string()
			.min(1)
			.describe(
				'The small uppercase label above the main headline (e.g. "Estudio creativo"), preceded by a ' +
					'lime dot in the rendered design.'
			),
		headlineLines: z
			.array(z.string().min(1))
			.length(3)
			.describe(
				'The three lines of the main headline, in order, rendered stacked on mobile and inline on ' +
					'desktop (currently ["Hola,", "somos", "Moco."]). Always exactly 3 lines — the layout is ' +
					'hand-tuned for that count.'
			),
		highlightLead: z
			.string()
			.min(1)
			.describe(
				'A word or short phrase shown right after `headlineLines`, in plain text, immediately before ' +
					'`highlightWord` (currently "contenido"). Together they read as one phrase: ' +
					'"{highlightLead} {highlightWord}".'
			),
		highlightWord: z
			.string()
			.min(1)
			.describe(
				'The single word or short phrase given the lime highlight-box treatment at the end of the ' +
					'headline (currently "pegajoso") — the visual punchline of the hero. Keep it short; the box ' +
					'is sized to its text and a long phrase will wrap awkwardly.'
			),
		ctaLabel: z.string().min(1).describe('The text on the hero\'s call-to-action button.'),
		ctaHref: z
			.string()
			.regex(/^\//, 'Must be a site-relative path.')
			.describe('Where the CTA button links to — a site-relative path (e.g. "/contacto").'),
		videoSrc: mediaPath.describe(
			'The looping background video behind the hero text. Plays muted and autoplays, so avoid a clip ' +
				'that relies on sound or has a jarring cut at its loop point.'
		),
		videoPoster: mediaPath.describe(
			'A still image shown before the background video loads (and if video fails to load). Should be a ' +
				'representative frame from `videoSrc` so there is no visible flash/jump once the video starts.'
		),
		marqueeItems: z
			.array(z.string().min(1))
			.min(1)
			.describe(
				'The words/phrases scrolling in the marquee strip below the hero (e.g. "Branding", "Diseño ' +
					'Web"), shown in this order, repeated end-to-end in a seamless loop. Keep each short — long ' +
					'items make the marquee feel slow.'
			)
	})
	.describe('The home page\'s hero section: the top-of-page video, headline, CTA, and the scrolling marquee below it.');

export const statementSchema = z
	.object({
		text: z
			.string()
			.min(1)
			.describe(
				'The single sentence shown large on the lime "Statement" band on the home page (between ' +
					'Services and Portfolio preview). Rendered word-by-word so each word can react on hover; ' +
					'that is a display detail handled by the component, not something this field needs to encode ' +
					'— just provide the sentence as plain text with normal spacing.'
			)
	})
	.describe('The home page\'s lime full-width statement band, between the services grid and the portfolio preview.');

export const estudioHeroSchema = z
	.object({
		eyebrow: z.string().min(1).describe('The small uppercase label above the headline (currently "El estudio").'),
		title: z
			.string()
			.min(1)
			.describe('The main headline of the /estudio hero — one sentence, rendered large and bold.'),
		paragraphs: z
			.array(z.string().min(1))
			.min(1)
			.describe(
				'The intro paragraph(s) under the headline, in reading order. Currently 2 short paragraphs; ' +
					'each renders as its own <p>, so this is genuinely a list of paragraphs, not one string with ' +
					'line breaks.'
			)
	})
	.describe('The dark, full-bleed hero section at the top of /estudio.');

export const contactoHeroSchema = z
	.object({
		eyebrow: z.string().min(1).describe('The small uppercase label above the headline (currently "Contacto").'),
		title: z.string().min(1).describe('The main headline of the /contacto page, on the left column.'),
		intro: z.string().min(1).describe('The one-sentence intro paragraph under the headline.')
	})
	.describe('The left-column headline/intro on the dedicated /contacto page (distinct from the reusable `contactCta` band that appears on other pages).');

export const pageHeaderSchema = z
	.object({
		eyebrow: z.string().min(1).describe('The small uppercase label above the title.'),
		title: z.string().min(1).describe('The page\'s main heading.'),
		intro: z
			.string()
			.optional()
			.describe('An optional one-sentence intro paragraph under the title. Omit entirely if not needed.')
	})
	.describe(
		'A simple eyebrow/title/intro header, used by list-style pages (currently only /trabajos). Shared ' +
			'shape, but each page using it gets its own singleton entry — there is no single shared header entry.'
	);

export const contactCtaSchema = z
	.object({
		heading: z
			.string()
			.min(1)
			.describe(
				'The headline on the reusable lime contact call-to-action band that appears at the bottom of ' +
					'the home, /estudio, and /trabajos pages. NOTE: the dedicated /contacto page has its own, ' +
					'differently-worded headline (see `contactoHero`) — the two are intentionally not the same ' +
					'text today ("Hagámoslo." here vs. "Hablemos." there); keep that in mind before "fixing" one ' +
					'to match the other.'
			),
		paragraph: z.string().min(1).describe('The one-sentence paragraph under the heading.'),
		email: z
			.string()
			.email()
			.describe('The contact email address, shown as a pill-button whose link is generated as "mailto:" + this address.'),
		instagramLabel: z.string().min(1).describe('The label on the Instagram pill-button (currently "Instagram").'),
		instagramHref: externalUrl.describe('The full URL the Instagram button links to.')
	})
	.describe(
		'The reusable lime "get in touch" band rendered by the Contact component at the bottom of the home, ' +
			'/estudio, and /trabajos pages — one shared instance, not per-page content.'
	);

// ---------------------------------------------------------------------------
// Collection registry — what the seed script and MCP engine read
// ---------------------------------------------------------------------------

export type CollectionKind = 'singleton' | 'list';

export interface CollectionDefinition {
	key: string;
	kind: CollectionKind;
	label: string;
	schema: z.ZodType;
}

export const collectionDefinitions: CollectionDefinition[] = [
	{ key: 'projects', kind: 'list', label: 'Proyectos', schema: projectSchema },
	{ key: 'values', kind: 'list', label: 'Valores (Estudio)', schema: valueSchema },
	{ key: 'process', kind: 'list', label: 'Proceso (Estudio)', schema: processStepSchema },
	{ key: 'homeServices', kind: 'list', label: 'Servicios (Home)', schema: homeServiceSchema },
	{ key: 'estudioServices', kind: 'list', label: 'Servicios (Estudio)', schema: estudioServiceSchema },
	{ key: 'team', kind: 'list', label: 'Equipo', schema: teamMemberSchema },
	{ key: 'contactMethods', kind: 'list', label: 'Métodos de contacto', schema: contactMethodSchema },
	{ key: 'homeHero', kind: 'singleton', label: 'Hero (Home)', schema: homeHeroSchema },
	{ key: 'statement', kind: 'singleton', label: 'Statement (Home)', schema: statementSchema },
	{ key: 'estudioHero', kind: 'singleton', label: 'Hero (Estudio)', schema: estudioHeroSchema },
	{ key: 'contactoHero', kind: 'singleton', label: 'Hero (Contacto)', schema: contactoHeroSchema },
	{ key: 'trabajosHeader', kind: 'singleton', label: 'Encabezado (Trabajos)', schema: pageHeaderSchema },
	{ key: 'contactCta', kind: 'singleton', label: 'CTA de contacto (compartido)', schema: contactCtaSchema }
];
