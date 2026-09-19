/**
 * Scopes for the CMS OAuth engine. Two levels: `read` (safe, non-mutating
 * MCP tools/resources) and `write` (anything that changes content). `write`
 * implies `read` — a write-scoped token can do everything a read-scoped one
 * can, never the reverse.
 */

export type Scope = 'read' | 'write';

export const SCOPES: readonly Scope[] = ['read', 'write'];

export function isScope(value: unknown): value is Scope {
	return value === 'read' || value === 'write';
}

/** Parses a (possibly space-delimited, per RFC 6749 §3.3) scope string. */
export function parseScope(raw: string | null | undefined): Scope | null {
	if (!raw) return null;
	const tokens = raw.split(/\s+/).filter(Boolean);
	if (tokens.includes('write')) return 'write';
	if (tokens.includes('read')) return 'read';
	return null;
}

/** True if a token carrying `granted` satisfies an operation that requires `required`. */
export function satisfiesScope(granted: Scope, required: Scope): boolean {
	if (required === 'read') return granted === 'read' || granted === 'write';
	return granted === 'write';
}
