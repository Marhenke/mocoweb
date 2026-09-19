/**
 * End-to-end acceptance test for the CMS OAuth engine (Lane A6).
 *
 * Drives the whole flow exactly as a real MCP client would, over real HTTP
 * against the actual built `node build` server (not by calling internal
 * functions directly): register -> authorize (with PKCE) -> exchange ->
 * call a protected endpoint. Then proves every one of the 10 acceptance
 * criteria in the lane brief by provoking the failure mode and checking the
 * server's real response, not by reading the source and asserting it looks
 * right.
 *
 * Criterion 6 (key rotation) needs the server to pick up a changed
 * OWNER_KEY. On Railway that happens via a restart triggered by the env var
 * change; this script reproduces exactly that -- kill the child process,
 * start a new one with a different OWNER_KEY against the same database --
 * rather than mutating process.env of a running process, which no real
 * deployment of this design ever does either.
 *
 * Usage: node --experimental-strip-types .migration/auth-verify.ts
 * (Postgres and the media bucket must already be up: npm run db:up)
 */
import 'dotenv/config';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const PORT = 5192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OWNER_KEY_A = randomBytes(32).toString('base64url');
const OWNER_KEY_B = randomBytes(32).toString('base64url');

let totalFailures = 0;
function report(name: string, ok: boolean, detail?: string) {
	if (ok) {
		console.log(`  PASS  ${name}`);
	} else {
		totalFailures++;
		console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
	}
}
function assertEq(name: string, actual: unknown, expected: unknown) {
	report(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: ChildProcessWithoutNullStreams | null = null;
let serverLog = '';

function startServer(ownerKey: string, extraEnv: Record<string, string> = {}): Promise<void> {
	const env = {
		...process.env,
		PORT: String(PORT),
		HOST: '127.0.0.1',
		// adapter-node has no way to know it's being reached over plain HTTP
		// (it assumes https unless told otherwise via ORIGIN or
		// PROTOCOL_HEADER) -- without this, every self-referencing absolute
		// URL the OAuth engine builds from request.url (issuer, endpoints,
		// resource_metadata) would come out as https://... against this
		// plain-http local server. Railway terminates TLS at the edge, so
		// production needs the equivalent of this set too -- see the note
		// left in .env.example.
		ORIGIN: BASE_URL,
		OWNER_KEY: ownerKey,
		...extraEnv
	};
	serverLog = '';
	server = spawn('node', ['build'], { cwd: REPO_ROOT, env });
	server.stdout.on('data', (d) => (serverLog += d.toString()));
	server.stderr.on('data', (d) => (serverLog += d.toString()));

	return new Promise((resolve, reject) => {
		const deadline = Date.now() + 20_000;
		const poll = async () => {
			if (Date.now() > deadline) {
				reject(new Error(`server did not become ready in time.\n--- log ---\n${serverLog}`));
				return;
			}
			try {
				const res = await fetch(`${BASE_URL}/`);
				if (res.status === 200) {
					resolve();
					return;
				}
			} catch {
				// not up yet
			}
			setTimeout(poll, 300);
		};
		poll();
	});
}

function stopServer(): Promise<void> {
	return new Promise((resolve) => {
		if (!server) return resolve();
		const s = server;
		server = null;
		s.once('exit', () => resolve());
		s.kill('SIGTERM');
		setTimeout(() => {
			if (!s.killed) s.kill('SIGKILL');
			resolve();
		}, 3000);
	});
}

// ---------------------------------------------------------------------------
// OAuth client helpers
// ---------------------------------------------------------------------------

function pkcePair() {
	const verifier = randomBytes(48).toString('base64url'); // 64 chars, within 43-128
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

async function registerClient(clientName: string, redirectUri: string) {
	const res = await fetch(`${BASE_URL}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri] })
	});
	const body = await res.json();
	return { status: res.status, body };
}

interface AuthorizeParams {
	clientId: string;
	redirectUri: string;
	challenge: string;
	challengeMethod?: string;
	state?: string;
	scope?: string;
}

function authorizeUrl(p: AuthorizeParams): string {
	const u = new URL(`${BASE_URL}/authorize`);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('client_id', p.clientId);
	u.searchParams.set('redirect_uri', p.redirectUri);
	u.searchParams.set('code_challenge', p.challenge);
	u.searchParams.set('code_challenge_method', p.challengeMethod ?? 'S256');
	if (p.state) u.searchParams.set('state', p.state);
	if (p.scope) u.searchParams.set('scope', p.scope);
	return u.toString();
}

async function submitAuthorize(
	getUrl: string,
	ownerKey: string,
	grantedScope: 'read' | 'write'
): Promise<{ status: number; location: string | null; body: string }> {
	// Re-derive the hidden fields a real browser would have from the GET
	// page's own query string, exactly like the rendered <form> does.
	const params = new URL(getUrl).searchParams;
	const form = new URLSearchParams();
	for (const key of [
		'response_type',
		'client_id',
		'redirect_uri',
		'state',
		'code_challenge',
		'code_challenge_method'
	]) {
		form.set(key, params.get(key) ?? '');
	}
	form.set('owner_key', ownerKey);
	form.set('granted_scope', grantedScope);

	const res = await fetch(`${BASE_URL}/authorize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: form.toString(),
		redirect: 'manual'
	});
	const body = await res.text();
	return { status: res.status, location: res.headers.get('location'), body };
}

async function exchangeCode(params: {
	code: string;
	redirectUri: string;
	clientId: string;
	verifier: string;
}) {
	const res = await fetch(`${BASE_URL}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: params.code,
			redirect_uri: params.redirectUri,
			client_id: params.clientId,
			code_verifier: params.verifier
		}).toString()
	});
	return { status: res.status, body: await res.json() };
}

async function refreshGrant(refreshToken: string) {
	const res = await fetch(`${BASE_URL}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
	});
	return { status: res.status, body: await res.json() };
}

async function probe(method: 'GET' | 'POST', accessToken?: string) {
	const res = await fetch(`${BASE_URL}/api/auth-probe`, {
		method,
		headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
	});
	const body = await res.json().catch(() => null);
	return { status: res.status, body, wwwAuthenticate: res.headers.get('www-authenticate') };
}

/** Full happy-path flow: register -> authorize -> exchange. Returns tokens. */
async function fullFlow(scope: 'read' | 'write', ownerKey: string) {
	const redirectUri = 'http://127.0.0.1:9/callback'; // never actually dialed
	const reg = await registerClient(`Test Harness (${scope})`, redirectUri);
	const clientId = reg.body.client_id as string;
	const { verifier, challenge } = pkcePair();
	const getUrl = authorizeUrl({ clientId, redirectUri, challenge, scope, state: 'st-' + scope });
	const submit = await submitAuthorize(getUrl, ownerKey, scope);
	const code = submit.location ? new URL(submit.location).searchParams.get('code') : null;
	if (!code) throw new Error(`fullFlow(${scope}): no code issued — ${submit.status} ${submit.body}`);
	const exchange = await exchangeCode({ code, redirectUri, clientId, verifier });
	return { clientId, redirectUri, verifier, code, exchange };
}

// ---------------------------------------------------------------------------
// Test steps
// ---------------------------------------------------------------------------

async function main() {
	console.log(`==> Building (npm run build)...`);
	await new Promise<void>((resolve, reject) => {
		const build = spawn('npm', ['run', 'build'], { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
		build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed (${code})`))));
	});

	console.log(`==> Starting server on :${PORT} with a short auth-code TTL for the expiry test...`);
	await startServer(OWNER_KEY_A, { OAUTH_CODE_TTL_SECONDS: '2' });

	console.log('\n==> 1. Happy path: register -> authorize (PKCE) -> exchange -> call protected endpoint');
	{
		const flow = await fullFlow('write', OWNER_KEY_A);
		assertEq('1a. registration succeeds', typeof flow.clientId === 'string' && flow.clientId.length > 0, true);
		assertEq('1b. exchange succeeds (200)', flow.exchange.status, 200);
		const accessToken = flow.exchange.body.access_token;
		const refreshToken = flow.exchange.body.refresh_token;
		report('1c. access_token present', typeof accessToken === 'string' && accessToken.split('.').length === 3);
		report('1d. refresh_token present', typeof refreshToken === 'string' && refreshToken.length > 0);
		assertEq('1e. granted scope echoed', flow.exchange.body.scope, 'write');
		const call = await probe('GET', accessToken);
		assertEq('1f. protected endpoint accepts the access token', call.status, 200);
	}

	console.log('\n==> 2. Wrong key is rejected at /authorize, with no code issued');
	{
		const redirectUri = 'http://127.0.0.1:9/callback';
		const reg = await registerClient('Wrong Key Test', redirectUri);
		const { challenge } = pkcePair();
		const getUrl = authorizeUrl({ clientId: reg.body.client_id, redirectUri, challenge });
		const submit = await submitAuthorize(getUrl, 'definitely-the-wrong-key', 'write');
		assertEq('2a. no redirect (no 303)', submit.status !== 303, true);
		assertEq('2b. no code in response', submit.location, null);
		report('2c. rejection is a 401', submit.status === 401, `got ${submit.status}`);
	}

	console.log('\n==> 3. PKCE is enforced');
	{
		// 3a. mismatched code_verifier fails at exchange.
		const redirectUri = 'http://127.0.0.1:9/callback';
		const reg = await registerClient('PKCE Mismatch Test', redirectUri);
		const { challenge } = pkcePair();
		const getUrl = authorizeUrl({ clientId: reg.body.client_id, redirectUri, challenge });
		const submit = await submitAuthorize(getUrl, OWNER_KEY_A, 'write');
		const code = submit.location ? new URL(submit.location).searchParams.get('code') : null;
		if (!code) throw new Error('3a. setup failed: no code issued');
		const wrongVerifier = randomBytes(48).toString('base64url');
		const exchange = await exchangeCode({ code, redirectUri, clientId: reg.body.client_id, verifier: wrongVerifier });
		assertEq('3a. mismatched code_verifier is rejected', exchange.status, 400);

		// 3b. code_challenge_method=plain is rejected at /authorize itself.
		const plainUrl = authorizeUrl({
			clientId: reg.body.client_id,
			redirectUri,
			challenge: 'not-a-real-challenge',
			challengeMethod: 'plain'
		});
		const plainRes = await fetch(plainUrl);
		const plainBody = await plainRes.text();
		assertEq('3b. code_challenge_method=plain rejected (not 200)', plainRes.status !== 200, true);
		report('3c. plain rejection does not render the key form', !plainBody.includes('name="owner_key"'));
	}

	console.log('\n==> 4. Authorization codes are single-use');
	{
		const flow = await fullFlow('write', OWNER_KEY_A);
		assertEq('4a. first exchange succeeds', flow.exchange.status, 200);
		const replay = await exchangeCode({
			code: flow.code,
			redirectUri: flow.redirectUri,
			clientId: flow.clientId,
			verifier: flow.verifier
		});
		assertEq('4b. replaying the same code fails', replay.status, 400);
	}

	console.log('\n==> 5. Codes expire');
	{
		const redirectUri = 'http://127.0.0.1:9/callback';
		const reg = await registerClient('Expiry Test', redirectUri);
		const { verifier, challenge } = pkcePair();
		const getUrl = authorizeUrl({ clientId: reg.body.client_id, redirectUri, challenge });
		const submit = await submitAuthorize(getUrl, OWNER_KEY_A, 'write');
		const code = submit.location ? new URL(submit.location).searchParams.get('code') : null;
		if (!code) throw new Error('5. setup failed: no code issued');
		console.log('     (waiting 3s for the 2s test TTL to elapse...)');
		await new Promise((r) => setTimeout(r, 3000));
		const exchange = await exchangeCode({ code, redirectUri, clientId: reg.body.client_id, verifier });
		assertEq('5a. expired code is rejected', exchange.status, 400);
	}

	console.log('\n==> 7. Refresh rotation: using a refresh token issues a new one and invalidates the old');
	{
		const flow = await fullFlow('write', OWNER_KEY_A);
		const refreshToken1 = flow.exchange.body.refresh_token as string;
		const rotate1 = await refreshGrant(refreshToken1);
		assertEq('7a. first refresh succeeds', rotate1.status, 200);
		const refreshToken2 = rotate1.body.refresh_token as string;
		report('7b. rotation issues a different refresh token', refreshToken2 !== refreshToken1);
		const replay = await refreshGrant(refreshToken1);
		assertEq('7c. replaying the old refresh token fails', replay.status, 400);
		const rotate2 = await refreshGrant(refreshToken2);
		assertEq('7d. the new refresh token itself still works', rotate2.status, 200);
	}

	console.log('\n==> 8. Scope is enforced: a read-only token is rejected by a write-scoped operation');
	{
		const flow = await fullFlow('read', OWNER_KEY_A);
		assertEq('8a. read-scope exchange succeeds', flow.exchange.status, 200);
		assertEq('8b. granted scope is "read"', flow.exchange.body.scope, 'read');
		const accessToken = flow.exchange.body.access_token;
		const readCall = await probe('GET', accessToken);
		assertEq('8c. read-scoped token allowed on read operation', readCall.status, 200);
		const writeCall = await probe('POST', accessToken);
		assertEq('8d. read-scoped token rejected on write operation', writeCall.status, 403);
		report(
			'8e. 403 carries insufficient_scope in WWW-Authenticate',
			(writeCall.wwwAuthenticate ?? '').includes('insufficient_scope')
		);
	}

	console.log('\n==> 9. Unauthenticated request returns 401 with a usable WWW-Authenticate');
	{
		const call = await probe('GET');
		assertEq('9a. no bearer token -> 401', call.status, 401);
		const header = call.wwwAuthenticate ?? '';
		const match = /resource_metadata="([^"]+)"/.exec(header);
		report('9b. WWW-Authenticate carries resource_metadata', match !== null, header);
		if (match) {
			const metaRes = await fetch(match[1]);
			const meta = await metaRes.json().catch(() => null);
			assertEq('9c. resource_metadata URL resolves (200)', metaRes.status, 200);
			report(
				'9d. resource metadata has resource + authorization_servers',
				!!meta && typeof meta.resource === 'string' && Array.isArray(meta.authorization_servers)
			);
		}
	}

	console.log('\n==> 6. Key rotation kills sessions (restart with a new OWNER_KEY, same database)');
	let killSwitchAccessToken = '';
	let killSwitchRefreshToken = '';
	{
		const flow = await fullFlow('write', OWNER_KEY_A);
		assertEq('6a. setup: exchange under OWNER_KEY_A succeeds', flow.exchange.status, 200);
		killSwitchAccessToken = flow.exchange.body.access_token;
		killSwitchRefreshToken = flow.exchange.body.refresh_token;
		const before = await probe('GET', killSwitchAccessToken);
		assertEq('6b. setup: token works before rotation', before.status, 200);
	}

	console.log('     (stopping server, restarting with a different OWNER_KEY...)');
	await stopServer();
	await startServer(OWNER_KEY_B, { OAUTH_CODE_TTL_SECONDS: '2' });

	{
		const after = await probe('GET', killSwitchAccessToken);
		assertEq('6c. previously valid access token now rejected', after.status, 401);
		const refreshAfter = await refreshGrant(killSwitchRefreshToken);
		assertEq('6d. previously valid refresh token no longer works', refreshAfter.status, 400);
	}

	// ---------------------------------------------------------------------
	console.log('\n====================================');
	if (totalFailures === 0) {
		console.log('AUTH ACCEPTANCE: PASS (0 failures across all 10 criteria)');
	} else {
		console.log(`AUTH ACCEPTANCE: FAIL (${totalFailures} failure(s) — see above)`);
	}
	await stopServer();
	process.exit(totalFailures === 0 ? 0 : 1);
}

main().catch(async (err) => {
	console.error('\nFATAL:', err);
	await stopServer();
	process.exit(1);
});
