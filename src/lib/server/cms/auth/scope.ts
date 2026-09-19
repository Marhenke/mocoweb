/**
 * Scopes for the CMS OAuth engine. Three levels, strictly ordered:
 * `read` (safe, non-mutating MCP tools/resources) < `write` (anything that
 * changes draft content) < `publish` (anything that changes what visitors
 * see: publish, unpublish, rollback). Each level implies every level below
 * it — a `publish`-scoped token can do everything a `write`-scoped one can,
 * which can do everything a `read`-scoped one can; never the reverse.
 *
 * `publish` is deliberately its own level rather than folded into `write`
 * (Lane A8): every other write in this system is inert until published (see
 * `content.schema.ts`'s draft/published split), so a `write` token is, by
 * construction, incapable of doing anything to the live site. `publish` is
 * the one class of operation that breaks that safety property — it is the
 * only thing standing between an agent and production, on a system with no
 * staging environment — so it gets a trust decision of its own at
 * /authorize instead of being bundled into "can edit content."
 */

export type Scope = 'read' | 'write' | 'publish';

export const SCOPES: readonly Scope[] = ['read', 'write', 'publish'];

const RANK: Record<Scope, number> = { read: 0, write: 1, publish: 2 };

export function isScope(value: unknown): value is Scope {
	return value === 'read' || value === 'write' || value === 'publish';
}

/** Parses a (possibly space-delimited, per RFC 6749 §3.3) scope string. */
export function parseScope(raw: string | null | undefined): Scope | null {
	if (!raw) return null;
	const tokens = raw.split(/\s+/).filter(Boolean);
	if (tokens.includes('publish')) return 'publish';
	if (tokens.includes('write')) return 'write';
	if (tokens.includes('read')) return 'read';
	return null;
}

/** True if a token carrying `granted` satisfies an operation that requires `required`. */
export function satisfiesScope(granted: Scope, required: Scope): boolean {
	return RANK[granted] >= RANK[required];
}
