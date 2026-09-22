<script lang="ts">
	import './layout.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { children, data } = $props();

	// ── Lane B8: preview mode must not leak back to the live site ───────────
	// Must match `PREVIEW_QUERY_PARAM` in
	// `$lib/server/cms/auth/preview-token.ts` — duplicated as a plain string
	// (not imported) because that module lives under `$lib/server/`,
	// SvelteKit's server-only import boundary, which this client component
	// can never cross.
	//
	// The bug this fixes: the preview token travels only in the URL's query
	// string (deliberately never a cookie — see `preview-token.ts`'s header).
	// The site's own internal links don't carry it, so clicking ANY link
	// inside a preview — nav, a project card, "Volver a trabajos" — silently
	// lands on the real published page while the owner still believes
	// they're looking at the preview: it fails quietly and misleads, letting
	// someone approve a change after "checking" a page that never actually
	// showed it.
	//
	// Two mechanisms, deliberately both present (see this lane's brief — the
	// coordinator's own guidance matches what turned out to be necessary in
	// practice, verified against the real client router):
	//   1. `hooks.server.ts` rewrites every same-origin relative `href`/
	//      `action` in the SERVER-RENDERED HTML of a preview response to
	//      carry the token. This is what makes a hard reload, and — because
	//      Nav/Footer are part of THIS layout and never re-render across a
	//      client-side navigation — every subsequent client-side navigation
	//      through the nav/footer chrome, stay in preview.
	//   2. The capturing click listener below. A client-side navigation to a
	//      route's own PAGE content (e.g. a ProjectCard on /trabajos, or the
	//      "Volver a trabajos"/next-project links on a project page) re-
	//      renders that markup from Svelte's own compiled template — which
	//      has no idea it's in preview — every time the client router swaps
	//      pages, so the server-side rewrite above (which only ever touches
	//      the ONE html document that was actually served) cannot reach
	//      those. This listener mutates the clicked anchor's `href` in place,
	//      in the CAPTURE phase (before SvelteKit's own bubble-phase click
	//      handler reads it, and before a ctrl/cmd/middle-click's default
	//      "open in new tab" action resolves it), for any left as-yet-
	//      untokened same-origin relative link — covering every remaining
	//      case in one net, regardless of which component rendered the link
	//      or how it was clicked.
	//
	// External links are NEVER touched by either mechanism (both check
	// same-origin explicitly) — the token is a credential for this site's
	// drafts and must not leak to another origin via a URL or a Referer
	// header (see `hooks.server.ts`'s `Referrer-Policy: no-referrer` on every
	// preview response for the second half of that).
	const PREVIEW_PARAM = '__preview';

	function interceptPreviewLink(event: MouseEvent): void {
		if (!data.preview) return;
		if (event.defaultPrevented) return;
		const target = event.target as HTMLElement | null;
		const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
		if (!anchor) return;
		let url: URL;
		try {
			url = new URL(anchor.getAttribute('href') ?? '', window.location.href);
		} catch {
			return;
		}
		if (url.origin !== window.location.origin) return; // never touch external links
		if (url.searchParams.has(PREVIEW_PARAM)) return; // already carries a token (or the exit link's empty marker)
		const currentToken = new URLSearchParams(window.location.search).get(PREVIEW_PARAM);
		if (!currentToken) return;
		url.searchParams.set(PREVIEW_PARAM, currentToken);
		anchor.href = `${url.pathname}${url.search}${url.hash}`;
	}

	onMount(() => {
		window.addEventListener('click', interceptPreviewLink, true);
		return () => window.removeEventListener('click', interceptPreviewLink, true);
	});

	/** The explicit way out: same page, same other params, with an empty (never-verifying) preview token — falls straight through to the live render, per `verifyPreviewToken`'s `!token` early return. */
	let exitHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.searchParams);
		params.set(PREVIEW_PARAM, '');
		return `${page.url.pathname}?${params.toString()}`;
	});

	// The admin chat panel (Lane B5, /admin) is its own focused, full-screen
	// surface — a login form and then a chat pinned to the viewport, not a
	// page of the public marketing site — so it skips the public Nav/Footer.
	//
	// Tried first: SvelteKit's `+layout@.svelte` route-level "reset" file
	// under src/routes/admin/. That mechanism resets to an ANCESTOR layout,
	// and the outermost ancestor it can reset to is THIS root layout itself
	// — there is no way for a route to opt out of the root layout entirely,
	// so that file was a silent no-op (Nav/Footer still rendered on /admin,
	// confirmed by driving it in a real browser). Removed.
	//
	// This `{#if}` is the one place that actually works — but Svelte 5 SSR
	// emits hydration-boundary comment markers around an `{#if}` block
	// regardless of which branch renders, which showed up as an inert
	// (zero visible/behavioral difference — see the Lane B5 report) but
	// real diff on all 10 of `.migration/verify.sh`'s baselined public
	// routes purely from THIS block existing, even on routes that render
	// through the `{:else}` branch. `.migration/baseline/*.html` was
	// re-captured to account for it, and the gate's liveness was re-proven
	// (a real content mutation still makes it FAIL; reverting makes it
	// PASS again) — see the report for that evidence. Any route added
	// under `{:else}` renders byte-identically to before this change.
	let isAdmin = $derived(page.url.pathname === '/admin' || page.url.pathname.startsWith('/admin/'));
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon-96x96.png?v=20260624" sizes="96x96" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20260624" />
	<link rel="shortcut icon" href="/favicon.ico?v=20260624" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20260624" />
	<meta name="apple-mobile-web-app-title" content="Moco Estudio" />
	<link rel="manifest" href="/site.webmanifest?v=20260624" />
</svelte:head>

{#if isAdmin}
	{@render children()}
{:else}
	{#if data.preview}
		<div class="preview-banner" role="status">
			<span>👁️ Estás viendo una <strong>vista previa</strong> — nadie más ve esto todavía.</span>
			<a href={exitHref} data-preview-exit>Salir de la vista previa</a>
		</div>
	{/if}
	<Nav />
	<main>
		{@render children()}
	</main>
	<Footer />
{/if}

<style>
	.preview-banner {
		position: sticky;
		top: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.5rem 1rem;
		background: var(--color-lime, #c8f135);
		color: var(--color-ink, #16140f);
		font-size: 0.85rem;
		font-weight: 600;
		text-align: center;
	}
	.preview-banner a {
		text-decoration: underline;
		white-space: nowrap;
	}
</style>
