<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Statement from '$lib/components/Statement.svelte';
	import Services from '$lib/components/Services.svelte';
	import PortfolioPreview from '$lib/components/PortfolioPreview.svelte';
	import BouncingBand from '$lib/components/BouncingBand.svelte';
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
<Statement />
<Services />
<PortfolioPreview />
<BouncingBand />
<Contact />
