/**
 * Collection lookup helpers shared by every MCP tool. Generic engine code —
 * everything Moco-specific lives in `content.schema.ts`, which this module
 * only reads.
 */

import { z } from 'zod';
import { collectionDefinitions, type CollectionDefinition } from '$lib/content.schema';

const byKey = new Map(collectionDefinitions.map((c) => [c.key, c]));

export function listCollections(): CollectionDefinition[] {
	return collectionDefinitions;
}

export function getCollection(key: string): CollectionDefinition | undefined {
	return byKey.get(key);
}

export function collectionNotFoundMessage(key: string): string {
	const known = collectionDefinitions.map((c) => c.key).join(', ');
	return `Unknown collection "${key}". Known collections: ${known}. Call get_site_map or describe_collection with no cached assumptions to see the current list.`;
}

/** The fixed slug every singleton collection's one entry is seeded with. */
export const SINGLETON_SLUG = 'default';

/**
 * Formats a Zod validation failure into a message an agent can act on
 * directly: which collection, which field (by JSON path), what rule was
 * broken, and — since Zod's own message text already carries the schema
 * author's prose (see content.schema.ts's `.describe()`/`superRefine`
 * messages) — that full explanation, not just "invalid".
 */
export function formatZodError(collectionKey: string, error: z.ZodError): string {
	const lines = error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
		return `  - at "${path}": ${issue.message}`;
	});
	return (
		`Validation failed for collection "${collectionKey}" (${error.issues.length} issue` +
		`${error.issues.length === 1 ? '' : 's'}):\n${lines.join('\n')}\n` +
		`Fix the field(s) above and try again. Call describe_collection("${collectionKey}") for the full schema and field-by-field rules.`
	);
}
