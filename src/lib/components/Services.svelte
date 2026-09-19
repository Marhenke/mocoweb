<script lang="ts">
	import type { HomeService } from '$lib/types';

	let { services }: { services: HomeService[] } = $props();
</script>

<section id="servicios" class="px-5 py-24 sm:px-8 sm:py-32">
	<div class="mx-auto max-w-7xl">
		<div class="mb-14 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div>
				<p class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Qué hacemos</p>
				<h2
					class="max-w-2xl text-4xl font-extrabold tracking-tight sm:text-6xl"
					style="font-family: var(--font-display)"
				>
					¿Qué necesitás?
				</h2>
			</div>
		</div>

		<div class="grid gap-px overflow-hidden rounded-3xl border border-ink/10 bg-ink/10 sm:grid-cols-2">
			{#each services as s}
				<a
					href="/estudio"
					class="group bg-cream p-8 transition-colors hover:bg-ink sm:p-10"
				>
					<div class="flex items-start justify-between">
						<span class="text-sm font-bold text-muted transition-colors group-hover:text-cream/60">{s.n}</span>
						<span
							class="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-ink transition-all group-hover:rotate-45 group-hover:bg-lime"
							>↗</span
						>
					</div>
					<h3
						class="mt-6 text-2xl font-bold transition-colors group-hover:text-lime sm:text-3xl"
						style="font-family: var(--font-display)"
					>
						{s.title}
					</h3>
					<p class="mt-3 max-w-md text-ink-soft transition-colors group-hover:text-cream">{s.desc}</p>
				</a>
			{/each}
		</div>
	</div>
</section>
