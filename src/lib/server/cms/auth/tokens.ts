/**
 * DB-backed OAuth client/code/refresh-token operations, on top of the
 * `oauth_clients` / `oauth_auth_codes` / `oauth_refresh_tokens` tables
 * from ../db/schema.ts (Lane A2). Raw secrets (authorization codes, refresh
 * tokens) are only ever handed to the caller once, at creation time — only
 * their hash is stored, matching the schema's own doc comments.
 */

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { oauthClients, oauthAuthCodes, oauthRefreshTokens } from '../db/schema';
import { getRefreshTokenHashKey } from './keys';
// NOTE: fields below typed `string` (not `Scope`) hold a granted SCOPE SET
// (e.g. "write" or "write inbox"), per scope.ts's header comment — never a
// single content-ladder value once `inbox` exists as an independent grant.

// ---------------------------------------------------------------------------
// Owner key comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of the submitted key against OWNER_KEY. Compares
 * fixed-length SHA-256 digests rather than the raw strings so that neither
 * branch timing nor the early-return-on-length-mismatch that
 * `timingSafeEqual` requires can leak anything about the real key's length.
 */
export function isOwnerKeyValid(submitted: string): boolean {
	const expected = process.env.OWNER_KEY;
	if (!expected) {
		throw new Error(
			'OWNER_KEY is not set. Generate one with `node scripts/generate-owner-key.ts`.'
		);
	}
	const a = createHash('sha256').update(submitted).digest();
	const b = createHash('sha256').update(expected).digest();
	return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Clients (Dynamic Client Registration)
// ---------------------------------------------------------------------------

export interface RegisteredClient {
	clientId: string;
	clientName: string | null;
	redirectUris: string[];
}

export async function registerClient(params: {
	clientName: string | null;
	redirectUris: string[];
}): Promise<RegisteredClient> {
	const clientId = `client_${randomBytes(16).toString('hex')}`;
	await db.insert(oauthClients).values({
		clientId,
		clientName: params.clientName,
		redirectUris: params.redirectUris
	});
	return { clientId, clientName: params.clientName, redirectUris: params.redirectUris };
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
	const rows = await db
		.select()
		.from(oauthClients)
		.where(eq(oauthClients.clientId, clientId))
		.limit(1);
	if (rows.length === 0) return null;
	const row = rows[0];
	return {
		clientId: row.clientId,
		clientName: row.clientName,
		redirectUris: row.redirectUris as string[]
	};
}

// ---------------------------------------------------------------------------
// Authorization codes (single-use, PKCE-bound)
// ---------------------------------------------------------------------------

// Overridable for tests so expiry can be proven without a real-time wait
// (see .migration/auth-verify.ts). Production has no reason to set this.
function codeTtlSeconds(): number {
	const override = process.env.OAUTH_CODE_TTL_SECONDS;
	if (override) {
		const n = Number(override);
		if (Number.isFinite(n) && n > 0) return n;
	}
	return 120; // 2 minutes
}

function sha256hex(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

export async function createAuthorizationCode(params: {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	scope: string;
}): Promise<string> {
	const code = randomBytes(32).toString('base64url');
	await db.insert(oauthAuthCodes).values({
		codeHash: sha256hex(code),
		clientId: params.clientId,
		redirectUri: params.redirectUri,
		codeChallenge: params.codeChallenge,
		codeChallengeMethod: 'S256',
		scope: params.scope,
		expiresAt: new Date(Date.now() + codeTtlSeconds() * 1000)
	});
	return code;
}

export interface ConsumedAuthorizationCode {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	scope: string;
}

/**
 * Atomically deletes and returns the authorization code row, so a code can
 * be consumed at most once even under a concurrent replay: the DELETE only
 * ever returns a row to the first caller, everyone else gets zero rows back
 * from the same DELETE statement.
 */
export async function consumeAuthorizationCode(
	code: string
): Promise<ConsumedAuthorizationCode | null> {
	const codeHash = sha256hex(code);
	const rows = await db
		.delete(oauthAuthCodes)
		.where(eq(oauthAuthCodes.codeHash, codeHash))
		.returning();
	if (rows.length === 0) return null;
	const row = rows[0];
	if (row.expiresAt.getTime() < Date.now()) return null; // expired, already deleted
	return {
		clientId: row.clientId,
		redirectUri: row.redirectUri,
		codeChallenge: row.codeChallenge,
		scope: row.scope
	};
}

// ---------------------------------------------------------------------------
// Refresh tokens (rotating, OWNER_KEY-derived hash)
// ---------------------------------------------------------------------------

const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function hashRefreshToken(raw: string): string {
	return createHmac('sha256', getRefreshTokenHashKey()).update(raw).digest('hex');
}

async function insertRefreshToken(clientId: string, scope: string): Promise<string> {
	const raw = randomBytes(32).toString('base64url');
	await db.insert(oauthRefreshTokens).values({
		tokenHash: hashRefreshToken(raw),
		clientId,
		scope,
		expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000)
	});
	return raw;
}

export async function createRefreshToken(clientId: string, scope: string): Promise<string> {
	return insertRefreshToken(clientId, scope);
}

export interface RotatedRefreshToken {
	refreshToken: string;
	clientId: string;
	scope: string;
}

/**
 * Looks up a refresh token by re-hashing it with the *current*
 * OWNER_KEY-derived key (see keys.ts). If OWNER_KEY has been rotated since
 * the token was issued, the recomputed hash won't match any stored row and
 * this returns null — the kill switch covers refresh tokens with no
 * revocation table, the same way it covers access tokens.
 *
 * On success, atomically revokes the old row and issues a new one (rotation):
 * replaying the old raw token after this call finds a row with
 * `revoked_at` set and is rejected.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotatedRefreshToken | null> {
	const tokenHash = hashRefreshToken(rawToken);
	const now = new Date();

	const rows = await db
		.select()
		.from(oauthRefreshTokens)
		.where(
			and(
				eq(oauthRefreshTokens.tokenHash, tokenHash),
				isNull(oauthRefreshTokens.revokedAt),
				gt(oauthRefreshTokens.expiresAt, now)
			)
		)
		.limit(1);

	if (rows.length === 0) return null;
	const row = rows[0];

	// Revoke-then-insert isn't a single SQL transaction here, but the
	// window between them is not exploitable: the revoke targets this exact
	// primary key row, and a concurrent replay of the same raw token can
	// only either (a) win the revoke and also rotate (harmless — it's the
	// same legitimate caller retrying), or (b) run after this revoke and
	// find `revoked_at` already set, and be rejected. There's no interleaving
	// that lets a replayed token succeed twice.
	const revoked = await db
		.update(oauthRefreshTokens)
		.set({ revokedAt: now })
		.where(and(eq(oauthRefreshTokens.id, row.id), isNull(oauthRefreshTokens.revokedAt)))
		.returning();
	if (revoked.length === 0) return null; // lost the race to another concurrent rotation

	const newRaw = await insertRefreshToken(row.clientId, row.scope);
	return { refreshToken: newRaw, clientId: row.clientId, scope: row.scope };
}
