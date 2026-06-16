<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Contact from '$lib/components/Contact.svelte';

	const stats = [
		{ num: '+40', label: 'Proyectos lanzados' },
		{ num: '8', label: 'Años creando' },
		{ num: '100%', label: 'Hecho a medida' }
	];

	const values = [
		{
			title: 'Curiosidad',
			desc: 'Preguntamos mucho antes de diseñar. Entender el problema es la mitad del trabajo.'
		},
		{
			title: 'Detalle',
			desc: 'Nos importa el kerning, el espacio, el píxel. Las cosas bien hechas se notan.'
		},
		{
			title: 'Honestidad',
			desc: 'Te decimos lo que pensamos, aunque no sea lo más cómodo. Para eso nos contratás.'
		},
		{
			title: 'Carácter',
			desc: 'No hacemos marcas tibias. Buscamos que la tuya tenga una voz propia.'
		}
	];

	const process = [
		['Escuchamos', 'Entendemos tu marca, tu público y a dónde querés llegar.'],
		['Exploramos', 'Probamos ideas, direcciones y conceptos hasta dar con el correcto.'],
		['Creamos', 'Diseñamos y pulimos cada pieza con foco en el detalle.'],
		['Lanzamos', 'Entregamos todo listo para usar, con acompañamiento.']
	];
</script>

<svelte:head>
	<title>Nosotros · Moco</title>
	<meta name="description" content="Moco es un estudio creativo independiente. Conocé cómo trabajamos." />
</svelte:head>

<PageHeader
	eyebrow="El estudio"
	title="Chico, curioso y obsesionado con el detalle."
	intro="Somos Moco, un estudio creativo independiente. Trabajamos de cerca con cada cliente, sin intermediarios ni fórmulas."
/>

<!-- Texto + stats -->
<section class="px-5 pb-20 sm:px-8 sm:pb-28">
	<div class="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-20">
		<div class="space-y-4 text-lg text-ink-soft">
			<p>
				Entendemos tu proyecto, lo cuestionamos un poco, y lo convertimos en algo con
				personalidad propia. Nos gustan las marcas que se animan a ser distintas.
			</p>
			<p>
				Trabajamos en branding, diseño web, dirección de arte y packaging — siempre con la
				misma obsesión por hacer cosas que se vean y se sientan bien.
			</p>
			<p>Si esa es tu marca, nos vamos a llevar bien.</p>
		</div>

		<div class="grid grid-cols-3 gap-6 self-start">
			{#each stats as s}
				<div>
					<div class="text-3xl font-extrabold sm:text-5xl" style="font-family: var(--font-display)">
						{s.num}
					</div>
					<div class="mt-1 text-sm text-muted">{s.label}</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Valores -->
<section class="px-5 pb-20 sm:px-8 sm:pb-28">
	<div class="mx-auto max-w-7xl">
		<h2 class="mb-10 text-3xl font-extrabold tracking-tight sm:text-5xl" style="font-family: var(--font-display)">
			En qué creemos
		</h2>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
			{#each values as v}
				<div class="rounded-3xl border border-ink/10 bg-cream-dark/30 p-7">
					<h3 class="text-xl font-bold" style="font-family: var(--font-display)">{v.title}</h3>
					<p class="mt-3 text-ink-soft">{v.desc}</p>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Proceso -->
<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-7xl rounded-3xl bg-ink p-8 text-cream sm:p-12">
		<h2 class="text-3xl font-bold sm:text-4xl" style="font-family: var(--font-display)">
			Cómo trabajamos
		</h2>
		<div class="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
			{#each process as [title, desc], i}
				<div class="flex flex-col gap-4">
					<span class="flex h-10 w-10 items-center justify-center rounded-full bg-lime text-sm font-bold text-ink">{i + 1}</span>
					<div>
						<div class="text-lg font-semibold">{title}</div>
						<div class="mt-1 text-sm text-cream/70">{desc}</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<Contact />
