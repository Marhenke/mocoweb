export type Project = {
	slug: string;
	title: string;
	category: string;
	year: string;
	client: string;
	services: string[];
	/** Color de fondo de la tarjeta/portada (placeholder hasta tener fotos) */
	bg: string;
	/** Color de texto sobre ese fondo */
	ink: string;
	summary: string;
	challenge: string;
	solution: string;
	/** Bloques de la galería — placeholders hasta cargar imágenes reales */
	gallery: string[];
};

export const projects: Project[] = [
	{
		slug: 'verdeo',
		title: 'Verdeo',
		category: 'Branding · Packaging',
		year: '2025',
		client: 'Verdeo Alimentos',
		services: ['Naming', 'Identidad visual', 'Packaging', 'Guía de marca'],
		bg: 'linear-gradient(135deg, #c8f135 0%, #aad419 100%)',
		ink: '#16140f',
		summary:
			'Una marca de alimentos plant-based fresca y honesta, que se anima a ser distinta en la góndola.',
		challenge:
			'Verdeo necesitaba destacarse en un rubro saturado de verdes genéricos y mensajes acartonados, sin perder confianza ni claridad.',
		solution:
			'Creamos un sistema visual jugado pero prolijo: un verde lima propio, tipografías con carácter y un lenguaje gráfico simple que funciona igual de bien en un envase que en redes.',
		gallery: [
			'linear-gradient(135deg, #c8f135 0%, #aad419 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
			'linear-gradient(135deg, #aad419 0%, #c8f135 100%)'
		]
	},
	{
		slug: 'lumen-cafe',
		title: 'Lumen Café',
		category: 'Identidad · Web',
		year: '2025',
		client: 'Lumen Specialty Coffee',
		services: ['Identidad visual', 'Diseño web', 'Menú & señalética'],
		bg: 'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
		ink: '#f4f0e6',
		summary:
			'Identidad cálida y minimalista para una cafetería de especialidad, del local a la pantalla.',
		challenge:
			'Lumen quería sentirse premium pero cercano, y necesitaba una presencia coherente entre el local físico y su web de reservas.',
		solution:
			'Construimos una identidad sobria con foco en la tipografía y un sistema fotográfico cálido, y la llevamos a una web rápida y fácil de usar.',
		gallery: [
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
			'linear-gradient(135deg, #3a362d 0%, #16140f 100%)',
			'linear-gradient(135deg, #cfc6ac 0%, #e8e2d2 100%)'
		]
	},
	{
		slug: 'ola-studio',
		title: 'Ola Studio',
		category: 'Dirección de arte',
		year: '2024',
		client: 'Ola Studio',
		services: ['Dirección de arte', 'Contenido para redes', 'Campaña'],
		bg: 'linear-gradient(135deg, #ff7a4d 0%, #ff5c35 100%)',
		ink: '#16140f',
		summary:
			'Dirección de arte vibrante para una marca de indumentaria que quería frenar el scroll.',
		challenge:
			'Necesitaban una estética propia y reconocible para sus campañas, que se sostuviera en el tiempo y en distintos formatos.',
		solution:
			'Definimos una paleta cálida, un sistema de composición y un tono de comunicación que hoy hace que sus piezas se reconozcan de lejos.',
		gallery: [
			'linear-gradient(135deg, #ff7a4d 0%, #ff5c35 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #ff5c35 0%, #ff7a4d 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)'
		]
	},
	{
		slug: 'nido',
		title: 'Nido',
		category: 'Branding · Print',
		year: '2024',
		client: 'Nido Deco',
		services: ['Identidad visual', 'Papelería', 'Catálogo'],
		bg: 'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
		ink: '#16140f',
		summary: 'Una marca de objetos para el hogar con calidez artesanal y prolijidad editorial.',
		challenge:
			'Nido quería transmitir lo hecho a mano y lo cuidado, evitando caer en lo rústico o lo improvisado.',
		solution:
			'Creamos una identidad de aire editorial, con tipografías suaves, mucho aire y un catálogo impreso que invita a tocar.',
		gallery: [
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #cfc6ac 0%, #e8e2d2 100%)',
			'linear-gradient(135deg, #c8f135 0%, #aad419 100%)'
		]
	},
	{
		slug: 'pulpo',
		title: 'Pulpo',
		category: 'Branding · Web',
		year: '2024',
		client: 'Pulpo Agencia',
		services: ['Naming', 'Identidad visual', 'Diseño web'],
		bg: 'linear-gradient(135deg, #7c5cff 0%, #5b3df0 100%)',
		ink: '#f4f0e6',
		summary: 'Identidad y web para una agencia digital que quería verse tan ágil como trabaja.',
		challenge:
			'Pulpo necesitaba una marca flexible, capaz de adaptarse a muchos brazos del negocio sin perder unidad.',
		solution:
			'Diseñamos un sistema modular y una web dinámica que crece con ellos, manteniendo siempre la misma personalidad.',
		gallery: [
			'linear-gradient(135deg, #7c5cff 0%, #5b3df0 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #5b3df0 0%, #7c5cff 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)'
		]
	},
	{
		slug: 'sereno',
		title: 'Sereno',
		category: 'Branding · Packaging',
		year: '2023',
		client: 'Sereno Wellness',
		services: ['Identidad visual', 'Packaging', 'Dirección de arte'],
		bg: 'linear-gradient(135deg, #5fb6a8 0%, #3f8f83 100%)',
		ink: '#f4f0e6',
		summary: 'Una marca de bienestar serena y luminosa, pensada para transmitir calma desde el primer vistazo.',
		challenge:
			'Sereno quería diferenciarse del cliché del wellness sin perder la sensación de calma y cuidado.',
		solution:
			'Trabajamos una paleta suave, formas orgánicas y un packaging táctil que acompaña la experiencia del producto.',
		gallery: [
			'linear-gradient(135deg, #5fb6a8 0%, #3f8f83 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
			'linear-gradient(135deg, #3f8f83 0%, #5fb6a8 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)'
		]
	}
];

export function getProject(slug: string): Project | undefined {
	return projects.find((p) => p.slug === slug);
}
