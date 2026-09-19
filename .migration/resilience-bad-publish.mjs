#!/usr/bin/env node
/**
 * Helper for .migration/resilience.sh, check 5 ("bad publish").
 *
 * Proves the property the migration brief calls "publish must validate by
 * rendering": drives the CMS exactly like a real MCP agent would (register
 * → authorize (PKCE) → exchange → tools/call) over real HTTP against the
 * already-running resilience server, and touches Postgres directly (via the
 * `postgres` package, already a project dependency — same pattern as
 * .migration/smoke-test.ts) ONLY to put one collection (`homeHero`, a
 * singleton) into a state no MCP tool would ever produce: two published
 * rows. `src/lib/server/cms/content.ts`'s `fetchSingleton` throws if it
 * ever finds anything other than exactly one, so rendering "/" (which has a
 * `homeHero` region) now genuinely fails — this simulates "content is
 * broken for some reason" without needing to invent a fake bug, and proves
 * the render-validation gate catches a real invariant violation, not just a
 * contrived error() call.
 *
 * With that corruption in place, publishing an UNRELATED collection
 * (`projects`, which also backs "/") should be REFUSED, and the DB rows it
 * would have touched must be provably unchanged — not just "the visible
 * page looks the same" (that's true independent of this test, since page
 * reads never touch Postgres on a cache hit; the actual proof is the
 * database snapshot comparison below).
 *
 * Usage: node .migration/resilience-bad-publish.mjs <baseUrl> <ownerKey>
 * Requires DATABASE_URL in the environment. Exit 0 = check passed.
 */
import postgres from 'postgres';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

const [, , BASE_URL, OWNER_KEY] = process.argv;
if (!BASE_URL || !OWNER_KEY) {
	console.error('usage: resilience-bad-publish.mjs <baseUrl> <ownerKey>');
	process.exit(2);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL is not set.');
	process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 1 });

function must(condition, message) {
	if (!condition) throw new Error(message);
}

function pkcePair() {
	const verifier = randomBytes(48).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

async function getPublishScopedAccessToken() {
	const redirectUri = 'http://127.0.0.1:9/callback'; // never actually dereferenced
	const reg = await fetch(`${BASE_URL}/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ client_name: 'resilience-check', redirect_uris: [redirectUri] })
	});
	const regBody = await reg.json();
	must(reg.status === 201, `register failed: ${reg.status} ${JSON.stringify(regBody)}`);
	const clientId = regBody.client_id;

	const { verifier, challenge } = pkcePair();
	const form = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		owner_key: OWNER_KEY,
		granted_scope: 'publish'
	});

	const authRes = await fetch(`${BASE_URL}/authorize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: form.toString(),
		redirect: 'manual'
	});
	const location = authRes.headers.get('location');
	must(location, `authorize did not redirect (status ${authRes.status})`);
	const code = new URL(location).searchParams.get('code');
	must(code, `no authorization code in redirect: ${location}`);

	const tokenRes = await fetch(`${BASE_URL}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier
		}).toString()
	});
	const tokenBody = await tokenRes.json();
	must(tokenRes.status === 200, `token exchange failed: ${tokenRes.status} ${JSON.stringify(tokenBody)}`);
	return tokenBody.access_token;
}

async function callTool(accessToken, name, args) {
	const res = await fetch(`${BASE_URL}/api/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: randomUUID(),
			method: 'tools/call',
			params: { name, arguments: args }
		})
	});
	const body = await res.json();
	return { status: res.status, body };
}

async function projectsSnapshot() {
	return sql`
		select id, slug, published_data, published_position, status
		from entries
		where collection_key = 'projects'
		order by slug
	`;
}

let dupSlug = null;
try {
	const accessToken = await getPublishScopedAccessToken();
	console.log('  obtained a publish-scope access token via a real OAuth/PKCE round trip');

	const before = await projectsSnapshot();
	must(before.length > 0, 'no published "projects" entries found -- is seed data present?');

	// Corrupt: give the `homeHero` singleton a second PUBLISHED row directly
	// in Postgres. No MCP tool can produce this (create_entry refuses a
	// second row for a singleton) -- this simulates "the data is broken for
	// some reason" so the render-validation gate is tested against a real
	// invariant violation, not a contrived failure.
	const [heroRow] = await sql`select * from entries where collection_key = 'homeHero' limit 1`;
	must(heroRow, 'no homeHero row found -- is the seed data present?');
	dupSlug = `resilience-corrupt-${Date.now()}`;
	await sql`
		insert into entries
			(collection_key, slug, position, status, data, published_data, published_position, pending_delete)
		values (
			'homeHero', ${dupSlug}, 999, 'published',
			${JSON.stringify(heroRow.data)}::jsonb, ${JSON.stringify(heroRow.data)}::jsonb,
			999, false
		)
	`;
	console.log('  corrupted homeHero: 2 published rows now exist (violates the singleton invariant)');

	// Publishing an UNRELATED collection that also renders "/" (projects)
	// must be refused, because "/" can no longer render at all.
	const { status, body } = await callTool(accessToken, 'publish', { collection: 'projects' });
	const resultText = body?.result?.content?.[0]?.text ?? JSON.stringify(body);
	const isError = body?.result?.isError === true;

	must(status === 200, `tools/call HTTP status was ${status}, expected 200 (JSON-RPC envelope)`);
	must(isError, `publish should have been REFUSED (isError: true) but got: ${resultText}`);
	must(/refused/i.test(resultText), `refusal message should say "refused": ${resultText}`);
	console.log('  publish tool refused the publish, as required:');
	console.log('    ' + resultText.split('\n')[0]);

	const after = await projectsSnapshot();
	const unchanged = JSON.stringify(before) === JSON.stringify(after);
	must(
		unchanged,
		`"projects" entries changed in the DB despite the refusal -- before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
	);
	console.log('  DB snapshot of "projects" is byte-identical before/after -- the write was fully rolled back');

	console.log('PASS: a publish that could not render was refused, and the previously published version is intact.');
} finally {
	if (dupSlug) {
		await sql`delete from entries where collection_key = 'homeHero' and slug = ${dupSlug}`;
		console.log('  cleanup: removed the corrupted homeHero row');
	}
	await sql.end();
}
