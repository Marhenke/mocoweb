<script lang="ts">
	import type { Project } from '$lib/data/projects';

	let { project }: { project: Project } = $props();
</script>

<a
	href="/trabajos/{project.slug}"
	class="group relative block aspect-[4/3] overflow-hidden rounded-3xl p-8 transition-transform duration-300 hover:-translate-y-1.5"
	style="background: {project.bg}; color: {project.ink}"
>
	<div class="flex items-center justify-between text-sm font-semibold opacity-80">
		<span>{project.category}</span>
		<span>{project.year}</span>
	</div>
	<h3
		class="absolute bottom-8 left-8 text-4xl font-extrabold sm:text-5xl"
		style="font-family: var(--font-display)"
	>
		{project.title}
	</h3>
	<span
		class="absolute right-8 bottom-8 flex h-12 w-12 translate-y-2 items-center justify-center rounded-full bg-current/15 text-2xl opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
		>↗</span
	>
</a>
