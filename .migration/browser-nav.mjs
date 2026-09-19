#!/usr/bin/env node
/**
 * .migration/browser-nav.mjs — the check `verify.sh`'s __data.json check
 * complements, not replaces.
 *
 * The outage this lane responds to (see LANES.md and PORT variable in
 * browser-nav.sh) was invisible to `curl`: a hard page load always worked
 * (that really is an HTML request), and only IN-APP navigation — a click
 * handled by SvelteKit's client router, which fetches the target route's
 * JSON data endpoint instead of a fresh HTML document — was broken. The
 * `__data.json` check added to verify.sh asserts the SERVER side of that
 * contract (right Content-Type, valid JSON) directly and cheaply. This
 * script asserts the CLIENT side: that a real browser, given that response,
 * actually renders the destination page instead of falling into the site's
 * own error boundary. A bug in the client router's handling of a
 * technically-valid-but-wrong response, or a wrong response the JSON check
 * doesn't happen to probe, would still show up here.
 *
 * Drives a real, installed Google Chrome (not a bundled browser download —
 * see the header comment in browser-nav.sh for why) via `playwright-core`,
 * clicks through home -> Trabajos -> a project -> back -> Estudio, and
 * fails if ANY step:
 *   - lands on the site's own error page (+error.svelte's non-404 branch,
 *     detected by its exact heading text and page title -- both are
 *     content this file owns, not a heuristic)
 *   - logs a browser console error or an uncaught page exception
 *   - ends on the wrong document title (each route sets a distinct
 *     <title>; a stale/error title after a click is a router failure even
 *     if the marker text above happens to not match)
 *
 * This is NOT a simulation: every step is an actual mouse click dispatched
 * to a real Chrome instance, exercising SvelteKit's real client-side
 * router, exactly like a visitor's browser would.
 *
 * Usage: node .migration/browser-nav.mjs <baseUrl>
 * Exit code 0 = every step passed. Exit code 1 = at least one step failed
 * (each failure is printed with which step and why).
 */

import { chromium } from 'playwright-core';

const baseUrl = process.argv[2];
if (!baseUrl) {
	console.error('Usage: node .migration/browser-nav.mjs <baseUrl>');
	process.exit(1);
}

// This exact heading text is +error.svelte's non-404 branch (see
// src/routes/+error.svelte) -- the page every visitor actually saw during
// the outage after their first click. Checked verbatim, not fuzzily,
// because a fuzzy check ("contains 'error'") could false-positive on
// legitimate copy elsewhere on the site.
const ERROR_HEADING = 'Algo salió mal de nuestro lado';
const ERROR_TITLE = 'Algo salió mal · Moco';

let failures = [];
let consoleIssues = [];

function recordConsoleIssues(page, label) {
	// Reset per-step tracking by recording the array length before the step
	// and slicing after -- see runStep().
	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			consoleIssues.push({ label, kind: 'console.error', text: msg.text() });
		}
	});
	page.on('pageerror', (err) => {
		consoleIssues.push({ label, kind: 'pageerror', text: String(err) });
	});
}

async function assertOk(page, label, expectedTitle) {
	const title = await page.title();
	const bodyText = await page.locator('body').innerText();

	if (title === ERROR_TITLE || bodyText.includes(ERROR_HEADING)) {
		failures.push(`[${label}] landed on the site's own error page (title="${title}")`);
		return;
	}
	// expectedTitle is a string (exact match) or a RegExp (pattern match, for
	// the content-driven project page title) -- never skipped, every step
	// asserts something about where it actually landed, not just "no error".
	const titleOk = expectedTitle instanceof RegExp ? expectedTitle.test(title) : title === expectedTitle;
	if (!titleOk) {
		failures.push(`[${label}] unexpected <title>: got "${title}", expected ${expectedTitle}`);
	}
}

async function main() {
	let browser;
	try {
		// playwright-core ships NO browser binaries (that's the point -- see
		// browser-nav.sh). It drives whatever Chrome is already installed via
		// the `channel` option, which is what makes this check cheap enough to
		// run on a designer's laptop instead of a CI box.
		browser = await chromium.launch({ channel: 'chrome', headless: true });
	} catch (err) {
		console.error('Could not launch Google Chrome via playwright-core.');
		console.error('This check drives your ALREADY-INSTALLED Chrome (no browser download) --');
		console.error('install Google Chrome (https://www.google.com/chrome/) and try again.');
		console.error(String(err));
		process.exit(1);
	}

	const page = await browser.newPage();
	recordConsoleIssues(page, 'session');

	const beforeIssues = () => consoleIssues.length;

	// Every step is tried/caught individually: a broken client router can
	// make a step's own action throw (e.g. `page.goBack()` timing out
	// waiting for a `load` that a stuck error page never fires, or a
	// locator never finding a project card because the destination is the
	// error page, not the trabajos grid) rather than merely landing on a
	// wrong title. That thrown exception IS the failure signal, not a crash
	// to propagate -- a check that dies with an unhandled rejection instead
	// of printing FAIL is exactly the kind of check the brief warns is
	// worthless. Once a step fails, later steps are skipped (their
	// preconditions are gone) but the run still reports a clean summary and
	// a non-zero exit code.
	let aborted = false;
	async function runStep(label, expectedTitle, fn) {
		if (aborted) return;
		const before = beforeIssues();
		try {
			await fn();
			await page.waitForTimeout(250); // let a client-side render/error settle
			await assertOk(page, label, expectedTitle);
			console.log(`  ${label} -> ${page.url()} (title: "${await page.title()}")`);
		} catch (err) {
			failures.push(`[${label}] threw: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
			console.log(`  ${label} -> FAILED (${page.url()})`);
			aborted = true;
		}
		const newIssues = consoleIssues.slice(before);
		for (const issue of newIssues) {
			failures.push(`[${label}] ${issue.kind}: ${issue.text}`);
		}
	}

	// 1. Hard load of home -- this is the request that ALWAYS worked during
	// the outage, establishing the starting point.
	await runStep('home (hard load)', 'Moco · Estudio creativo', () =>
		page.goto(`${baseUrl}/`, { waitUntil: 'load' })
	);

	// 2. Client-side nav to Trabajos via the real nav link -- an actual
	// click, which is exactly the request shape (`__data.json`) that broke.
	await runStep('nav click -> Trabajos', 'Trabajos · Moco', () =>
		page.locator('header nav a[href="/trabajos"]').first().click()
	);

	// 3. Click into a real project card. The destination title is
	// content-driven ("<Project name> · Trabajos · Moco"), so match the
	// pattern every real project page shares instead of one exact string.
	await runStep('click project card', /^.+ · Trabajos · Moco$/, () =>
		page.locator('a[href^="/trabajos/"]').first().click({ timeout: 5000 })
	);

	// 4. Browser back -- a real back-navigation, another client-router path.
	await runStep('back -> Trabajos', 'Trabajos · Moco', () =>
		page.goBack({ waitUntil: 'load', timeout: 5000 })
	);

	// 5. Client-side nav to a different section entirely.
	await runStep('nav click -> Estudio', 'Estudio · Moco', () =>
		page.locator('header nav a[href="/estudio"]').first().click({ timeout: 5000 })
	);

	await browser.close();

	console.log('');
	if (failures.length === 0) {
		console.log('PASS: every navigation step rendered its real destination, no console errors.');
		process.exit(0);
	} else {
		console.log(`FAIL: ${failures.length} problem(s) found:`);
		for (const f of failures) console.log(`  !! ${f}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error('browser-nav.mjs crashed:', err);
	process.exit(1);
});
