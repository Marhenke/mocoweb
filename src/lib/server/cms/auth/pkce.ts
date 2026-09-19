/**
 * PKCE (RFC 7636) verification. This engine supports S256 only — `plain` is
 * rejected wherever a `code_challenge_method` is accepted, per the design
 * brief: the client here is public (no client secret), so PKCE is the only
 * thing standing between an intercepted authorization code and a token, and
 * `plain` provides none of the protection `S256` does.
 */

import { createHash } from 'node:crypto';

export function isSupportedChallengeMethod(method: string | null | undefined): method is 'S256' {
	return method === 'S256';
}

/** Computes the S256 code_challenge for a given code_verifier. */
export function computeS256Challenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Verifies a token-exchange `code_verifier` against the `code_challenge`
 * that was recorded when the authorization code was issued. The comparison
 * doesn't need to be constant-time: unlike OWNER_KEY, the challenge isn't a
 * secret an attacker is trying to brute-force blind — it's a public value
 * sent over the (TLS-protected) authorize request, and the verifier itself
 * is only useful to someone who already has the one-time authorization
 * code, which this same request also validates.
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
	if (!codeVerifier) return false;
	return computeS256Challenge(codeVerifier) === codeChallenge;
}
