<script lang="ts">
	/**
	 * Site-wide error page (Lane B2). Renders inside the root layout (Nav +
	 * Footer still show, per SvelteKit's error-boundary nesting) for BOTH an
	 * expected 404 (`error(404, ...)` from a route's `load`, e.g. an unknown
	 * project slug) and an unexpected failure (Postgres/storage unreachable,
	 * a bug) — distinguished below by `page.status`.
	 *
	 * Copy is Spanish/voseo to match the rest of the site, written for the
	 * studio's own non-technical owner and clients: no stack traces, no
	 * jargon, no error code as the headline. `page.error.message` (set by
	 * `handleError` in `src/hooks.server.ts`) is already safe to show
	 * verbatim for a 5xx — see that file's doc comment — but this page
	 * doesn't even use it as the headline, only as supporting text, and the
	 * `errorId` (present only for a 5xx) appears as small print, not a
	 * headline, purely so the owner has something to quote if they ask for
	 * help.
	 *
	 * This file is intentionally the ONLY thing here that's Moco-specific
	 * (the copy) — the mechanism (`handleError`, `App.Error`,
	 * `+error.svelte` existing at all) lives in generic files any future
	 * client site inherits as-is; only the words on this page are content.
	 */
	import { page } from '$app/state';

	const isNotFound = $derived(page.status === 404);
	const errorId = $derived(page.error?.errorId);
</script>

<svelte:head>
	<title>{isNotFound ? 'Página no encontrada' : 'Algo salió mal'} · Moco</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<section class="flex min-h-[70vh] items-center px-5 pt-32 pb-20 sm:px-8 sm:pt-40 sm:pb-28">
	<div class="mx-auto flex max-w-2xl flex-col items-start gap-6 text-left">
		<span
			class="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-2xl font-bold text-lime"
			style="font-family: var(--font-display)"
		>
			{isNotFound ? '?' : '!'}
		</span>

		{#if isNotFound}
			<h1
				class="text-4xl font-extrabold tracking-tight sm:text-6xl"
				style="font-family: var(--font-display)"
			>
				No encontramos esta página
			</h1>
			<p class="max-w-lg text-lg text-ink-soft">
				Puede que el enlace esté roto o que la página se haya movido. Revisá la dirección, o
				volvé a un lugar conocido.
			</p>
		{:else}
			<h1
				class="text-4xl font-extrabold tracking-tight sm:text-6xl"
				style="font-family: var(--font-display)"
			>
				Algo salió mal de nuestro lado
			</h1>
			<p class="max-w-lg text-lg text-ink-soft">
				Ya quedó registrado y lo vamos a revisar. Mientras tanto, probá de nuevo en un momento o
				volvé al inicio.
			</p>
		{/if}

		<div class="mt-2 flex flex-wrap items-center gap-4">
			<a
				href="/"
				class="rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink transition-all hover:bg-ink hover:text-cream"
			>
				Volver al inicio
			</a>
			<a
				href="/contacto"
				class="text-sm font-medium underline-offset-4 hover:text-ink hover:underline"
			>
				Escribinos si el problema sigue
			</a>
		</div>

		{#if errorId}
			<p class="mt-4 text-xs text-muted">Código de referencia: {errorId}</p>
		{/if}
	</div>
</section>
