/**
 * The current hardcoded content, transcribed out of the .svelte files it
 * lives in today, in the shape defined by `src/lib/content.schema.ts`.
 *
 * WHY THIS FILE EXISTS: `projects.ts` is already an importable TS module, so
 * the seed script and the round-trip verification script can both import it
 * directly — no transcription risk there. But the rest of the site's
 * hardcoded content (hero copy, values, process steps, services, team,
 * contact methods) lives inline inside <script> blocks in .svelte files,
 * which are not plain importable modules. This file is the ONE transcription
 * of that content, shared by both `seed.ts` (which writes it to Postgres)
 * and `verify-roundtrip.ts` (which reads it back out and deep-compares) —
 * so there is exactly one place a transcription mistake could hide, and
 * fixing it fixes both scripts at once.
 *
 * Every literal value below was copied by hand from:
 *   - src/routes/+page.svelte (via Hero.svelte / Statement.svelte)
 *   - src/routes/estudio/+page.svelte
 *   - src/routes/contacto/+page.svelte
 *   - src/routes/trabajos/+page.svelte
 *   - src/lib/components/Contact.svelte
 * Do not "clean up" or paraphrase anything here — the whole point is that
 * it matches production byte for byte.
 */

import { projects as sourceProjects } from '../src/lib/data/projects.ts';
import type {
	ProjectInput,
	GalleryInput
} from '../src/lib/content.schema.ts';

// ---------------------------------------------------------------------------
// projects — re-exported from the real module, no transcription needed
// ---------------------------------------------------------------------------

export interface SeedProject {
	slug: string;
	data: ProjectInput;
}

export const projects: SeedProject[] = sourceProjects.map((p) => {
	const { slug, ...rest } = p;
	return { slug, data: rest as ProjectInput & { gallery: GalleryInput } };
});

// ---------------------------------------------------------------------------
// estudio/+page.svelte
// ---------------------------------------------------------------------------

export const values = [
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

export const process = [
	{ title: 'Escuchamos', desc: 'Entendemos tu marca, tu público y a dónde querés llegar.' },
	{ title: 'Exploramos', desc: 'Probamos ideas, direcciones y conceptos hasta dar con el correcto.' },
	{ title: 'Creamos', desc: 'Diseñamos y pulimos cada pieza con foco en el detalle.' },
	{ title: 'Lanzamos', desc: 'Entregamos todo listo para usar, con acompañamiento.' }
];

export const estudioServices = [
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

export const team = [
	{
		name: 'Mar',
		photo: '/team/mar.jpg',
		role: 'Lic. en Diseño',
		socials: [
			{ name: 'instagram', href: 'https://www.instagram.com/marlene.formulafan/' },
			{ name: 'tiktok', href: 'https://www.tiktok.com/@marlene.formulafan' },
			{ name: 'youtube', href: 'https://www.youtube.com/@FormulaFan-f4r' }
		]
	},
	{
		name: 'Gegen',
		photo: '/team/gegen.jpg',
		role: 'Lic. en Comunicación',
		socials: [
			{ name: 'instagram', href: 'https://www.instagram.com/gegen_._/' },
			{ name: 'tiktok', href: 'https://www.tiktok.com/@gegenn___' },
			{ name: 'youtube', href: 'https://www.youtube.com/channel/UC2VZHTMSspMjD8niEzacPvg' },
			{ name: 'spotify', href: 'https://open.spotify.com/artist/2bFB8J4t9LQDbls4tjE5IJ' }
		]
	}
] as const;

export const estudioHero = {
	eyebrow: 'El estudio',
	title: 'Un estudio creativo que encuentra sentido y lo transforma en realidad.',
	paragraphs: [
		'Somos Moco, un estudio creativo independiente. Trabajamos cerca de cada proyecto para entender su esencia, descubrir oportunidades y construir soluciones con identidad propia.',
		'Nos involucramos en el proceso, combinando estrategia, diseño y creatividad para transformar ideas en marcas que conectan.'
	]
};

// ---------------------------------------------------------------------------
// home page (composed of Hero.svelte, Statement.svelte, Services.svelte)
// ---------------------------------------------------------------------------

export const homeServices = [
	{
		n: '01',
		title: 'Branding & Identidad',
		desc: 'Logos, sistemas visuales y manuales de marca. Te ayudamos a verte distinto y consistente en todos lados.'
	},
	{
		n: '02',
		title: 'Diseño Web',
		desc: 'Sitios rápidos, lindos y fáciles de usar. Desde landings hasta tiendas, pensados para convertir.'
	},
	{
		n: '03',
		title: 'AV & Produs',
		desc: 'Audiovisual y producción: foto, video y contenido para redes con mirada de autor, listo para compartir.'
	},
	{
		n: '04',
		title: 'Cobertura de eventos',
		desc: 'Registramos tus eventos de principio a fin, capturando los momentos que importan.'
	},
	{
		n: '05',
		title: 'Servicios digitales',
		desc: 'Placas para redes sociales, reels y community management para mantener tu marca activa.'
	},
	{
		n: '06',
		title: 'Diseño gráfico',
		desc: 'Flyers, newsletters y piezas gráficas con la identidad de tu marca, para toda tu comunicación.'
	}
];

export const homeHero = {
	eyebrow: 'Estudio creativo',
	headlineLines: ['Hola,', 'somos', 'Moco.'],
	highlightLead: 'contenido',
	highlightWord: 'pegajoso',
	ctaLabel: 'Empecemos un proyecto',
	ctaHref: '/contacto',
	videoSrc: '/video/hero.mp4',
	videoPoster: '/video/hero-poster.jpg',
	marqueeItems: ['Branding', 'Diseño Web', 'Identidad Visual', 'Dirección de Arte', 'Producción']
};

export const statement = {
	text: 'El mundo merece conocerte, nosotros te podemos ayudar.'
};

// ---------------------------------------------------------------------------
// contacto/+page.svelte
// ---------------------------------------------------------------------------

export const contactMethods = [
	{ label: 'Email', value: 'mocoestudiocreativo@gmail.com', href: 'mailto:mocoestudiocreativo@gmail.com' },
	{ label: 'Instagram', value: '@mocoestudio_', href: 'https://www.instagram.com/mocoestudio_/' },
	{ label: 'Ubicación', value: 'Buenos Aires, Argentina', href: null }
];

export const contactoHero = {
	eyebrow: 'Contacto',
	title: '¿Tenés algo en mente? Hablemos.',
	intro: 'Contanos un poco sobre tu proyecto y te respondemos en menos de 48 horas.'
};

// ---------------------------------------------------------------------------
// trabajos/+page.svelte (PageHeader props)
// ---------------------------------------------------------------------------

export const trabajosHeader = {
	eyebrow: 'Trabajos',
	title: 'Marcas con las que nos divertimos.',
	intro: 'Una selección de proyectos. Cada uno empezó con una charla y terminó en algo con identidad propia.'
};

// ---------------------------------------------------------------------------
// Contact.svelte (reusable CTA band on home / estudio / trabajos)
// ---------------------------------------------------------------------------

export const contactCta = {
	heading: '¿Tenés algo en mente? Hagámoslo.',
	paragraph: 'Contanos un poco de tu proyecto y te respondemos en menos de 48 horas.',
	email: 'mocoestudiocreativo@gmail.com',
	instagramLabel: 'Instagram',
	instagramHref: 'https://www.instagram.com/mocoestudio_/'
};
