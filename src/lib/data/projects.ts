/** Una celda de la galería: imagen real (src), video/reel (video) o placeholder (gradient). */
export type GalleryCell = {
	src?: string;
	video?: string;
	gradient?: string;
	/** ancho / alto de la celda — reparte el ancho de la fila manteniendo proporción */
	ratio: number;
};

/** La galería es una lista de filas; cada fila comparte el mismo alto. */
export type GalleryRow = GalleryCell[];

export type Project = {
	slug: string;
	title: string;
	category: string;
	year: string;
	client: string;
	services: string[];
	/** Color o URL de imagen para la tarjeta en la grilla */
	bg: string;
	/** URL de imagen para la portada en el detalle (si no se define, usa bg) */
	cover?: string;
	/** Color de texto sobre ese fondo */
	ink: string;
	summary: string;
	challenge: string;
	solution: string;
	gallery: GalleryRow[];
};

// Helper para placeholders: 2 filas de 2 bloques con ratio apaisado.
function placeholderGallery(colors: string[]): GalleryRow[] {
	const cells = colors.map((gradient) => ({ gradient, ratio: 1.4 }));
	return [cells.slice(0, 2), cells.slice(2, 4)];
}

export const projects: Project[] = [
	{
		slug: 'sergio-castiglione',
		title: 'Sergio Castiglione',
		category: 'Web · CM · Producción',
		year: '2025',
		client: 'Sergio Castiglione',
		services: ['Diseño web', 'Community Management', 'Producción de reels'],
		bg: '/projects/sergio-castiglione/Portada.png',
		cover: '/projects/sergio-castiglione/Portada.png',
		ink: '#f4f0e6',
		summary:
			'Presencia digital integral para Sergio Castiglione: web, redes y contenido audiovisual.',
		challenge:
			'Sergio necesitaba construir una presencia online sólida y coherente, que lo represente bien en todos los canales.',
		solution:
			'Diseñamos su web, tomamos las riendas de sus redes y producimos reels que muestran su trabajo con la calidad que se merece.',
		gallery: [
			// fila: 2 horizontales
			[
				{ src: '/projects/sergio-castiglione/Web_About_Tablet.png', ratio: 1.25 },
				{ src: '/projects/sergio-castiglione/Web_Archive.png', ratio: 1.25 }
			],
			// fila: 3 verticales (foto + reel + foto)
			[
				{ src: '/projects/sergio-castiglione/Web_Home_Mobile.png', ratio: 0.666 },
				{ video: '/projects/sergio-castiglione/Reel_Japon_1.mp4', ratio: 0.5625 },
				{ src: '/projects/sergio-castiglione/Web_Home.png', ratio: 0.75 }
			],
			// fila: 3 verticales (foto + reel + foto)
			[
				{ src: '/projects/sergio-castiglione/Web_Australis.png', ratio: 0.8 },
				{ video: '/projects/sergio-castiglione/Reel_Japon_2.mp4', ratio: 0.5625 },
				{ src: '/projects/sergio-castiglione/Web_Contact_Mobile.png', ratio: 0.8 }
			],
			// fila: 3 verticales (foto + reel + foto)
			[
				{ src: '/projects/sergio-castiglione/IG_Feed.png', ratio: 0.563 },
				{ video: '/projects/sergio-castiglione/Reel_Japon_Banos.mp4', ratio: 0.5625 },
				{ src: '/projects/sergio-castiglione/IG_Profile.png', ratio: 0.8 }
			],
			// fila: reel vertical + foto horizontal
			[
				{ video: '/projects/sergio-castiglione/Reel_Making_of_Segments.mp4', ratio: 0.5625 },
				{ src: '/projects/sergio-castiglione/Web_Contact.png', ratio: 1.225 }
			]
		]
	},
	{
		slug: 'racebox',
		title: 'Racebox',
		category: 'Contenido · Ads',
		year: '2025',
		client: 'Racebox',
		services: ['Placas para redes', 'Producción de reels', 'Ads'],
		bg: '/projects/racebox/portada.png',
		cover: '/projects/racebox/portada.png',
		ink: '#f4f0e6',
		summary:
			'Contenido para redes y campañas de ads para un courier e importador que necesitaba destacarse online.',
		challenge:
			'Racebox necesitaba una presencia digital constante y profesional, con piezas que comuniquen claro y campañas que traigan resultados.',
		solution:
			'Diseñamos placas para redes, producimos reels y armamos campañas de ads, dándole a Racebox una voz visual coherente y efectiva.',
		gallery: [
			// fila: 2 horizontales
			[
				{ src: '/projects/racebox/Racebox_IPad.png', ratio: 1.5 },
				{ src: '/projects/racebox/Racebox_MacBook.png', ratio: 1.5 }
			],
			// fila: 3 verticales (foto + reel + foto)
			[
				{ src: '/projects/racebox/Racebox_IPhone_Box_Cenital.png', ratio: 0.75 },
				{ video: '/projects/racebox/Racebox_Reel_Hub.mp4', ratio: 0.5625 },
				{ src: '/projects/racebox/Racebox_IPhone_Boxes.png', ratio: 0.563 }
			],
			// fila: 2 horizontales
			[
				{ src: '/projects/racebox/Racebox_IPhone_In_Box.png', ratio: 1.5 },
				{ src: '/projects/racebox/Racebox_IPhone_Leaning_Box.png', ratio: 1.777 }
			],
			// fila: 3 verticales (reel + foto + reel)
			[
				{ video: '/projects/racebox/Racebox_Reel_LCL_Courier.mp4', ratio: 0.5625 },
				{ src: '/projects/racebox/Racebox_IPhone_Hand.png', ratio: 0.592 },
				{ video: '/projects/racebox/Racebox_Reel_Socio_Logistico.mp4', ratio: 0.5625 }
			]
		]
	},
	{
		slug: 'ref',
		title: 'REF',
		category: 'Contenido · Cobertura',
		year: '2025 - 2026',
		client: 'REF',
		services: [
			'Contenido para redes',
			'Comunicación institucional',
			'Cobertura de eventos',
			'Newsletters',
			'Diseño gráfico'
		],
		bg: '/projects/ref/portada.jpeg',
		cover: '/projects/ref/portada.jpeg',
		ink: '#f4f0e6',
		summary:
			'Comunicación digital activa que refleja la identidad de REF, sus eventos y la comunidad que forma parte del proyecto.',
		challenge:
			'Generar una comunicación digital activa que refleje la identidad de REF, sus eventos y la comunidad que forma parte del proyecto.',
		solution:
			'Desarrollamos contenido para redes y comunicación institucional, incluyendo la cobertura del AMM 25 con producción de pantallas, aftermovie e historias en tiempo real. Realizamos coberturas fotográficas y audiovisuales de eventos de comunidad como el asado con los campeones del 86, visita al atelier de Min Agostini, Foro Shuffles, entre otros. También producimos newsletters mensuales, flyers y piezas gráficas para acompañar la comunicación de REF y mantener una presencia digital constante.',
		gallery: [
			// fila: 2 horizontales (fotos)
			[
				{ src: '/projects/ref/ref-25.jpg', ratio: 1.5 },
				{ src: '/projects/ref/ref-32.jpg', ratio: 1.5 }
			],
			// fila: video horizontal (protagonista) + placa vertical
			[
				{ video: '/projects/ref/video-horizontal.mp4', ratio: 1.777 },
				{ src: '/projects/ref/placa-4.png', ratio: 0.8 }
			],
			// fila: 3 verticales (reel + placa + reel) — reels separados por la imagen
			[
				{ video: '/projects/ref/reel-1.mp4', ratio: 0.5625 },
				{ src: '/projects/ref/placa-1.png', ratio: 0.75 },
				{ video: '/projects/ref/reel-2.mp4', ratio: 0.5625 }
			],
			// fila: 2 horizontales (placa + foto)
			[
				{ src: '/projects/ref/placa-2.png', ratio: 1.333 },
				{ src: '/projects/ref/ref-278.jpg', ratio: 1.5 }
			],
			// fila: 3 verticales (reel + placa + reel) — reels separados por la imagen
			[
				{ video: '/projects/ref/reel-3.mp4', ratio: 0.5625 },
				{ src: '/projects/ref/placa-3.png', ratio: 0.8 },
				{ video: '/projects/ref/reel-4.mp4', ratio: 0.5625 }
			],
			// fila: 2 horizontales (fotos)
			[
				{ src: '/projects/ref/ref-282.jpg', ratio: 1.5 },
				{ src: '/projects/ref/ref-359.jpg', ratio: 1.5 }
			],
			// fila: 2 horizontales (fotos)
			[
				{ src: '/projects/ref/ref-93.jpg', ratio: 1.5 },
				{ src: '/projects/ref/ref-130.jpg', ratio: 1.5 }
			]
		]
	},
	{
		slug: 'barbara-plesky',
		title: 'Barbara Plesky',
		category: 'Contenido · Producción audiovisual · Redes',
		year: '2025',
		client: 'Barbara Plesky',
		services: ['Producción audiovisual', 'Contenido para redes', 'Cobertura de evento'],
		bg: '/projects/barbara-plesky/placa.png',
		cover: '/projects/barbara-plesky/placa.png',
		ink: '#f4f0e6',
		summary:
			'Cobertura oficial de la participación de la artista Barbara Plesky en Proyecto Arte 2025, feria de arte realizada en LATU Montevideo, acompañando la presentación de su obra "Atravesadas" a través de contenido audiovisual para redes sociales.',
		challenge:
			'Comunicar la participación de Barbara y su obra "Atravesadas" en una feria de arte, generando contenido que transmitiera la experiencia para sus redes sociales.',
		solution:
			'Hicimos la cobertura audiovisual completa del evento en el LATU de Montevideo, produciendo fotos y reels pensados para redes que acompañaron la presentación de la obra.',
		gallery: [
			// fila: 3 verticales (foto + reel + foto) — reel separado por las fotos
			[
				{ src: '/projects/barbara-plesky/foto-1.jpg', ratio: 0.75 },
				{ video: '/projects/barbara-plesky/reel.mp4', ratio: 0.5625 },
				{ src: '/projects/barbara-plesky/foto-2.jpg', ratio: 0.75 }
			],
			// fila: 1 vertical (foto, alineada a la izquierda)
			[{ src: '/projects/barbara-plesky/foto-3.jpg', ratio: 0.75 }]
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
		gallery: placeholderGallery([
			'linear-gradient(135deg, #7c5cff 0%, #5b3df0 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)',
			'linear-gradient(135deg, #5b3df0 0%, #7c5cff 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)'
		])
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
		summary:
			'Una marca de bienestar serena y luminosa, pensada para transmitir calma desde el primer vistazo.',
		challenge:
			'Sereno quería diferenciarse del cliché del wellness sin perder la sensación de calma y cuidado.',
		solution:
			'Trabajamos una paleta suave, formas orgánicas y un packaging táctil que acompaña la experiencia del producto.',
		gallery: placeholderGallery([
			'linear-gradient(135deg, #5fb6a8 0%, #3f8f83 100%)',
			'linear-gradient(135deg, #e8e2d2 0%, #cfc6ac 100%)',
			'linear-gradient(135deg, #3f8f83 0%, #5fb6a8 100%)',
			'linear-gradient(135deg, #16140f 0%, #3a362d 100%)'
		])
	}
];

export function getProject(slug: string): Project | undefined {
	return projects.find((p) => p.slug === slug);
}
