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
			<span
				class="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-lg font-extrabold text-lime transition-transform duration-300 group-hover:rotate-12"
				style="font-family: var(--font-display)"
			>
				m
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
