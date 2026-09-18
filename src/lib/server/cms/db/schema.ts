/**
 * CMS data layer schema (Drizzle ORM / Postgres).
 *
 * This file is a portable engine module: it is meant to be copied verbatim
 * into future client projects, so it must stay free of anything specific to
 * this site (Moco). Table names and column names here are an interface
 * contract shared with the MCP server and other lanes of the migration —
 * do not rename or restructure without updating every consumer.
 */

import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

/**
 * A content type: either a `singleton` (e.g. site-wide settings, one row) or
 * a `list` (e.g. projects, many rows/entries). `schema_json` is the JSON
 * Schema an MCP agent (and any future admin UI) uses to validate and render
 * entries belonging to this collection.
 */
export const collections = pgTable('collections', {
	key: text('key').primaryKey(), // 'projects', 'siteSettings'
	kind: text('kind').notNull(), // 'singleton' | 'list'
	label: text('label'),
	schemaJson: jsonb('schema_json').notNull(),
	position: integer('position').notNull().default(0),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A single row of content within a collection. `data` is the working draft
 * and is always present; `published_data` is a frozen snapshot of what
 * visitors currently see, and is NULL until the entry is published for the
 * first time.
 */
export const entries = pgTable(
	'entries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		collectionKey: text('collection_key')
			.notNull()
			.references(() => collections.key, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		position: integer('position').notNull().default(0),
		status: text('status').notNull().default('draft'), // 'draft' | 'published'
		data: jsonb('data').notNull(),
		publishedData: jsonb('published_data'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Enforces the contract's UNIQUE (collection_key, slug) and doubles as
		// the lookup index for "find entry X in collection Y" (e.g. resolving
		// /trabajos/[slug]).
		uniqueIndex('entries_collection_key_slug_key').on(table.collectionKey, table.slug),
		// Listing a collection's entries in display order is the primary read
		// pattern (e.g. rendering /trabajos).
		index('entries_collection_key_position_idx').on(table.collectionKey, table.position)
	]
);

/**
 * A historical snapshot of an entry's `data` at some point in time, so
 * changes made by an MCP client can be reviewed or rolled back.
 */
export const revisions = pgTable(
	'revisions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		entryId: uuid('entry_id')
			.notNull()
			.references(() => entries.id, { onDelete: 'cascade' }),
		data: jsonb('data').notNull(),
		clientId: text('client_id'),
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Revisions are always fetched newest-first for one entry (history /
		// rollback views).
		index('revisions_entry_id_created_at_idx').on(table.entryId, table.createdAt)
	]
);

/**
 * Content-addressed media asset metadata. `key` is content hash + extension,
 * so re-uploading identical bytes is a no-op rather than a duplicate row.
 */
export const media = pgTable('media', {
	key: text('key').primaryKey(),
	mime: text('mime').notNull(),
	width: integer('width'),
	height: integer('height'),
	bytes: bigint('bytes', { mode: 'number' }).notNull(),
	alt: text('alt'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/** A registered OAuth client (an MCP client application) allowed to connect. */
export const oauthClients = pgTable('oauth_clients', {
	clientId: text('client_id').primaryKey(),
	clientName: text('client_name'),
	redirectUris: jsonb('redirect_uris').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A short-lived, single-use authorization code (PKCE) issued mid-OAuth-flow.
 * Only the hash is stored, never the raw code.
 */
export const oauthAuthCodes = pgTable(
	'oauth_auth_codes',
	{
		codeHash: text('code_hash').primaryKey(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: 'cascade' }),
		redirectUri: text('redirect_uri').notNull(),
		codeChallenge: text('code_challenge').notNull(),
		codeChallengeMethod: text('code_challenge_method').notNull(),
		scope: text('scope').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(table) => [
		// Expired-code cleanup sweeps by expiry.
		index('oauth_auth_codes_expires_at_idx').on(table.expiresAt)
	]
);

/**
 * A long-lived refresh token for an authorized OAuth client. Only the hash is
 * stored, never the raw token.
 */
export const oauthRefreshTokens = pgTable(
	'oauth_refresh_tokens',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tokenHash: text('token_hash').notNull().unique(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: 'cascade' }),
		scope: text('scope').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Looking up tokens by client (e.g. revoke-all-for-client) is a
		// secondary but obvious access pattern.
		index('oauth_refresh_tokens_client_id_idx').on(table.clientId)
	]
);
