<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Services from '$lib/components/Services.svelte';
	import PortfolioPreview from '$lib/components/PortfolioPreview.svelte';
	import Contact from '$lib/components/Contact.svelte';
</script>

<svelte:head>
	<title>Moco · Estudio creativo</title>
	<meta
		name="description"
		content="Moco — Estudio creativo. Branding, diseño y desarrollo web con personalidad."
	/>
</svelte:head>

<Hero />
<Services />
<PortfolioPreview />
<Contact />
