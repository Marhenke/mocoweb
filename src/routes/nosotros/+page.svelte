<script lang="ts">
	import Contact from '$lib/components/Contact.svelte';
	import SocialIcon from '$lib/components/SocialIcon.svelte';

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

	// Links de redes: placeholders por ahora, los reemplazamos por los reales.
	const team = [
		{
			name: 'Marlene Henke',
			role: 'Lic. en Diseño',
			socials: [
				{ name: 'instagram', href: 'https://instagram.com' },
				{ name: 'tiktok', href: 'https://tiktok.com' },
				{ name: 'youtube', href: 'https://youtube.com' }
			]
		},
		{
			name: 'Joaquín Gegenschatz',
			role: 'Lic. en Comunicación',
			socials: [
				{ name: 'instagram', href: 'https://instagram.com' },
				{ name: 'tiktok', href: 'https://tiktok.com' },
				{ name: 'youtube', href: 'https://youtube.com' },
				{ name: 'spotify', href: 'https://spotify.com' }
			]
		}
	] as const;
</script>

<svelte:head>
	<title>Nosotros · Moco</title>
	<meta name="description" content="Moco es un estudio creativo independiente. Conocé cómo trabajamos." />
</svelte:head>

<!-- Hero: texto a la izquierda, espacio para foto a la derecha -->
<header class="px-5 pt-32 pb-20 sm:px-8 sm:pt-40 sm:pb-28">
	<div class="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2 lg:gap-16">
		<div class="float-up flex flex-col">
			<p class="mb-5 flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
				<span class="inline-block h-2 w-2 rounded-full bg-lime"></span>
				El estudio
			</p>
			<h1
				class="text-[2.8rem] leading-[0.95] font-extrabold tracking-tight sm:text-7xl"
				style="font-family: var(--font-display)"
			>
				Chico, curioso y obsesionado con el detalle.
			</h1>
			<p class="mt-6 text-lg text-ink-soft sm:text-xl">
				Somos Moco, un estudio creativo independiente. Trabajamos de cerca con cada cliente, sin
				intermediarios ni fórmulas: entendemos tu proyecto, lo cuestionamos un poco, y lo
				convertimos en algo con personalidad propia.
			</p>
		</div>

		<!-- Espacio reservado para una foto a futuro -->
		<div class="hidden lg:block" aria-hidden="true"></div>
	</div>
</header>

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
<section class="px-5 pb-20 sm:px-8 sm:pb-28">
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

<!-- Quiénes somos -->
<section class="px-5 pb-24 sm:px-8 sm:pb-32">
	<div class="mx-auto max-w-7xl">
		<h2 class="mb-10 text-3xl font-extrabold tracking-tight sm:text-5xl" style="font-family: var(--font-display)">
			Quiénes somos
		</h2>
		<div class="grid grid-cols-2 gap-5 lg:grid-cols-4">
			{#each team as member}
				<div>
					<!-- Foto del integrante (placeholder hasta tener las reales) -->
					<div
						class="flex aspect-[4/5] w-full items-center justify-center rounded-3xl border border-ink/10 bg-cream-dark/40"
					>
						<span class="text-sm font-semibold text-muted">Foto</span>
					</div>
					<h3 class="mt-4 text-xl font-bold" style="font-family: var(--font-display)">{member.name}</h3>
					<p class="mt-1 text-ink-soft">{member.role}</p>
					<div class="mt-3 flex items-center gap-2">
						{#each member.socials as social}
							<a
								href={social.href}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={social.name}
								class="flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:bg-ink hover:text-cream"
							>
								<span class="h-4 w-4"><SocialIcon name={social.name} /></span>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<Contact />
