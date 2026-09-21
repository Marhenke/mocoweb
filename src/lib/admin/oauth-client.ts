/**
 * Browser-side OAuth 2.1 (authorization code + PKCE) client for `/admin`
 * (Lane B5). Runs the SAME flow an external MCP client (Claude Desktop,
 * ChatGPT) already runs against this site's own `/register`, `/authorize`,
 * and `/token` — nothing new on the server side, no special "admin login"
 * endpoint. That's deliberate: the whole reason this repo's CSRF guard is
 * disabled (`csrf.trustedOrigins: ['*']`, see `vite.config.ts`) is that NO
 * request here ever carries an ambient cookie credential, and a bespoke
 * cookie-based admin login would break that invariant. So this module:
 *
 *   - Never sets a cookie, never reads one.
 *   - Keeps the ACCESS token only in memory (held by the Svelte component
 *     that calls this module, passed around as a plain value — never
 *     written to `localStorage`/`sessionStorage`), so it's gone the moment
 *     the tab closes or reloads.
 *   - Persists only the REFRESH token client-side (`localStorage`), so the
 *     owner doesn't have to retype their key on every visit. Rotating
 *     `OWNER_KEY` invalidates it exactly like it invalidates every other
 *     refresh token in this system — see `auth/keys.ts` and `auth/tokens.ts`
 *     (`rotateRefreshToken` re-derives the hash key from the *current*
 *     `OWNER_KEY` on every lookup) — there is nothing extra to revoke here.
 *
 * `code_verifier` generation and the S256 `code_challenge` use
 * `crypto.getRandomValues`/`crypto.subtle.digest`, the Web Crypto API —
 * available in every browser this admin panel needs to run in, no
 * dependency required.
 */

const CLIENT_ID_KEY = 'moco_admin_client_id';
const REFRESH_TOKEN_KEY = 'moco_admin_refresh_token';

export interface TokenSet {
	accessToken: string;
	refreshToken: string;
	scope: string;
	/** epoch ms */
	expiresAt: number;
}

export class SessionExpiredError extends Error {
	constructor() {
		super('La sesión expiró o la clave del sitio cambió. Iniciá sesión de nuevo.');
		this.name = 'SessionExpiredError';
	}
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return toBase64Url(new Uint8Array(digest));
}

/** Registers this browser's panel as an OAuth client once (RFC 7591), reusing the same `client_id` on every later visit. `client_id` is not a secret — safe in `localStorage`. */
export async function ensureClientId(): Promise<string> {
	const existing = localStorage.getItem(CLIENT_ID_KEY);
	if (existing) return existing;

	const res = await fetch('/register', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			client_name: 'Panel del sitio',
			redirect_uris: [`${location.origin}/admin`]
		})
	});
	if (!res.ok) throw new Error('No se pudo registrar el panel como cliente OAuth.');
	const data = (await res.json()) as { client_id: string };
	localStorage.setItem(CLIENT_ID_KEY, data.client_id);
	return data.client_id;
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	scope: string;
	expires_in: number;
}

function persistTokens(data: TokenResponse): TokenSet {
	localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		scope: data.scope,
		expiresAt: Date.now() + data.expires_in * 1000
	};
}

/**
 * Runs `/authorize`'s POST directly (the owner-key form submit), reading the
 * issued authorization code off the followed redirect's final URL instead of
 * navigating the browser there — `/authorize`'s `redirect_uri` is this same
 * `/admin` page, so the fetch redirect chain ends on a same-origin response
 * whose `.url` the page can read directly, with no page navigation and no
 * server-side session needed to correlate the two requests.
 */
export async function loginWithOwnerKey(params: {
	ownerKey: string;
	scopeContent: 'read' | 'write' | 'publish';
	inbox: boolean;
}): Promise<TokenSet> {
	const clientId = await ensureClientId();
	const redirectUri = `${location.origin}/admin`;
	const verifier = randomBase64Url(32);
	const challenge = await sha256Base64Url(verifier);
	const state = randomBase64Url(16);

	const form = new URLSearchParams();
	form.set('response_type', 'code');
	form.set('client_id', clientId);
	form.set('redirect_uri', redirectUri);
	form.set('state', state);
	form.set('code_challenge', challenge);
	form.set('code_challenge_method', 'S256');
	form.set('owner_key', params.ownerKey);
	form.set('granted_scope', params.scopeContent);
	if (params.inbox) form.set('granted_scope_inbox', 'inbox');

	const res = await fetch('/authorize', { method: 'POST', body: form });
	if (!res.ok) {
		throw new Error('Clave incorrecta. No se otorgó acceso.');
	}
	const finalUrl = new URL(res.url);
	const code = finalUrl.searchParams.get('code');
	const returnedState = finalUrl.searchParams.get('state');
	if (!code || returnedState !== state) {
		throw new Error('La respuesta de autorización no fue válida (faltó el código o no coincidió el estado).');
	}

	const tokenRes = await fetch('/token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier
		})
	});
	if (!tokenRes.ok) throw new Error('No se pudo intercambiar el código de autorización por un token.');
	return persistTokens((await tokenRes.json()) as TokenResponse);
}

/** Silently refreshes using the persisted refresh token. Returns null (and clears the stored refresh token) if it's missing, expired, revoked, or OWNER_KEY was rotated since it was issued. */
export async function tryRefresh(): Promise<TokenSet | null> {
	const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
	if (!refreshToken) return null;

	const res = await fetch('/token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken })
	});
	if (!res.ok) {
		clearSession();
		return null;
	}
	return persistTokens((await res.json()) as TokenResponse);
}

/** Drops the locally-held session. `client_id` is deliberately kept (not a secret, no reason to re-register). */
export function clearSession(): void {
	localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasStoredRefreshToken(): boolean {
	return localStorage.getItem(REFRESH_TOKEN_KEY) !== null;
}
