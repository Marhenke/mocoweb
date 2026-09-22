import { z } from 'zod';
import { getCollection, collectionNotFoundMessage, SINGLETON_SLUG } from '../collections';
import { textResult, type ToolDefinition } from '../types';

export const describeCollectionTool: ToolDefinition = {
	name: 'describe_collection',
	description:
		"Returns a collection's full JSON Schema, generated directly from the same Zod schema that validates " +
		"every write — including every field's human-written description. Read those descriptions: they carry " +
		"rules a JSON Schema type alone cannot express (e.g. a gallery row's cells all rendering at the same " +
		'height, or that a ratio must be measured from the real file, never estimated). Also returns the ' +
		"collection's kind and a few operational notes that live outside the schema entirely — most importantly, " +
		'that `slug` and `position` belong to the entry, not to the `data` object this schema describes.',
	scope: 'read',
	inputSchema: {
		type: 'object',
		properties: {
			collection: {
				type: 'string',
				description:
					'A collection key, e.g. "projects". See get_site_map for keys in the context of a route.'
			}
		},
		required: ['collection'],
		additionalProperties: false
	},
	handler: async (args) => {
		const key = String(args.collection ?? '');
		const collection = getCollection(key);
		if (!collection) {
			return textResult(collectionNotFoundMessage(key), true);
		}

		const dataSchema = z.toJSONSchema(collection.schema);
		const notes = [
			'`slug` and `position` are properties of the ENTRY itself, not fields inside `data` — they are passed ' +
				'as separate arguments to create_entry / update_entry / get_entry / reorder_entries, never nested ' +
				'inside the data object this schema describes.',
			collection.kind === 'singleton'
				? `This is a singleton: exactly one entry exists for it, always at slug "${SINGLETON_SLUG}". Use ` +
					'get_entry (no slug needed) to read it and update_entry to change it; create_entry and delete_entry ' +
					'are not meaningful for a singleton that already has its one entry.'
				: "This is a list: entries are independently created, updated, deleted, and reordered. Each entry's " +
					'`slug` is its identity (and, for some collections, part of its live URL — e.g. /trabajos/{slug} ' +
					'for `projects`) — it is never a field inside `data`.',
			'Any field whose description says it is a media path must point to a file already uploaded via ' +
				'upload_media — that tool measures the real width/height/ratio from the file itself and returns them; ' +
				'never estimate a ratio by hand or guess a path that was never uploaded. Use the `url` value ' +
				"upload_media (or list_media) returned VERBATIM for that field — never construct or guess the path's " +
				'shape yourself, and never reuse a shape from memory of an older/different file.',
			"A write is validated against exactly this schema before anything is saved. A rejected write's error " +
				'message names the specific field path and rule that failed — fix that field and resubmit.',
			'Every write here (create_entry, update_entry, delete_entry, reorder_entries) only ever touches the ' +
				'DRAFT side of an entry — its `data`/`position`/`pendingDelete`. Nothing visitors see changes until ' +
				'`publish` is called on this collection (see get_site_map\'s instructions and the `publish`/' +
				'`unpublish`/`preview_url`/`list_revisions`/`rollback` tools). Use preview_url to see the draft ' +
				'rendered as a real page before publishing it.'
		];

		return textResult({
			key: collection.key,
			kind: collection.kind,
			label: collection.label,
			notes,
			dataSchema
		});
	}
};
