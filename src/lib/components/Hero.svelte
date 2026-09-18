<script lang="ts">
	import type { HomeHero } from '$lib/types';

	let { homeHero }: { homeHero: HomeHero } = $props();
</script>

<section
	id="inicio"
	class="relative flex min-h-dvh flex-col justify-center overflow-hidden px-5 pt-28 pb-16 text-cream sm:px-8 sm:pt-32"
>
	<!-- video de fondo -->
	<video
		class="pointer-events-none absolute inset-0 h-full w-full object-cover"
		src={homeHero.videoSrc}
		poster={homeHero.videoPoster}
		autoplay
		muted
		loop
		playsinline
	></video>
	<!-- capa oscura para que el texto se lea -->
	<div class="pointer-events-none absolute inset-0 bg-ink/55"></div>

	<div class="relative mx-auto max-w-7xl">
		<p class="float-up mb-6 flex items-center gap-2 text-sm font-semibold tracking-wide text-cream/80 uppercase">
			<span class="inline-block h-2 w-2 rounded-full bg-lime"></span>
			{homeHero.eyebrow}
		</p>

		<h1
			class="float-up max-w-5xl text-6xl leading-[0.95] font-extrabold tracking-tight sm:text-[clamp(2rem,8.5vw,7.5rem)]"
			style="font-family: var(--font-display)"
		>
			<span class="block sm:inline">{homeHero.headlineLines[0]}</span>
			<span class="block sm:inline">{homeHero.headlineLines[1]}</span>
			<span class="block sm:inline">{homeHero.headlineLines[2]}</span>
			<br class="hidden sm:block" />
			<span class="sm:whitespace-nowrap"
				><span class="block sm:inline">{homeHero.highlightLead}</span>
				<span class="bg-lime text-ink block w-fit -rotate-2 rounded-2xl px-4 pb-2 sm:inline-block"
					>{homeHero.highlightWord}</span
				></span
			>
		</h1>

		<div class="float-up mt-10 flex flex-wrap items-center gap-4">
			<a
				href={homeHero.ctaHref}
				class="rounded-full bg-lime px-5 py-2 text-sm font-semibold text-ink transition-all hover:bg-cream sm:px-7 sm:py-4 sm:text-base"
				>{homeHero.ctaLabel}</a
			>
		</div>
	</div>
</section>

<!-- Marquee -->
<div class="overflow-hidden border-y border-ink/10 bg-ink py-4 text-cream">
	<div class="flex w-max animate-marquee gap-8 whitespace-nowrap text-2xl font-extrabold sm:text-3xl" style="font-family: var(--font-display)">
		{#each Array(2) as _}
			<span class="flex items-center gap-8">
				<span>{homeHero.marqueeItems[0]}</span><span class="text-lime">✦</span>
				<span>{homeHero.marqueeItems[1]}</span><span class="text-lime">✦</span>
				<span>{homeHero.marqueeItems[2]}</span><span class="text-lime">✦</span>
				<span>{homeHero.marqueeItems[3]}</span><span class="text-lime">✦</span>
				<span>{homeHero.marqueeItems[4]}</span><span class="text-lime">✦</span>
			</span>
		{/each}
	</div>
</div>
