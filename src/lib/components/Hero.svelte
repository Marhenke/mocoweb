<section
	id="inicio"
	class="relative flex min-h-dvh flex-col justify-center overflow-hidden px-5 pt-28 pb-16 text-cream sm:px-8 sm:pt-32"
>
	<!-- video de fondo -->
	<video
		class="pointer-events-none absolute inset-0 h-full w-full object-cover"
		src="/video/hero.mp4"
		poster="/video/hero-poster.jpg"
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
			Estudio creativo
		</p>

		<h1
			class="float-up max-w-5xl text-[3.2rem] leading-[0.95] font-extrabold tracking-tight sm:text-7xl lg:text-[7.5rem]"
			style="font-family: var(--font-display)"
		>
			Ideas con <span class="italic text-cream/70">carácter</span>,
			marcas que <span class="bg-lime px-3 -rotate-1 inline-block rounded-lg text-ink">pegan</span>.
		</h1>

		<div class="float-up mt-10 flex flex-wrap items-center gap-4">
			<a
				href="/contacto"
				class="rounded-full bg-lime px-7 py-4 text-base font-semibold text-ink transition-all hover:bg-cream"
				>Empecemos un proyecto</a
			>
		</div>
	</div>
</section>

<!-- Marquee -->
<div class="overflow-hidden border-y border-ink/10 bg-ink py-4 text-cream">
	<div class="flex w-max animate-marquee gap-8 whitespace-nowrap text-2xl font-extrabold sm:text-3xl" style="font-family: var(--font-display)">
		{#each Array(2) as _}
			<span class="flex items-center gap-8">
				<span>Branding</span><span class="text-lime">✦</span>
				<span>Diseño Web</span><span class="text-lime">✦</span>
				<span>Identidad Visual</span><span class="text-lime">✦</span>
				<span>Dirección de Arte</span><span class="text-lime">✦</span>
				<span>Producción</span><span class="text-lime">✦</span>
			</span>
		{/each}
	</div>
</div>
