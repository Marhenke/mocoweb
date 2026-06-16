<script lang="ts">
	let {
		eyebrow,
		title,
		intro = ''
	}: { eyebrow: string; title: string; intro?: string } = $props();
</script>

<header class="relative overflow-hidden px-5 pt-32 pb-12 sm:px-8 sm:pt-40 sm:pb-16">
	<div
		class="pointer-events-none absolute -top-24 right-[-10%] h-[24rem] w-[24rem] rounded-full bg-lime/30 blur-3xl"
	></div>
	<div class="relative mx-auto max-w-7xl">
		<p class="float-up mb-5 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
			<span class="inline-block h-2 w-2 rounded-full bg-lime"></span>
			{eyebrow}
		</p>
		<h1
			class="float-up max-w-4xl text-[2.8rem] leading-[0.95] font-extrabold tracking-tight sm:text-7xl"
			style="font-family: var(--font-display)"
		>
			{title}
		</h1>
		{#if intro}
			<p class="float-up mt-6 max-w-2xl text-lg text-ink-soft sm:text-xl">{intro}</p>
		{/if}
	</div>
</header>
