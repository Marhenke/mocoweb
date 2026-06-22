<script lang="ts">
	const fonts = [
		'Georgia, serif',
		'"Courier New", monospace',
		'Impact, "Arial Narrow", sans-serif',
		'"Times New Roman", serif',
		'"Arial Black", Gadget, sans-serif',
		'"Trebuchet MS", sans-serif',
		"'Inter', sans-serif",
	];

	function onEnter(e: MouseEvent) {
		const el = e.currentTarget as HTMLElement;
		const pick = fonts[Math.floor(Math.random() * fonts.length)];
		el.style.fontFamily = pick;
	}

	function onLeave(e: MouseEvent) {
		const el = e.currentTarget as HTMLElement;
		el.style.fontFamily = '';
	}

	const words = [
		'El', 'mundo', 'merece', 'conocerte,', 'nosotros', 'te',
		'podemos', 'ayudar.',
	];
</script>

<section class="bg-lime px-5 py-24 sm:px-8 sm:py-32">
	<div class="mx-auto max-w-5xl">
		<p
			class="text-3xl font-extrabold leading-[1.15] tracking-tight text-ink sm:text-5xl lg:text-6xl"
			style="font-family: var(--font-display)"
		>
			{#each words as word, i}
				<span
					class="cursor-default"
					onmouseenter={onEnter}
					onmouseleave={onLeave}
				>{word}</span>{i < words.length - 1 ? ' ' : ''}
			{/each}
		</p>
	</div>
</section>
