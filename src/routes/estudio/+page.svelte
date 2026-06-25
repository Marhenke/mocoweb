<script lang="ts">
	import Contact from '$lib/components/Contact.svelte';
	import SocialIcon from '$lib/components/SocialIcon.svelte';
	import LogoRain from '$lib/components/LogoRain.svelte';

	// Acordeón de servicios
	let openService = $state<number | null>(0);
	const toggleService = (i: number) => (openService = openService === i ? null : i);

	const values = [
		{
			title: 'Explorar',
			desc: 'Nos gusta descubrir lo que hay detrás de cada proyecto. Las mejores ideas aparecen cuando hacemos las preguntas correctas.'
		},
		{
			title: 'Conexión',
			desc: 'Trabajamos desde lo humano. Entender a las personas detrás de una marca es parte de crear algo verdadero.'
		},
		{
			title: 'Ideas con sentido',
			desc: 'No buscamos hacer por hacer. Buscamos que cada decisión tenga una razón y que cada proyecto tenga algo para decir.'
		},
		{
			title: 'Movimiento',
			desc: 'Pensamos rápido, probamos, ajustamos y avanzamos. La creatividad también está en hacer que las cosas pasen.'
		},
		{
			title: 'Identidad',
			desc: 'Cada proyecto tiene algo único. Nuestro trabajo es encontrarlo y darle una forma propia.'
		},
		{
			title: 'Claridad',
			desc: 'Hacemos lugar entre tanto ruido. Buscamos que cada marca encuentre una forma clara y propia de decir lo que tiene para decir.'
		}
	];

	const process = [
		['Escuchamos', 'Entendemos tu marca, tu público y a dónde querés llegar.'],
		['Exploramos', 'Probamos ideas, direcciones y conceptos hasta dar con el correcto.'],
		['Creamos', 'Diseñamos y pulimos cada pieza con foco en el detalle.'],
		['Lanzamos', 'Entregamos todo listo para usar, con acompañamiento.']
	];

	const services = [
		{
			title: 'Branding & Identidad',
			desc: 'Creamos logos, sistemas visuales y manuales de marca completos. Definimos colores, tipografías y un lenguaje gráfico propio para que tu marca se vea distinta, coherente y reconocible en todos los puntos de contacto, del feed a lo impreso. Trabajamos desde la estrategia hasta el último detalle, para que tu identidad no sea solo linda sino que también diga lo que tu marca quiere decir y se sostenga en el tiempo.'
		},
		{
			title: 'Diseño Web',
			desc: 'Diseñamos y desarrollamos sitios rápidos, lindos y fáciles de usar. Desde una landing hasta una tienda online, pensados para verse bien en cualquier dispositivo y para convertir visitas en clientes. Nos ocupamos de toda la experiencia: la estructura, el diseño, los textos y el desarrollo, dejándote un sitio listo para usar, fácil de actualizar y pensado para crecer con tu proyecto.'
		},
		{
			title: 'AV & Producción',
			desc: 'Producimos foto y video con mirada de autor: contenido para redes, piezas de marca y material audiovisual listo para compartir. Nos encargamos de la idea, la producción y la edición de principio a fin. Desde reels y campañas hasta videos institucionales, cuidamos cada plano para que el resultado tenga la calidad y la personalidad que tu marca merece.'
		},
		{
			title: 'Cobertura de eventos',
			desc: 'Registramos tus eventos de principio a fin. Foto, video, pantallas en vivo, aftermovie e historias en tiempo real para capturar y comunicar los momentos que importan. Estamos donde pasa la acción para que no se te escape nada, y te entregamos el material editado y listo para publicar, manteniendo viva la energía del evento también en tus redes.'
		},
		{
			title: 'Servicios digitales',
			desc: 'Mantenemos tu marca activa en redes: diseño de placas para redes sociales, producción de reels y community management. Planificamos, creamos y publicamos contenido con una voz coherente y constante. Pensamos una estrategia de contenido, armamos el calendario, respondemos a tu comunidad y medimos resultados para que tu presencia digital crezca de forma sostenida.'
		},
		{
			title: 'Diseño gráfico',
			desc: 'Diseñamos todas las piezas que tu comunicación necesita: flyers, newsletters, presentaciones y material gráfico, siempre con la identidad de tu marca y atención al detalle. Ya sea para imprimir o para pantalla, traducimos cada mensaje en piezas claras y atractivas que mantienen la coherencia visual de tu marca en cada formato.'
		}
	];

	// Links de redes: placeholders por ahora, los reemplazamos por los reales.
	const team = [
		{
			name: 'Mar',
			photo: '/team/mar.jpg',
			role: 'Lic. en Diseño',
			socials: [
				{ name: 'instagram', href: 'https://instagram.com' },
				{ name: 'tiktok', href: 'https://tiktok.com' },
				{ name: 'youtube', href: 'https://youtube.com' }
			]
		},
		{
			name: 'Gegen',
			photo: '/team/gegen.jpg',
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
	<title>Estudio · Moco</title>
	<meta name="description" content="Moco es un estudio creativo independiente. Conocé cómo trabajamos." />
</svelte:head>

<!-- Hero: texto a 2/3, espacio para foto a la derecha -->
<header class="relative overflow-hidden bg-ink px-5 pt-32 pb-28 text-cream sm:px-8 sm:pt-40 sm:pb-36">
	<LogoRain />
	<div class="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-3 lg:gap-16">
		<div class="float-up flex flex-col lg:col-span-2">
			<p class="mb-5 flex items-center gap-2 text-sm font-semibold tracking-wide text-cream/70 uppercase">
				<span class="inline-block h-2 w-2 rounded-full bg-lime"></span>
				El estudio
			</p>
			<h1
				class="text-[2.8rem] leading-[0.95] font-extrabold tracking-tight sm:text-6xl"
				style="font-family: var(--font-display)"
			>
				Un estudio creativo que encuentra sentido y lo transforma en realidad.
			</h1>
			<p class="mt-6 text-lg text-cream/80 sm:text-xl">
				Somos Moco, un estudio creativo independiente. Trabajamos cerca de cada proyecto para
				entender su esencia, descubrir oportunidades y construir soluciones con identidad propia.
			</p>
			<p class="mt-4 text-lg text-cream/80 sm:text-xl">
				Nos involucramos en el proceso, combinando estrategia, diseño y creatividad para
				transformar ideas en marcas que conectan.
			</p>
		</div>

		<!-- Espacio reservado para una foto a futuro -->
		<div class="hidden lg:block" aria-hidden="true"></div>
	</div>
</header>

<!-- Valores -->
<section class="px-5 pt-20 pb-20 sm:px-8 sm:pt-28 sm:pb-28">
	<div class="mx-auto max-w-7xl">
		<h2 class="mb-10 text-3xl font-extrabold tracking-tight sm:text-5xl" style="font-family: var(--font-display)">
			En qué creemos
		</h2>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each values as v}
				<div class="rounded-3xl border border-ink/10 bg-cream-dark/30 p-7">
					<h3 class="text-xl font-bold" style="font-family: var(--font-display)">{v.title}</h3>
					<p class="mt-3 text-ink-soft">{v.desc}</p>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- Servicios (acordeón) -->
<section class="px-5 pb-20 sm:px-8 sm:pb-28">
	<div class="mx-auto max-w-7xl">
		<p class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Qué ofrecemos</p>
		<h2 class="mb-10 text-3xl font-extrabold tracking-tight sm:text-5xl" style="font-family: var(--font-display)">
			Nuestros servicios
		</h2>
		<div class="overflow-hidden rounded-3xl border border-ink/10">
			{#each services as s, i}
				<div class="border-b border-ink/10 last:border-b-0">
					<button
						type="button"
						onclick={() => toggleService(i)}
						aria-expanded={openService === i}
						class="flex w-full items-center justify-between gap-4 px-6 py-6 text-left transition-colors hover:bg-cream-dark/40 sm:px-8"
					>
						<span class="text-xl font-bold sm:text-2xl" style="font-family: var(--font-display)">
							{s.title}
						</span>
						<span
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/5 text-xl text-ink transition-transform duration-300 {openService ===
							i
								? 'rotate-45 bg-lime'
								: ''}">+</span
						>
					</button>
					<div
						class="grid transition-[grid-template-rows] duration-300 ease-out"
						style="grid-template-rows: {openService === i ? '1fr' : '0fr'}"
					>
						<div class="overflow-hidden">
							<p class="px-6 pb-6 text-ink-soft sm:px-8">{s.desc}</p>
						</div>
					</div>
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
					<img
						src={member.photo}
						alt={member.name}
						class="aspect-[4/5] w-full rounded-3xl object-cover"
					/>
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
