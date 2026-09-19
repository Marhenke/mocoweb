<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const { contactoHero, methods } = $derived(data);

	let sent = $state(false);
	let sending = $state(false);
	let nombre = $state('');
	let email = $state('');
	let mensaje = $state('');
	let website = $state(''); // honeypot — real visitors never see or fill this
	let errorMessage = $state('');
	let fallbackEmail = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (sending) return;
		sending = true;
		errorMessage = '';
		fallbackEmail = '';

		try {
			const response = await fetch('/api/contact', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: nombre, email, message: mensaje, website })
			});
			const result = await response.json().catch(() => ({}));

			if (response.ok && result.ok) {
				sent = true;
				return;
			}

			errorMessage =
				result.message ??
				'No pudimos enviar tu mensaje. Probá de nuevo en unos minutos o escribinos por email.';
			if (result.fallbackEmail) fallbackEmail = result.fallbackEmail;
		} catch {
			errorMessage =
				'No pudimos enviar tu mensaje — revisá tu conexión y probá de nuevo, o escribinos directamente.';
			fallbackEmail = 'mocoestudiocreativo@gmail.com';
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Contacto · Moco</title>
	<meta name="description" content="Contanos sobre tu proyecto. Te respondemos en menos de 48 horas." />
</svelte:head>

<section class="px-5 pt-32 pb-20 sm:px-8 sm:pt-40 sm:pb-28">
	<div class="mx-auto grid max-w-7xl items-start gap-16 lg:grid-cols-2 lg:gap-24">

		<!-- Columna izquierda: título + datos -->
		<div class="flex flex-col gap-12">
			<div>
				<p class="mb-4 text-sm font-semibold tracking-wide text-muted uppercase">{contactoHero.eyebrow}</p>
				<h1 class="text-5xl font-extrabold tracking-tight sm:text-7xl" style="font-family: var(--font-display)">
					{contactoHero.title}
				</h1>
				<p class="mt-6 text-lg text-ink-soft">
					{contactoHero.intro}
				</p>
			</div>

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
							>{m.value}</a>
						{:else}
							<p class="mt-2 text-lg font-medium">{m.value}</p>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Columna derecha: formulario -->
		<div class="relative rounded-3xl bg-ink p-7 text-cream sm:p-10">
			{#if sent}
				<div class="flex min-h-64 flex-col items-center justify-center text-center">
					<span class="flex h-14 w-14 items-center justify-center rounded-full bg-lime text-2xl text-ink">✓</span>
					<h2 class="mt-5 text-2xl font-bold" style="font-family: var(--font-display)">¡Gracias!</h2>
					<p class="mt-2 max-w-xs text-cream/70">Recibimos tu mensaje y te vamos a responder muy pronto.</p>
				</div>
			{:else}
				<form class="flex flex-col gap-5" onsubmit={handleSubmit}>
					<!-- Honeypot: off-screen, unreachable by tab, hidden from screen readers — a real
					     visitor never sees or fills this. A bot that fills every field it can find trips it. -->
					<div class="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
						<label for="website">Dejá este campo vacío</label>
						<input
							id="website"
							name="website"
							type="text"
							tabindex="-1"
							autocomplete="off"
							bind:value={website}
						/>
					</div>
					{#if errorMessage}
						<div class="rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-cream">
							<p>{errorMessage}</p>
							{#if fallbackEmail}
								<a href={`mailto:${fallbackEmail}`} class="mt-1 inline-block font-semibold underline">
									{fallbackEmail}
								</a>
							{/if}
						</div>
					{/if}
					<div class="flex flex-col gap-2">
						<label for="nombre" class="text-sm font-semibold text-cream/80">Nombre</label>
						<input
							id="nombre"
							type="text"
							required
							bind:value={nombre}
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
							bind:value={email}
							placeholder="tu@email.com"
							class="rounded-xl border border-cream/20 bg-white/10 px-4 py-3 text-cream placeholder:text-cream/40 outline-none focus:border-lime"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="mensaje" class="text-sm font-semibold text-cream/80">Contanos sobre tu proyecto</label>
						<textarea
							id="mensaje"
							required
							rows="5"
							bind:value={mensaje}
							placeholder="¿Qué tenés en mente?"
							class="resize-none rounded-xl border border-cream/20 bg-white/10 px-4 py-3 text-cream placeholder:text-cream/40 outline-none focus:border-lime"
						></textarea>
					</div>
					<button
						type="submit"
						disabled={sending}
						class="mt-1 self-start rounded-full bg-lime px-6 py-3 text-sm font-semibold text-ink transition-all hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
					>{sending ? 'Enviando…' : 'Enviar mensaje'}</button>
				</form>
			{/if}
		</div>
	</div>
</section>

