<script lang="ts">
	import type { ContactCta } from '$lib/types';

	let { contactCta }: { contactCta: ContactCta } = $props();
</script>

<section id="contacto" class="px-5 py-24 sm:px-8 sm:py-32">
	<div
		class="relative mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-lime px-6 py-16 text-ink sm:px-16 sm:py-24"
	>
		<div class="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-ink/10 blur-2xl"></div>

		<div class="relative">
			<p class="mb-4 text-sm font-semibold tracking-wide uppercase opacity-70">Contacto</p>
			<h2 class="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl" style="font-family: var(--font-display)">
				{contactCta.heading}
			</h2>
			<p class="mt-6 max-w-xl text-lg text-ink/80">
				{contactCta.paragraph}
			</p>

			<div class="mt-10 flex flex-wrap gap-4">
				<a
					href="mailto:{contactCta.email}"
					class="rounded-full bg-ink px-7 py-4 text-base font-semibold text-cream transition-transform hover:-translate-y-0.5"
					>{contactCta.email}</a
				>
				<a
					href={contactCta.instagramHref}
					target="_blank"
					rel="noopener noreferrer"
					class="rounded-full border border-ink/30 px-7 py-4 text-base font-semibold transition-colors hover:bg-ink hover:text-cream"
					>{contactCta.instagramLabel}</a
				>
			</div>
		</div>
	</div>
</section>
