<script lang="ts">
	import Hero from '$lib/components/Hero.svelte';
	import Statement from '$lib/components/Statement.svelte';
	import Services from '$lib/components/Services.svelte';
	import PortfolioPreview from '$lib/components/PortfolioPreview.svelte';
	import BouncingBand from '$lib/components/BouncingBand.svelte';
	import Contact from '$lib/components/Contact.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Moco · Estudio creativo</title>
	<meta
		name="description"
		content="Moco — Estudio creativo. Branding, diseño y desarrollo web con personalidad."
	/>
	<!-- Lane B1: one of several deliberately redundant MCP-discovery paths
	     (see src/hooks.server.ts's Link header for the HTTP-header equivalent). -->
	<link rel="mcp-server" href={data.mcpUrl} title="Moco CMS — MCP server (agent discovery)" />
	{@html `<script type="application/ld+json">${data.organizationJsonLd}</script>`}
</svelte:head>

<Hero homeHero={data.homeHero} />
<Statement statement={data.statement} />
<Services services={data.homeServices} />
<PortfolioPreview projects={data.projects} />
<BouncingBand />
<Contact contactCta={data.contactCta} />
