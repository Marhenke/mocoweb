<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProjectCard from '$lib/components/ProjectCard.svelte';
	import Contact from '$lib/components/Contact.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Trabajos · Moco</title>
	<meta name="description" content="Proyectos de branding, diseño web, dirección de arte y packaging del estudio Moco." />
</svelte:head>

<PageHeader
	eyebrow={data.trabajosHeader.eyebrow}
	title={data.trabajosHeader.title}
	intro={data.trabajosHeader.intro}
/>

<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-7xl">
		<div class="grid gap-6 sm:grid-cols-2">
			{#each data.projects as project}
				<ProjectCard {project} />
			{/each}
		</div>
	</div>
</section>

<Contact contactCta={data.contactCta} />
