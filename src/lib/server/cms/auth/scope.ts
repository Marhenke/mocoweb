/**
 * Scopes for the CMS OAuth engine.
 *
 * Three CONTENT levels, strictly ordered: `read` (safe, non-mutating MCP
 * tools/resources) < `write` (anything that changes draft content) <
 * `publish` (anything that changes what visitors see: publish, unpublish,
 * rollback). Each level implies every level below it — a `publish`-scoped
 * token can do everything a `write`-scoped one can, which can do everything
 * a `read`-scoped one can; never the reverse.
 *
 * `publish` is deliberately its own level rather than folded into `write`
 * (Lane A8): every other write in this system is inert until published (see
 * `content.schema.ts`'s draft/published split), so a `write` token is, by
 * construction, incapable of doing anything to the live site. `publish` is
 * the one class of operation that breaks that safety property — it is the
 * only thing standing between an agent and production, on a system with no
 * staging environment — so it gets a trust decision of its own at
 * /authorize instead of being bundled into "can edit content."
 *
 * A fourth scope, `inbox` (Lane B4), is deliberately NOT part of that
 * ladder — it is an independent, orthogonal grant, not a fourth rung above
 * `publish`. Contact-form submissions contain real people's names, emails,
 * and messages; an agent trusted to edit site copy (even with `publish`)
 * must not automatically be able to read every visitor's correspondence.
 * A granted authorization is therefore not a single `Scope` but a SET,
 * represented as a space-delimited string (same shape RFC 6749 §3.3 already
 * uses for `scope` params) with exactly one content-ladder token
 * (`read`/`write`/`publish`) plus, optionally, `inbox` — e.g. "write" or
 * "write inbox". `satisfiesScope` below checks the two axes independently:
 * an operation requiring `inbox` needs that literal token present,
 * regardless of how high the content level is; an operation requiring a
 * content level needs the granted set's highest content token to rank at or
 * above it, regardless of whether `inbox` is present. Aggregate analytics
 * (view counts — they identify nobody) are deliberately NOT gated behind
 * `inbox`; they only ever require ordinary `read`.
 */

export type Scope = 'read' | 'write' | 'publish' | 'inbox';

/** The three content-ladder scopes, in ascending order of trust. */
export const CONTENT_SCOPES: readonly Scope[] = ['read', 'write', 'publish'];

export const SCOPES: readonly Scope[] = ['read', 'write', 'publish', 'inbox'];

/**
 * One human-readable sentence per scope, describing exactly what it grants.
 * The single source of truth for that description — both the /authorize
 * page's labels (`authorize-page.ts`) and the generated agent discovery
 * files (`src/lib/server/cms/discovery/`, Lane B1's llms.txt) read this
 * instead of each hand-writing their own copy, so the two can never silently
 * drift apart the way `content.schema.ts`'s collection registry warns
 * against (see its "second source of truth" comment).
 */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
	read: 'Read-only — this app can only view content.',
	write: 'Read and write — this app can view and change draft content, but cannot publish it.',
	publish:
		'Read, write, and publish — this app can view, change, AND publish content to the live site.',
	inbox:
		'Inbox — this app can read contact-form submissions (visitors\' names, emails, and messages) ' +
		'and mark them read. Independent of the content level above: granting a high content level does ' +
		'NOT include this, and granting this alone does not include any content access beyond plain read.'
};

const RANK: Record<Scope, number> = { read: 0, write: 1, publish: 2, inbox: -1 };

export function isScope(value: unknown): value is Scope {
	return (SCOPES as readonly unknown[]).includes(value);
}

/** True if `value` is a valid Scope AND is one of the content-ladder scopes (not `inbox`). */
export function isContentScope(value: unknown): value is Scope {
	return (CONTENT_SCOPES as readonly unknown[]).includes(value);
}

function tokensOf(raw: string): Scope[] {
	return raw
		.split(/\s+/)
		.filter(Boolean)
		.filter(isScope);
}

/** The highest content-ladder scope present in a granted/requested scope string (default "read"). */
export function contentPartOf(raw: string | null | undefined): Scope {
	if (!raw) return 'read';
	let best: Scope = 'read';
	for (const t of tokensOf(raw)) {
		if (isContentScope(t) && RANK[t] > RANK[best]) best = t;
	}
	return best;
}

/** True if `inbox` is present in a granted/requested scope string. */
export function hasInboxPart(raw: string | null | undefined): boolean {
	if (!raw) return false;
	return tokensOf(raw).includes('inbox');
}

/**
 * Parses a (possibly space-delimited, per RFC 6749 §3.3) requested-scope
 * string into its normalized canonical form: exactly one content token,
 * optionally followed by "inbox". Returns null only when the input has no
 * recognizable scope token at all (an unset/garbage `scope` param) — every
 * other input, including one with `inbox` but no content token, normalizes
 * to a valid set (content defaults to "read").
 */
export function parseScope(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const tokens = tokensOf(raw);
	if (tokens.length === 0) return null;
	const content = contentPartOf(raw);
	return hasInboxPart(raw) ? `${content} inbox` : content;
}

/** True if `value` is a well-formed granted-scope string (every token recognized, at least one). */
export function isValidGrantedScope(value: unknown): value is string {
	if (typeof value !== 'string' || value.trim().length === 0) return false;
	const tokens = value.split(/\s+/).filter(Boolean);
	return tokens.length > 0 && tokens.every(isScope);
}

/**
 * True if a token carrying the scope set `granted` (a space-delimited
 * string) satisfies an operation that requires `required`. `inbox` is
 * checked as flat set membership; any other (content-ladder) requirement is
 * checked against the highest content token present in `granted`.
 */
export function satisfiesScope(granted: string, required: Scope): boolean {
	if (required === 'inbox') return hasInboxPart(granted);
	return RANK[contentPartOf(granted)] >= RANK[required];
}
