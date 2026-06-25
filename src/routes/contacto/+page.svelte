<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';

	let sent = $state(false);
	function handleSubmit(e: Event) {
		e.preventDefault();
		sent = true;
	}

	const methods = [
		{ label: 'Email', value: 'mocoestudiocreativo@gmail.com', href: 'mailto:mocoestudiocreativo@gmail.com' },
		{ label: 'Instagram', value: '@mocoestudio_', href: 'https://www.instagram.com/mocoestudio_/' },
		{ label: 'Ubicación', value: 'Buenos Aires, Argentina', href: null }
	];

	const faqs = [
		[
			'¿Trabajan con marcas de cualquier rubro?',
			'Sí. Nos gustan especialmente los proyectos que se animan a algo distinto, sin importar el rubro.'
		],
		[
			'¿Cuánto tarda un proyecto?',
			'Depende del alcance, pero una identidad completa suele llevar entre 4 y 8 semanas.'
		],
		[
			'¿Atienden clientes de otras ciudades o países?',
			'Sí, trabajamos a distancia sin problema. Gran parte de nuestros proyectos son remotos.'
		]
	];
</script>

<svelte:head>
	<title>Contacto · Moco</title>
	<meta name="description" content="Contanos sobre tu proyecto. Te respondemos en menos de 48 horas." />
</svelte:head>

<PageHeader
	eyebrow="Contacto"
	title="¿Tenés algo en mente? Hablemos."
	intro="Contanos un poco sobre tu proyecto y te respondemos en menos de 48 horas."
/>

<section class="px-5 pb-20 sm:px-8 sm:pb-28">
	<div class="mx-auto grid max-w-7xl items-start gap-12 lg:grid-cols-2 lg:gap-20">
		<!-- Datos de contacto -->
		<div class="flex flex-col gap-8">
			{#each methods as m}
				<div>
					<h2 class="text-xs font-bold tracking-wide text-muted uppercase">{m.label}</h2>
					{#if m.href}
						<a
							href={m.href}
							target={m.href.startsWith('http') ? '_blank' : undefined}
							rel={m.href.startsWith('http') ? 'noopener noreferrer' : undefined}
							class="mt-2 block text-lg font-medium underline-offset-4 hover:text-ink hover:underline"
							>{m.value}</a
						>
					{:else}
						<p class="mt-2 text-lg font-medium">{m.value}</p>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Formulario con fondo negro -->
		<div class="rounded-3xl bg-ink p-7 text-cream sm:p-10">
			{#if sent}
				<div class="flex h-full min-h-64 flex-col items-center justify-center text-center">
					<span class="flex h-14 w-14 items-center justify-center rounded-full bg-lime text-2xl text-ink">✓</span>
					<h2 class="mt-5 text-2xl font-bold text-cream" style="font-family: var(--font-display)">¡Gracias!</h2>
					<p class="mt-2 max-w-xs text-cream/70">
						Recibimos tu mensaje y te vamos a responder muy pronto.
					</p>
				</div>
			{:else}
				<form class="flex flex-col gap-5" onsubmit={handleSubmit}>
					<div class="flex flex-col gap-2">
						<label for="nombre" class="text-sm font-semibold text-cream/80">Nombre</label>
						<input
							id="nombre"
							type="text"
							required
							placeholder="Tu nombre"
							class="rounded-xl border border-cream/20 bg-white/10 px-4 py-3 text-cream placeholder:text-cream/40 outline-none focus:border-lime"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="email" class="text-sm font-semibold text-cream/80">Email</label>
						<input
							id="email"
							type="email"
							required
							placeholder="tu@email.com"
							class="rounded-xl border border-cream/20 bg-white/10 px-4 py-3 text-cream placeholder:text-cream/40 outline-none focus:border-lime"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="mensaje" class="text-sm font-semibold text-cream/80">Contanos sobre tu proyecto</label>
						<textarea
							id="mensaje"
							required
							rows="4"
							placeholder="¿Qué tenés en mente?"
							class="resize-none rounded-xl border border-cream/20 bg-white/10 px-4 py-3 text-cream placeholder:text-cream/40 outline-none focus:border-lime"
						></textarea>
					</div>
					<button
						type="submit"
						class="mt-2 rounded-full bg-lime px-7 py-4 text-base font-semibold text-ink transition-all hover:bg-cream"
						>Enviar mensaje</button
					>
				</form>
			{/if}
		</div>
	</div>
</section>

<!-- Preguntas frecuentes -->
<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-3xl">
		<h2 class="mb-8 text-3xl font-extrabold tracking-tight sm:text-5xl" style="font-family: var(--font-display)">
			Preguntas frecuentes
		</h2>
		<div class="divide-y divide-ink/10 border-y border-ink/10">
			{#each faqs as [q, a]}
				<div class="py-6">
					<h3 class="text-lg font-bold">{q}</h3>
					<p class="mt-2 text-ink-soft">{a}</p>
				</div>
			{/each}
		</div>
	</div>
</section>
