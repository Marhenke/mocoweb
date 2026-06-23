<script lang="ts">
	import { page } from '$app/state';

	let open = $state(false);
	let scrolled = $state(false);

	const links = [
		{ href: '/nosotros', label: 'Nosotros' },
		{ href: '/trabajos', label: 'Trabajos' },
		{ href: '/contacto', label: 'Contacto' }
	];

	function close() {
		open = false;
	}

	const isActive = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');

	// Páginas con hero oscuro arriba de todo (home con video, nosotros con
	// fondo negro): mientras no se hizo scroll, el menú usa texto claro.
	const darkHero = $derived(page.url.pathname === '/' || page.url.pathname === '/nosotros');
	const overHero = $derived(darkHero && !scrolled);

	$effect(() => {
		const onScroll = () => (scrolled = window.scrollY > 20);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<header
	class="fixed inset-x-0 top-0 z-50 transition-all duration-300 {scrolled
		? 'border-b border-ink/10 bg-cream/80 backdrop-blur-md'
		: ''}"
>
	<nav
		class="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 transition-all duration-300 sm:px-8 sm:py-5"
	>
		<a href="/" class="group flex items-center gap-2" onclick={close}>
			<span class="flex h-9 w-9 items-center justify-center rounded-full bg-ink transition-transform duration-700 group-hover:rotate-180">
				<svg viewBox="0 0 359.97 301.96" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5">
					<path fill="#c8f136" d="M244.52,0c-.16,1.73,2.33,2.35,3.52,3.89,10.49,13.58,5.92,45.39-6.36,59.71-11.33,13.21-19.34,28.57-18.48,46.22.42,8.61,5,15.24,13.49,17.72,12.71,3.7,27.56,3.92,39.8-2.14,6.23-3.08,11.28-6.93,18.07-8.99,57.29-17.35,62.38,15.66,63.99,16.53.41.22,1,.21,1.4.31v13.29c-1.84-.1-2.11,1.8-2.77,3.64-2.01,5.68-6.51,9.53-11.66,12.44-14.86,8.38-32.07,10.2-48.81,6.67-22.2-4.69-62.34-8.3-61.98,15.68.3,20.24,6.67,38.15,24.76,47.56,13.57,7.06,31.88,20.24,37.01,33.75,2.7,7.11-.62,13.06-6.26,16.91-9.7,6.62-21.09,6.57-30.07-1.65-7.53-6.9-13.14-15.69-17.45-25.3-6.59-14.7-16.29-27.65-30.24-35.55-9.12-5.16-18.85-3.45-24.62,5.35-3.23,4.93-6.68,12.08-3.99,17.99,4.04,8.87,5.27,17.24,5.51,27.05.32,13.22-6.34,25.61-18.65,30.88h-7.3c-11.23-4.31-18.23-15.93-16.4-29.11l5.93-26.93c1.33-6.02,1.76-11.83-.16-17.62-1.64-4.97-5.27-8.33-10.8-7.31-11.45,2.13-23.96,10.83-33.4,18.56-4.84,3.97-8.42,8.32-10.95,14.13-5.01,11.5-10.86,22.33-18.95,31.94-10.55,12.53-21.99,12.61-35.12,3.8-7.67-5.15-10.92-14.27-6.94-22.85,9.74-20.96,21.35-25.41,40.43-36.49,12.04-6.99,20.79-17.83,22.1-32.06.57-6.28-1.69-11.93-7.28-15.07-7.98-4.48-17.46-6.6-26.98-4.91-17.04,3.01-34.29,3.4-50.69-2.13-6.56-2.21-11.5-6.14-14.21-12.21l-.02-12.73c.88-.22,1.66-.86,2.04-2.06,6.38-20.13,28.18-23.87,48.71-18.66l30.29,7.69c11.85,3.01,29.47,4.95,34.52-3.34l7.97-13.06c1.86-3.05,2.28-7.44.52-10.64-9.63-17.51-24.66-22.36-36.18-32.86-5.38-4.91-9.83-11.34-11.19-18.63-2.82-15.21,2.45-39.66,16.25-39.14,23.55.9,28.19,40.33,53.1,67.5,7.37,8.04,16.05,11.78,27.08,11.56,25.99-.52,21.86-31.81,24.25-56.89,1.72-18.11,11.96-33.6,28.99-40.13,1.6-.61,3.24-.63,3.81-2.31h14.36Z"/>
				</svg>
			</span>
			<span
				class="text-xl font-extrabold tracking-tight transition-colors {overHero ? 'text-cream' : ''}"
				style="font-family: var(--font-display)">moco</span
			>
		</a>

		<div class="hidden items-center gap-8 md:flex">
			{#each links as link}
				<a
					href={link.href}
					class="relative text-sm font-medium transition-colors after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:bg-lime after:transition-all hover:after:w-full {overHero
						? 'text-cream/80 hover:text-cream'
						: 'hover:text-ink'} {isActive(link.href)
						? (overHero ? 'text-cream' : 'text-ink') + ' after:w-full'
						: (overHero ? '' : 'text-ink-soft') + ' after:w-0'}">{link.label}</a
				>
			{/each}
			<a
				href="/contacto"
				class="rounded-full px-5 py-2.5 text-sm font-semibold transition-all {overHero
					? 'bg-cream text-ink hover:bg-lime'
					: 'bg-ink text-cream hover:bg-lime hover:text-ink'}">Hablemos</a
			>
		</div>

		<button
			class="flex h-10 w-10 items-center justify-center md:hidden"
			onclick={() => (open = !open)}
			aria-label="Menú"
		>
			<div class="flex flex-col gap-1.5">
				<span
					class="h-0.5 w-6 transition-all {overHero && !open ? 'bg-cream' : 'bg-ink'}"
					class:translate-y-2={open}
					class:rotate-45={open}
				></span>
				<span
					class="h-0.5 w-6 transition-all {overHero && !open ? 'bg-cream' : 'bg-ink'}"
					class:opacity-0={open}
				></span>
				<span
					class="h-0.5 w-6 transition-all {overHero && !open ? 'bg-cream' : 'bg-ink'}"
					class:-translate-y-2={open}
					class:-rotate-45={open}
				></span>
			</div>
		</button>
	</nav>

	{#if open}
		<div class="mx-4 rounded-3xl bg-ink p-6 text-cream md:hidden">
			<div class="flex flex-col gap-1">
				{#each links as link}
					<a
						href={link.href}
						onclick={close}
						class="rounded-xl px-4 py-3 text-lg font-semibold hover:bg-white/10 {isActive(link.href)
							? 'text-lime'
							: ''}">{link.label}</a
					>
				{/each}
				<a
					href="/contacto"
					onclick={close}
					class="mt-2 rounded-xl bg-lime px-4 py-3 text-center text-lg font-semibold text-ink"
					>Hablemos</a
				>
			</div>
		</div>
	{/if}
</header>
