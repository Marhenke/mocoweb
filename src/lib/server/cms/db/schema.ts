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
	boolean,
	doublePrecision,
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
 *
 * ── Draft/published split (Lane A8) ─────────────────────────────────────
 * `position` and `published_position` are DELIBERATELY two separate
 * columns, not one shared column: `position` is the draft display order (an
 * agent free to reorder at will, e.g. via reorder_entries), and
 * `published_position` is the order the live site actually renders in,
 * frozen at whatever it was set to on the last `publish`. Before the first
 * publish, `published_position` is NULL — the entry isn't live, so it has
 * no live order. This is what makes "reorder the draft" and "reorder
 * production" two different, independently-timed actions: nothing written
 * to `position` is visible to a visitor until a `publish` copies it into
 * `published_position`. (Lane A7 found this was impossible with a single
 * shared `position` column — see `.migration/LANES.md`'s "reorder_entries
 * cannot touch a collection with anything published" defect.)
 *
 * `pending_delete` is the equivalent mechanism for existence rather than
 * order: a draft cannot simply delete a row that has ever been published
 * (that would delete `published_data` too, taking the entry off the live
 * site immediately — this schema's one hard rule is that nothing the draft
 * does is visible until `publish`). Setting `pending_delete = true` instead
 * records "remove this from the live site on the next publish" without
 * touching `published_data`/`published_position` yet; `publish` is what
 * actually deletes the row once it processes the flag. For an entry that
 * has never been published, `delete_entry` still just deletes the row
 * outright — `pending_delete` only exists to protect a row that has a live
 * snapshot to protect.
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
		/** Live display order. NULL until this entry's first publish; independent of `position` thereafter. */
		publishedPosition: integer('published_position'),
		/** Set by delete_entry on an already-published entry; consumed (row deleted) by the next `publish`. */
		pendingDelete: boolean('pending_delete').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Enforces the contract's UNIQUE (collection_key, slug) and doubles as
		// the lookup index for "find entry X in collection Y" (e.g. resolving
		// /trabajos/[slug]).
		uniqueIndex('entries_collection_key_slug_key').on(table.collectionKey, table.slug),
		// Listing a collection's DRAFT order is the primary read pattern for
		// MCP tools (list_entries, reorder_entries).
		index('entries_collection_key_position_idx').on(table.collectionKey, table.position),
		// Listing a collection's LIVE order is the primary read pattern for
		// the public site (src/lib/server/cms/content.ts) — the whole point
		// of splitting this out is that it is NOT the same index/order as
		// the one above.
		index('entries_collection_key_published_position_idx').on(
			table.collectionKey,
			table.publishedPosition
		)
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

/**
 * A contact-form submission (Lane B4). This is the first anonymous WRITE
 * path into the system — until now visitors only ever read — so it
 * deliberately stores the minimum needed to let the owner read and respond
 * to an inquiry: name, email, and message, exactly what the visitor typed.
 *
 * `ip_hash` is NEVER a raw IP address — see `contact/ip-hash.ts`. It is an
 * HMAC of the submitter's IP, keyed by a value derived from `OWNER_KEY`
 * (same HKDF pattern as every other derived key in `auth/keys.ts`), kept
 * only so an abuse pattern (many submissions from one visitor) can be
 * spotted later without the database ever holding anything that identifies
 * where a real person connected from. It is nullable because a request with
 * no discoverable client address (e.g. behind an unusual proxy chain)
 * should never block a legitimate submission from being stored.
 *
 * `status` starts 'unread'; the `mark_inquiry_read` MCP tool (inbox scope)
 * flips it to 'read'. There is no `deleted` state — nothing here yet needs
 * moderation removal, only "seen it or not."
 */
export const inquiries = pgTable(
	'inquiries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		message: text('message').notNull(),
		status: text('status').notNull().default('unread'), // 'unread' | 'read'
		ipHash: text('ip_hash'),
		notifiedAt: timestamp('notified_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// The inbox's primary read pattern (list_inquiries) is newest-first,
		// optionally filtered by status.
		index('inquiries_created_at_idx').on(table.createdAt),
		index('inquiries_status_created_at_idx').on(table.status, table.createdAt)
	]
);

/**
 * First-party, server-side analytics (Lane B4) — a PRE-AGGREGATED rollup,
 * never one row per page view. Every field here is chosen so the row holds
 * nothing that identifies a person: no IP (hashed or otherwise), no
 * cross-request identifier, no cookie, no user agent string verbatim — just
 * a day, a path, a coarse referrer bucket, and a coarse device bucket. That
 * is what makes this legal/visually cookie-banner-free (see the Lane B4
 * brief): there is no personal data to disclose or ask consent for.
 *
 * Granularity: one row per (day, path, referrer_host, device) combination,
 * incremented with `count = count + 1` on every matching view (see
 * `analytics/record.ts`). A day is coarse enough that even a traffic spike
 * (a shared link going around) still lands on the same handful of rows —
 * bounded by (days × distinct paths × distinct referrer buckets × 4 device
 * buckets), not by view volume — while still answering every question the
 * brief names: "views this week" (sum rows in a date range), "which project
 * gets the most views" (group by path), "where does my traffic come from"
 * (group by referrer_host). An hourly grain was considered and rejected: it
 * multiplies row count 24x for a small portfolio site with no need for
 * intra-day resolution, for no question this system is asked to answer.
 */
export const pageViewStats = pgTable(
	'page_view_stats',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		day: text('day').notNull(), // 'YYYY-MM-DD', UTC
		path: text('path').notNull(),
		/** Normalized host of the Referer header ("instagram.com"), or 'direct' when absent. Never a full URL (a full referrer URL can itself carry identifying query params). */
		referrerHost: text('referrer_host').notNull(),
		/** 'mobile' | 'tablet' | 'desktop' | 'other', parsed from User-Agent — never the raw UA string. */
		device: text('device').notNull(),
		count: integer('count').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('page_view_stats_day_path_referrer_device_key').on(
			table.day,
			table.path,
			table.referrerHost,
			table.device
		),
		// The two read patterns MCP analytics tools actually use: "everything
		// in a date range" and "everything for one page across all time."
		index('page_view_stats_day_idx').on(table.day),
		index('page_view_stats_path_idx').on(table.path)
	]
);

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

/**
 * A conversation in the site admin's in-browser chat (Lane B5, `/admin`).
 * `client_id` is the OAuth `client_id` the panel itself registered under
 * (see `auth/tokens.ts`'s `registerClient` and the "Panel del sitio" name
 * `routes/admin/+page.svelte` sends to `/register`) — the same identity
 * space `revisions.client_id` already uses, so a draft/publish made from
 * this chat is attributable exactly like one made from any other MCP
 * client. There are no user accounts in this system (one owner key), so a
 * conversation is scoped to "made through the panel," not to a person.
 */
export const chatConversations = pgTable(
	'chat_conversations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		clientId: text('client_id')
			.notNull()
			.references(() => oauthClients.clientId, { onDelete: 'cascade' }),
		/** Short label for a conversation list, derived from its first user message. Never re-derived after creation. */
		title: text('title'),
		/**
		 * Lane B7, redesigned in Lane B8 — the site's one accumulating
		 * "pending change set": which draft entries the panel agent has
		 * touched since the last Aprobar/Descartar. Null when there is
		 * nothing pending. Shape: `{ entries: { collection: string, slug:
		 * string | null }[] }`. Survives a reload by construction (it's just
		 * a column read back on GET, same as everything else here) — there
		 * is no separate "session" concept for it. As of Lane B8 this is NOT
		 * tied to any `chat_messages` row (see that table's own comment and
		 * `chat/pending-changes.ts`'s header) — the owner's own feedback was
		 * that a card sitting inside the thread could end up next to an
		 * unrelated later message; the change set is rendered as a
		 * persistent pinned bar instead, entirely outside the message list.
		 */
		pendingChange: jsonb('pending_change'),
		/**
		 * Lane B8 — the most recent successful Aprobar, kept until "Deshacer"
		 * consumes it (moving those entries back into `pending_change`) or a
		 * later Aprobar replaces it. Null when there is nothing to undo.
		 * Shape: `{ entries: ChangeCardEntry[], publishedAt: string }`, each
		 * entry carrying its own `approvedSnapshot` (what was live right
		 * before that publish — see `chat/change-card.ts`). A single slot,
		 * not a stack: this app's "exactly one open change set" rule extends
		 * to "exactly one undoable publish" — approving a NEW change while an
		 * older one is still undoable replaces this slot rather than
		 * accumulating a history. See `chat/pending-changes.ts`'s
		 * `getLastPublished`/`setLastPublished` and
		 * `routes/api/chat/{approve,undo}`.
		 */
		lastPublished: jsonb('last_published'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// The admin panel's primary read pattern: "this client's conversations, most recently active first."
		index('chat_conversations_client_id_updated_at_idx').on(table.clientId, table.updatedAt)
	]
);

/**
 * One turn of a chat conversation, stored in the exact shape the Anthropic
 * Messages API uses for a `{role, content}` message param — `content` is
 * always a JSON array of content blocks (text / image / tool_use /
 * tool_result), never a bare string, so replaying a conversation back to the
 * API on the next turn is a direct row→param mapping with no reshaping (see
 * `chat/store.ts`). `role` is only ever `'user'` or `'assistant'`: a
 * `tool_use` block lives inside an assistant row, and the matching
 * `tool_result` block lives inside the NEXT user row, exactly as the
 * Anthropic API itself models a tool-calling turn — there is no separate
 * `'tool'` role.
 *
 * `input_tokens`/`output_tokens`/`cost_usd` are set only on assistant rows
 * (one real API call in, one row out) and are what `chat/budget.ts` sums to
 * enforce `CHAT_MONTHLY_BUDGET_USD` — see that module for why this is a
 * per-call ledger rather than a single running counter. `budget_blocked` is
 * true for the one kind of assistant row that was NEVER sent to the model at
 * all (the friendly refusal shown once the month's budget is used up) — it
 * carries zero cost by construction and exists so the conversation transcript
 * still shows why the assistant went quiet, instead of silently having no
 * reply.
 */
export const chatMessages = pgTable(
	'chat_messages',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => chatConversations.id, { onDelete: 'cascade' }),
		role: text('role').notNull(), // 'user' | 'assistant'
		content: jsonb('content').notNull(),
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		costUsd: doublePrecision('cost_usd'),
		budgetBlocked: boolean('budget_blocked').notNull().default(false),
		/**
		 * True when this row is a partial assistant reply persisted because the
		 * owner hit Stop mid-stream (Lane B6) — see `chat/agent.ts`'s
		 * `runChatTurnStream`. Only ever set on assistant rows. A stopped row's
		 * `content` never contains an unpaired `tool_use` block (any in-flight
		 * or not-yet-executed tool call is dropped before persisting, exactly
		 * like `budgetBlocked` never leaves a dangling tool call either) — the
		 * next turn's history is always a valid replay for the Anthropic API.
		 */
		stopped: boolean('stopped').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// A conversation's transcript is always read oldest-first, one conversation at a time.
		index('chat_messages_conversation_id_created_at_idx').on(table.conversationId, table.createdAt),
		// `chat/budget.ts` sums cost_usd for "this calendar month, across every
		// conversation" — an index on created_at alone (not scoped to a
		// conversation) is what makes that a range scan instead of a full
		// table scan as history grows.
		index('chat_messages_created_at_idx').on(table.createdAt)
	]
);
