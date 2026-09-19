/**
 * Key derivation for the CMS OAuth engine.
 *
 * There are no user accounts and no passwords: the entire trust root is a
 * single secret, `OWNER_KEY`, set as an environment variable. Every other
 * cryptographic key this engine needs (JWT signing, refresh-token hashing)
 * is *derived* from it with HKDF (RFC 5869) rather than stored anywhere —
 * which is what makes key rotation a kill switch (see `../../../../../.migration/LANES.md`
 * lane A6 brief): change `OWNER_KEY` and every derived key changes with it,
 * instantly and with no revocation table to consult.
 *
 * `process.env.OWNER_KEY` is read fresh on every call, never cached at
 * module load. That matters for the intended deployment: Railway restarts a
 * service when an environment variable changes, and a restart re-reads
 * `process.env` from scratch anyway — but reading it live here also means a
 * single long-lived process picks up a change without even needing that
 * restart, which is the stronger guarantee and costs nothing (HKDF is fast).
 *
 * Lives under `src/lib/server/`, SvelteKit's server-only import boundary.
 */

import { hkdfSync } from 'node:crypto';

function ownerKey(): string {
	const key = process.env.OWNER_KEY;
	if (!key) {
		throw new Error(
			'OWNER_KEY is not set. Generate one with `node scripts/generate-owner-key.ts` and set it as an environment variable (see .env.example).'
		);
	}
	return key;
}

function derive(info: string, length = 32): Buffer {
	// Empty salt is fine here: HKDF's salt is for combining multiple
	// independent (often lower-entropy) input keys; OWNER_KEY is a single
	// 32-byte cryptographically random value, so the `info` string alone is
	// enough to produce independent, purpose-bound subkeys from it.
	return Buffer.from(hkdfSync('sha256', ownerKey(), '', info, length));
}

/** Signing key for access-token JWTs (HS256). */
export function getAccessTokenSigningKey(): Buffer {
	return derive('mocoweb-cms:oauth:access-token:v1');
}

/**
 * Key used to HMAC-hash refresh tokens before they're stored. Using an
 * OWNER_KEY-derived key here (rather than plain SHA-256) is what makes
 * refresh tokens stop working on key rotation too, without a revocation
 * table: after rotation, a lookup re-hashes the presented token with the
 * *new* derived key, which no longer matches any hash computed under the
 * old key.
 */
export function getRefreshTokenHashKey(): Buffer {
	return derive('mocoweb-cms:oauth:refresh-token:v1');
}

/**
 * Signing key for preview links (Lane A8's `preview_url` tool). Deriving
 * this from OWNER_KEY too means preview links are covered by the same
 * kill switch as everything else: rotate OWNER_KEY and every outstanding
 * preview link stops working immediately, no revocation table needed.
 */
export function getPreviewTokenSigningKey(): Buffer {
	return derive('mocoweb-cms:preview-token:v1');
}

/**
 * Key used to HMAC a visitor's IP address before it is ever used as a
 * rate-limit bucket key or stored on an `inquiries` row (Lane B4). A raw IP
 * is never stored or logged anywhere — see `contact/ip-hash.ts`, the one
 * place this key is read. Deriving it from OWNER_KEY (rather than a fixed
 * salt) means rotating OWNER_KEY also retires every previously-computed
 * hash, consistent with every other derived key in this file — a stray
 * pre-rotation hash can never be correlated with a post-rotation one.
 */
export function getIpHashKey(): Buffer {
	return derive('mocoweb-cms:ip-hash:v1');
}
