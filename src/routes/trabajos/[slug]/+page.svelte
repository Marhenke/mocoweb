<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { project, next } = $derived(data);
</script>

<svelte:head>
	<title>{project.title} · Trabajos · Moco</title>
	<meta name="description" content={project.summary} />
</svelte:head>

<!-- Encabezado del proyecto -->
<header class="px-5 pt-32 pb-10 sm:px-8 sm:pt-40 sm:pb-14">
	<div class="mx-auto max-w-7xl">
		<a
			href="/trabajos"
			class="text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
			>← Volver a trabajos</a
		>
		<p class="mt-8 text-sm font-semibold tracking-wide text-muted uppercase">{project.category}</p>
		<h1
			class="float-up mt-3 max-w-4xl text-5xl font-extrabold tracking-tight sm:text-8xl"
			style="font-family: var(--font-display)"
		>
			{project.title}
		</h1>
		<p class="mt-6 max-w-2xl text-lg text-ink-soft sm:text-xl">{project.summary}</p>
	</div>
</header>

<!-- Portada (placeholder) -->
<section class="px-5 sm:px-8">
	<div class="mx-auto max-w-7xl">
		<div
			class="flex aspect-[16/9] items-center justify-center rounded-3xl"
			style="background: {project.bg}; color: {project.ink}"
		>
			<span class="text-sm font-semibold opacity-60">Imagen de portada</span>
		</div>
	</div>
</section>

<!-- Datos del proyecto -->
<section class="px-5 py-16 sm:px-8 sm:py-24">
	<div class="mx-auto grid max-w-7xl gap-12 lg:grid-cols-3 lg:gap-16">
		<!-- Ficha -->
		<aside class="space-y-8 lg:col-span-1">
			<div>
				<h2 class="text-xs font-bold tracking-wide text-muted uppercase">Cliente</h2>
				<p class="mt-2 text-lg font-medium">{project.client}</p>
			</div>
			<div>
				<h2 class="text-xs font-bold tracking-wide text-muted uppercase">Año</h2>
				<p class="mt-2 text-lg font-medium">{project.year}</p>
			</div>
			<div>
				<h2 class="text-xs font-bold tracking-wide text-muted uppercase">Servicios</h2>
				<ul class="mt-2 flex flex-wrap gap-2">
					{#each project.services as service}
						<li class="rounded-full border border-ink/15 px-3 py-1 text-sm font-medium text-ink-soft">
							{service}
						</li>
					{/each}
				</ul>
			</div>
		</aside>

		<!-- Texto -->
		<div class="space-y-10 lg:col-span-2">
			<div>
				<h2 class="text-2xl font-bold sm:text-3xl" style="font-family: var(--font-display)">
					El desafío
				</h2>
				<p class="mt-4 text-lg text-ink-soft">{project.challenge}</p>
			</div>
			<div>
				<h2 class="text-2xl font-bold sm:text-3xl" style="font-family: var(--font-display)">
					Lo que hicimos
				</h2>
				<p class="mt-4 text-lg text-ink-soft">{project.solution}</p>
			</div>
		</div>
	</div>
</section>

<!-- Galería (placeholders) -->
<section class="px-5 pb-20 sm:px-8 sm:pb-28">
	<div class="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2">
		{#each project.gallery as block, i}
			<div
				class="flex items-center justify-center rounded-3xl"
				class:sm:col-span-2={i === 0}
				style="background: {block}; aspect-ratio: {i === 0 ? '16/9' : '4/3'}; color: {project.ink}"
			>
				<span class="text-sm font-semibold opacity-50">Imagen {i + 1}</span>
			</div>
		{/each}
	</div>
</section>

<!-- Siguiente proyecto -->
<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-7xl">
		<a
			href="/trabajos/{next.slug}"
			class="group flex flex-col gap-2 rounded-3xl border border-ink/10 p-8 transition-colors hover:bg-cream-dark sm:flex-row sm:items-center sm:justify-between sm:p-12"
		>
			<div>
				<p class="text-sm font-semibold tracking-wide text-muted uppercase">Siguiente proyecto</p>
				<h2 class="mt-2 text-3xl font-extrabold sm:text-5xl" style="font-family: var(--font-display)">
					{next.title}
				</h2>
			</div>
			<span
				class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink text-2xl text-cream transition-transform group-hover:translate-x-1"
				>→</span
			>
		</a>
	</div>
</section>
