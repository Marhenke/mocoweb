<script lang="ts">
	import { projects } from '$lib/data/projects';
	import ProjectCard from './ProjectCard.svelte';

	const featured = projects.slice(0, 4);
</script>

<section id="trabajos" class="px-5 py-24 sm:px-8 sm:py-32">
	<div class="mx-auto max-w-7xl">
		<div class="mb-14 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<p class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Trabajos</p>
				<h2
					class="text-4xl font-extrabold tracking-tight sm:text-6xl"
					style="font-family: var(--font-display)"
				>
					Algo de lo que hicimos.
				</h2>
			</div>
			<a
				href="/trabajos"
				class="text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
				>Ver todos los trabajos →</a
			>
		</div>

		<div class="grid gap-6 sm:grid-cols-2">
			{#each featured as project}
				<ProjectCard {project} />
			{/each}
		</div>
	</div>
</section>
