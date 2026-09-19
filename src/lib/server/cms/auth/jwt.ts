/**
 * Minimal HS256 JWT sign/verify for CMS access tokens.
 *
 * Hand-rolled instead of pulling in `jsonwebtoken`/`jose`: HS256 over a
 * fixed, tiny claim set is a handful of lines with Node's built-in `crypto`,
 * and doing it ourselves keeps the exact verification behavior — in
 * particular "recompute the signature with whatever key OWNER_KEY derives
 * to *right now*" — obvious and auditable, which matters for the key-
 * rotation kill switch (see keys.ts). No provider-specific behavior here;
 * this is a generic JWT implementation.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAccessTokenSigningKey } from './keys';
import { isValidGrantedScope, type Scope } from './scope';

export type { Scope };

export interface AccessTokenPayload {
	client_id: string;
	client_name: string | null;
	/**
	 * The granted scope SET, as a space-delimited string (e.g. "write" or
	 * "write inbox") — not a single `Scope`, since `inbox` is an independent
	 * grant that can accompany any content level. See scope.ts's header
	 * comment. Checked with `satisfiesScope`, never compared directly.
	 */
	scope: string;
	iat: number;
	exp: number;
}

function base64url(input: Buffer): string {
	return input.toString('base64url');
}

function base64urlJSON(value: unknown): string {
	return base64url(Buffer.from(JSON.stringify(value)));
}

function sign(signingInput: string): string {
	const key = getAccessTokenSigningKey();
	return base64url(createHmac('sha256', key).update(signingInput).digest());
}

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour, per the brief.

export function signAccessToken(
	claims: Pick<AccessTokenPayload, 'client_id' | 'client_name' | 'scope'>,
	ttlSeconds = ACCESS_TOKEN_TTL_SECONDS
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: 'HS256', typ: 'JWT' };
	const payload: AccessTokenPayload = { ...claims, iat: now, exp: now + ttlSeconds };
	const signingInput = `${base64urlJSON(header)}.${base64urlJSON(payload)}`;
	return `${signingInput}.${sign(signingInput)}`;
}

/**
 * Verifies signature and expiry, re-deriving the signing key from the
 * *current* OWNER_KEY on every call. Returns null on any failure (bad
 * shape, bad signature, expired) — deliberately not distinguishing which,
 * so callers can't be used as an oracle.
 */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [headerB64, payloadB64, signatureB64] = parts;

	const expectedSignature = sign(`${headerB64}.${payloadB64}`);
	const expected = Buffer.from(expectedSignature);
	const actual = Buffer.from(signatureB64);
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		return null;
	}

	let payload: AccessTokenPayload;
	try {
		payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
	} catch {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp < now) return null;
	if (!isValidGrantedScope(payload.scope)) return null;
	if (typeof payload.client_id !== 'string') return null;

	return payload;
}
