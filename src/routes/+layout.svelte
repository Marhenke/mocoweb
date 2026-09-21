<script lang="ts">
	import './layout.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { page } from '$app/state';

	let { children } = $props();

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
	<Nav />
	<main>
		{@render children()}
	</main>
	<Footer />
{/if}
