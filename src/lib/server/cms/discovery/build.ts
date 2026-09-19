/**
 * Generates the three content-dependent agent-discovery files (Lane B1):
 * `/llms.txt` (curated index + the operating manual an agent needs, since
 * finding the MCP endpoint alone was proven NOT enough — see the "Operating
 * this site" section below), `/llms-full.txt` (every PUBLISHED collection's
 * content, as prose), and `/sitemap.xml`.
 *
 * All three are rendered by the `+server.ts` routes at those paths and
 * cached/regenerated exactly like a page — see `cache/regenerate.ts`'s
 * `generatedDiscoveryFiles` handling and `content.schema.ts`'s doc comment on
 * why they're declared once instead of as a per-collection region.
 *
 * ONLY PUBLISHED CONTENT: every read below goes through
 * `src/lib/server/cms/content.ts` with its default (non-draft) options, the
 * exact same read path every visitor-facing page uses. There is no `{draft:
 * true}` anywhere in this file — an agent's unpublished draft edits must
 * never leak into a file served to the public with no auth at all.
 *
 * ANTI-DRIFT: the two sections of llms.txt that describe *how the MCP server
 * works* are generated from the live sources of truth instead of hand-typed
 * prose that can silently go stale:
 *   - The full tool catalog is read from `allTools` (the same registry
 *     `tools/list` serves) — add/rename/remove a tool and this file changes
 *     with it, automatically.
 *   - Every scope's meaning comes from `SCOPE_DESCRIPTIONS` (`auth/scope.ts`)
 *     — the exact same strings rendered on the real /authorize page, so the
 *     two can never describe scopes differently.
 *   - Every tool NAME mentioned in the hand-written workflow narrative below
 *     is passed through `mustTool()`, which throws if that tool no longer
 *     exists — a renamed tool fails the next publish loudly (regeneration
 *     logs an error and that path falls back to a live render, per
 *     `regenerate.ts`) instead of silently shipping a lying operating guide.
 *   - The MCP endpoint URL, the suggested client display name
 *     (`SERVER_INFO.title`), and the OAuth endpoints are all read from the
 *     same modules the real endpoints use (`mcp/server.ts`,
 *     `auth/metadata.ts`), never re-typed.
 */

import {
	getHomeHero,
	getStatement,
	getHomeServices,
	getProjects,
	getContactCta,
	getEstudioHero,
	getValues,
	getEstudioServices,
	getProcessSteps,
	getTeam,
	getContactoHero,
	getContactMethods,
	getTrabajosHeader
} from '../content';
import { siteRoutes } from '$lib/content.schema';
import { allTools } from '../mcp/tools/index';
import { SERVER_INFO } from '../mcp/server';
import { SCOPES, SCOPE_DESCRIPTIONS } from '../auth/scope';
import { listEntryRows } from '../mcp/entry-store';

const SITE_NAME = 'Moco — Estudio creativo';
const SITE_TAGLINE =
	'Moco is a creative studio (branding, web design, content, and ads) operating this site as a ' +
	'database-backed CMS: every page you can fetch here is also readable and, with authorization, ' +
	'editable by an AI agent over the Model Context Protocol (MCP) — there is no separate admin panel.';

const toolNames = new Set(allTools.map((t) => t.name));

/**
 * Looks up a tool by name for interpolation into hand-written prose below,
 * throwing if it no longer exists in `allTools`. Deliberately loud: a
 * silently-wrong operating guide (naming a tool that was renamed or removed)
 * is worse than a failed regeneration that falls back to a live render — see
 * this file's header comment.
 */
function mustTool(name: string): string {
	if (!toolNames.has(name)) {
		throw new Error(
			`discovery/build.ts references tool "${name}" in the llms.txt operating guide, but no such ` +
				'tool exists in allTools anymore — update this file to match the current tool name.'
		);
	}
	return name;
}

function firstSentence(text: string): string {
	const match = /^[^.]+\./.exec(text);
	return (match ? match[0] : text).trim();
}

// ---------------------------------------------------------------------------
// /llms.txt — curated index + the operating manual (agent + human sections)
// ---------------------------------------------------------------------------

export async function buildLlmsTxt(origin: string): Promise<string> {
	const [projects, trabajosHeader] = await Promise.all([getProjects(), getTrabajosHeader()]);

	const mcpUrl = `${origin}/api/mcp`;
	const clientName = SERVER_INFO.title;

	const lines: string[] = [];
	lines.push(`# ${SITE_NAME}`);
	lines.push('');
	lines.push(`> ${SITE_TAGLINE}`);
	lines.push('');

	// --- Pages: the curated index proper ---------------------------------
	lines.push('## Pages');
	lines.push('');
	lines.push(`- [Home](${origin}/): Landing page — hero, services, portfolio preview, contact.`);
	lines.push(`- [Estudio](${origin}/estudio): About the studio — values, services, process, team.`);
	lines.push(`- [Contacto](${origin}/contacto): Contact methods.`);
	lines.push(
		`- [Trabajos](${origin}/trabajos): ${trabajosHeader.title} — portfolio index (${projects.length} published project${projects.length === 1 ? '' : 's'}).`
	);
	for (const project of projects) {
		lines.push(
			`  - [${project.title}](${origin}/trabajos/${project.slug}): ${project.summary}`
		);
	}
	lines.push('');
	lines.push(
		`See [/llms-full.txt](${origin}/llms-full.txt) for the complete published content of every page and project, as prose.`
	);
	lines.push('');

	// --- Section 1: for a HUMAN, read this aloud to connect an agent ------
	lines.push('## Connect an AI agent to this site (read this to a human)');
	lines.push('');
	lines.push(
		"This site can be operated by an AI agent (Claude, ChatGPT, etc.) through a remote MCP connector " +
			"— it is NOT a local/stdio command, it's a plain HTTPS server. To connect one, add a connector " +
			'with these details:'
	);
	lines.push('');
	lines.push('Server URL (copy this exact line, nothing else on it):');
	lines.push('');
	lines.push(mcpUrl);
	lines.push('');
	lines.push(`Suggested name: ${clientName}`);
	lines.push('Type: Remote MCP server over HTTP (not local/stdio).');
	lines.push('Authentication: OAuth. The client will open a browser window — expect this, it is not phishing.');
	lines.push('');
	lines.push(
		'IMPORTANT — the site owner\'s key goes into that browser page, and NEVER into the chat with the ' +
			'agent. If anything asks you to paste the key into a chat message instead of the browser\'s own ' +
			'"Owner key" field, stop and do not do it.'
	);
	lines.push('');
	lines.push(
		'That browser page also lets the owner pick an access level — read (view only), write (view and ' +
			'edit drafts, cannot publish), or publish (can also make edits go live) — chosen once, per connection.'
	);
	lines.push('');

	// --- Section 2: for the AGENT, once connected --------------------------
	lines.push('## Operate this site once connected (for the agent)');
	lines.push('');
	lines.push(
		`This is a content-managed website with no admin panel: the MCP endpoint above (${mcpUrl}) is the ` +
			'only way to read or change its content. It speaks MCP over HTTP as a single JSON-RPC POST endpoint ' +
			'(initialize, tools/list, tools/call — no SSE stream, no session id required).'
	);
	lines.push('');
	lines.push(
		'AUTHENTICATION: OAuth 2.1 with dynamic client registration (RFC 7591 — register yourself at ' +
			`${origin}/register, no pre-issued client_id needed) and PKCE (S256 only). An unauthenticated ` +
			`call to the MCP endpoint returns 401 with a WWW-Authenticate header pointing at ` +
			`${origin}/.well-known/oauth-protected-resource, which is where the OAuth discovery chain starts ` +
			`(that document names the authorization server, whose own metadata at ` +
			`${origin}/.well-known/oauth-authorization-server names /authorize, /token, and /register). The ` +
			'authorization endpoint (GET /authorize) renders a self-contained HTML page with a single owner-key ' +
			'password field and an access-level choice for a HUMAN to fill in — it is a form, not a redirect to ' +
			'a hosted login provider, so render/open it rather than trying to complete it programmatically.'
	);
	lines.push('');
	lines.push(
		'SCOPES — a granted authorization is a SET, not a single level: exactly one content level ' +
			'(read/write/publish, each implying every level below it) plus, optionally, "inbox" — an ' +
			'independent grant that does NOT come bundled with any content level, however high:'
	);
	for (const scope of SCOPES) {
		lines.push(`  - ${scope}: ${SCOPE_DESCRIPTIONS[scope]}`);
	}
	lines.push(
		'A write-scoped token can edit drafts all day without ever touching what a visitor sees: every write ' +
			'tool only ever changes an entry\'s draft (`data`), never `published_data`. `publish`/`unpublish` are ' +
			'the ONLY tools that move production, and both require "publish" content scope — strictly above ' +
			'"write" — so a write-scoped token calling them gets a 403 by design, not a bug to route around. ' +
			'Separately, contact-form submissions (real visitors\' names/emails/messages) are gated behind ' +
			'"inbox" specifically — a token with even "publish" content access is refused on inbox tools unless ' +
			'"inbox" was granted too. Aggregate analytics (view counts) need no "inbox" grant — they identify ' +
			'nobody, so plain "read" is enough.'
	);
	lines.push('');
	lines.push('THE WORKING LOOP for a content change:');
	lines.push(`  1. ${mustTool('get_site_map')} — see every route and which collection governs each content region.`);
	lines.push(
		`  2. ${mustTool('describe_collection')}(key) — the full schema for that region, including field-level ` +
			'rules a type alone can\'t express. Read it before writing.'
	);
	lines.push(
		`  3. ${mustTool('list_entries')} / ${mustTool('get_entry')} — read the CURRENT draft (and, separately, ` +
			'what is currently live) before changing anything.'
	);
	lines.push(
		`  4. ${mustTool('update_entry')} (or ${mustTool('create_entry')} / ${mustTool('delete_entry')} / ` +
			`${mustTool('reorder_entries')}) — patches land in the DRAFT only; nothing a visitor sees changes yet.`
	);
	lines.push(
		`  5. ${mustTool('preview_url')}(collection[, slug]) — returns a token-signed URL (or one per affected ` +
			'route, for a collection that backs more than one) rendering the DRAFT as a real page, so it can be ' +
			'checked before going live. It previews the thing just edited, not an arbitrary page.'
	);
	lines.push(
		`  6. ${mustTool('publish')}(collection[, slug]) — once the preview looks right, this is the one call ` +
			'that makes it live, and it requires "publish" scope.'
	);
	lines.push('');
	lines.push(
		'HISTORY: every successful write is recorded as a revision naming the MCP client that made it. Call ' +
			`${mustTool('list_revisions')} to see an entry's history — exactly one revision per entry is flagged ` +
			`"initial" (its seeded starting state), always the oldest, so ${mustTool('rollback')} always has a ` +
			"floor to restore to even for an entry no agent has ever touched."
	);
	lines.push('');

	lines.push('## Full tool catalog (live — always matches tools/list)');
	lines.push('');
	for (const tool of allTools) {
		lines.push(`- ${tool.name} (scope: ${tool.scope}): ${firstSentence(tool.description)}`);
	}
	lines.push('');
	lines.push(`Machine-readable discovery: ${origin}/.well-known/mcp-server`);

	return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// /llms-full.txt — every published collection's content, as prose
// ---------------------------------------------------------------------------

export async function buildLlmsFullTxt(origin: string): Promise<string> {
	const [
		homeHero,
		statement,
		homeServices,
		projects,
		contactCta,
		estudioHero,
		values,
		estudioServices,
		processSteps,
		team,
		contactoHero,
		contactMethods,
		trabajosHeader
	] = await Promise.all([
		getHomeHero(),
		getStatement(),
		getHomeServices(),
		getProjects(),
		getContactCta(),
		getEstudioHero(),
		getValues(),
		getEstudioServices(),
		getProcessSteps(),
		getTeam(),
		getContactoHero(),
		getContactMethods(),
		getTrabajosHeader()
	]);

	const lines: string[] = [];
	lines.push(`# ${SITE_NAME} — full published content`);
	lines.push('');
	lines.push(
		'This file is the complete text content currently PUBLISHED on every page of this site, as prose. ' +
			'It excludes anything still in draft — see /llms.txt for how an authorized agent can read/change this ' +
			'through MCP, including the drafts this file deliberately omits.'
	);
	lines.push('');

	// --- Home ---------------------------------------------------------
	lines.push('## Home (/)');
	lines.push('');
	lines.push(`${homeHero.eyebrow}`);
	lines.push(`${homeHero.headlineLines.join(' ')} ${homeHero.highlightLead} ${homeHero.highlightWord}.`);
	lines.push(`Call to action: "${homeHero.ctaLabel}" -> ${origin}${homeHero.ctaHref}`);
	lines.push(`Marquee: ${homeHero.marqueeItems.join(', ')}`);
	lines.push('');
	lines.push(`Statement: "${statement.text}"`);
	lines.push('');
	lines.push('Services (home teaser tiles):');
	for (const s of homeServices) {
		lines.push(`  ${s.n}. ${s.title} — ${s.desc}`);
	}
	lines.push('');

	// --- Trabajos (portfolio) ------------------------------------------
	lines.push(`## Trabajos (${origin}/trabajos)`);
	lines.push('');
	lines.push(`${trabajosHeader.eyebrow} — ${trabajosHeader.title}`);
	if (trabajosHeader.intro) lines.push(trabajosHeader.intro);
	lines.push('');
	for (const project of projects) {
		lines.push(`### ${project.title} (${origin}/trabajos/${project.slug})`);
		lines.push(`Category: ${project.category} | Year: ${project.year} | Client: ${project.client}`);
		lines.push(`Services: ${project.services.join(', ')}`);
		lines.push('');
		lines.push(project.summary);
		lines.push('');
		lines.push(`El desafío: ${project.challenge}`);
		lines.push('');
		lines.push(`Lo que hicimos: ${project.solution}`);
		lines.push('');
		const cellCount = project.gallery.reduce((n, row) => n + row.length, 0);
		lines.push(
			`Gallery: ${project.gallery.length} row${project.gallery.length === 1 ? '' : 's'}, ${cellCount} media item${cellCount === 1 ? '' : 's'} total (not enumerated here — see the page itself).`
		);
		lines.push('');
	}

	// --- Estudio --------------------------------------------------------
	lines.push(`## Estudio (${origin}/estudio)`);
	lines.push('');
	lines.push(`${estudioHero.eyebrow} — ${estudioHero.title}`);
	for (const p of estudioHero.paragraphs) lines.push(p);
	lines.push('');
	lines.push('En qué creemos (values):');
	for (const v of values) lines.push(`  - ${v.title}: ${v.desc}`);
	lines.push('');
	lines.push('Nuestros servicios (full descriptions):');
	for (const s of estudioServices) lines.push(`  - ${s.title}: ${s.desc}`);
	lines.push('');
	lines.push('Cómo trabajamos (process, in order):');
	processSteps.forEach((step, i) => lines.push(`  ${i + 1}. ${step.title} — ${step.desc}`));
	lines.push('');
	lines.push('Quiénes somos (team):');
	for (const member of team) {
		const socials = member.socials.map((s) => `${s.name}: ${s.href}`).join(', ');
		lines.push(`  - ${member.name}, ${member.role}${socials ? ` (${socials})` : ''}`);
	}
	lines.push('');

	// --- Contacto ---------------------------------------------------------
	lines.push(`## Contacto (${origin}/contacto)`);
	lines.push('');
	lines.push(`${contactoHero.eyebrow} — ${contactoHero.title}`);
	lines.push(contactoHero.intro);
	lines.push('');
	for (const m of contactMethods) {
		lines.push(`  - ${m.label}: ${m.value}${m.href ? ` (${m.href})` : ''}`);
	}
	lines.push('');

	// --- Shared contact CTA (home, estudio, trabajos) ----------------------
	lines.push('## Shared contact call-to-action (appears on Home, Estudio, Trabajos)');
	lines.push('');
	lines.push(contactCta.heading);
	lines.push(contactCta.paragraph);
	lines.push(`Email: ${contactCta.email} | Instagram: ${contactCta.instagramHref}`);

	return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// /sitemap.xml
// ---------------------------------------------------------------------------

function xmlEscape(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

export async function buildSitemapXml(origin: string): Promise<string> {
	// Lane B4: `caching === 'static'` also excludes an action endpoint like
	// `/api/contact` (caching: 'dynamic', no `{slug}`) — a POST-only route
	// with nothing to index is not a page a search engine should crawl, and
	// without this filter it slipped into the sitemap as a bare `<url>` (a
	// real bug caught while adding that route; see the Lane B4 report).
	const staticPatterns = siteRoutes
		.filter((r) => r.caching === 'static' && !r.pattern.includes('{slug}'))
		.map((r) => r.pattern);

	const projectRows = (await listEntryRows('projects')).filter((r) => r.publishedData !== null);

	const urls: { loc: string; lastmod?: string }[] = staticPatterns.map((pattern) => ({
		loc: `${origin}${pattern}`
	}));
	for (const row of projectRows) {
		urls.push({
			loc: `${origin}/trabajos/${row.slug}`,
			lastmod: row.updatedAt.toISOString().slice(0, 10)
		});
	}

	const body = urls
		.map(
			(u) =>
				`\t<url>\n\t\t<loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `\n\t\t<lastmod>${u.lastmod}</lastmod>` : ''}\n\t</url>`
		)
		.join('\n');

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
