<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProjectCard from '$lib/components/ProjectCard.svelte';
	import Contact from '$lib/components/Contact.svelte';
	import { projects } from '$lib/data/projects';
</script>

<svelte:head>
	<title>Trabajos · Moco</title>
	<meta name="description" content="Proyectos de branding, diseño web, dirección de arte y packaging del estudio Moco." />
</svelte:head>

<PageHeader
	eyebrow="Trabajos"
	title="Marcas con las que nos divertimos."
	intro="Una selección de proyectos. Cada uno empezó con una charla y terminó en algo con identidad propia."
/>

<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-7xl">
		<div class="grid gap-6 sm:grid-cols-2">
			{#each projects as project}
				<ProjectCard {project} />
			{/each}
		</div>
	</div>
</section>

<Contact />
