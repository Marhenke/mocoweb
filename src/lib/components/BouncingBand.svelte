<script lang="ts">
	// Cada "blob" es la misma imagen con un filtro distinto, así al hacer
	// click cambia visiblemente. Para sumar imágenes reales, agregá más
	// PNGs en static/blobs/ y metelos en esta lista con filter: 'none'.
	const blobs = [
		{ src: '/blobs/blob-1.png', filter: 'none' },
		{ src: '/blobs/blob-1.png', filter: 'hue-rotate(55deg) saturate(1.6) brightness(1.05)' },
		{ src: '/blobs/blob-1.png', filter: 'hue-rotate(200deg) saturate(1.4)' },
		{ src: '/blobs/blob-1.png', filter: 'grayscale(1) contrast(1.15)' }
	];

	let band = $state<HTMLElement>();
	let index = $state(0);

	// posición y movimiento
	let x = $state(40);
	let y = $state(40);
	let rot = $state(0);
	let hovered = $state(false);

	const SIZE = 150; // tamaño del blob en px
	const SPEED = 2.4; // px por frame
	let angle = Math.random() * Math.PI * 2;
	let vx = Math.cos(angle) * SPEED;
	let vy = Math.sin(angle) * SPEED;

	function step() {
		const el = band;
		if (!el) return;
		const W = el.clientWidth;
		const H = el.clientHeight;
		const maxX = Math.max(0, W - SIZE);
		const maxY = Math.max(0, H - SIZE);

		if (hovered) {
			// detenido: gira sobre sí mismo
			rot += 3;
		} else {
			x += vx;
			y += vy;

			let bounced = false;
			if (x <= 0) {
				x = 0;
				vx = Math.abs(vx);
				bounced = true;
			} else if (x >= maxX) {
				x = maxX;
				vx = -Math.abs(vx);
				bounced = true;
			}
			if (y <= 0) {
				y = 0;
				vy = Math.abs(vy);
				bounced = true;
			} else if (y >= maxY) {
				y = maxY;
				vy = -Math.abs(vy);
				bounced = true;
			}

			// al tocar un borde, cambia el ángulo un poco (no rebote perfecto)
			if (bounced) {
				const jitter = (Math.random() - 0.5) * 0.9; // ±0.45 rad
				const a = Math.atan2(vy, vx) + jitter;
				vx = Math.cos(a) * SPEED;
				vy = Math.sin(a) * SPEED;
			}
		}
	}

	function nextBlob() {
		index = (index + 1) % blobs.length;
		// re-lanza en una dirección nueva
		const a = Math.random() * Math.PI * 2;
		vx = Math.cos(a) * SPEED;
		vy = Math.sin(a) * SPEED;
	}

	$effect(() => {
		let raf: number;
		const loop = () => {
			step();
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
</script>

<section
	bind:this={band}
	onclick={nextBlob}
	onkeydown={(e) => e.key === 'Enter' && nextBlob()}
	role="button"
	tabindex="0"
	aria-label="Cambiar imagen"
	class="relative h-[55vh] min-h-[360px] w-full cursor-pointer overflow-hidden bg-ink select-none"
>
	<!-- texto sutil de ayuda -->
	<span
		class="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-semibold tracking-widest text-cream/30 uppercase"
	>
		Hacé click para cambiar · pasá el mouse para frenar
	</span>

	<img
		src={blobs[index].src}
		alt=""
		draggable="false"
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}
		style="width: {SIZE}px; height: {SIZE}px; transform: translate({x}px, {y}px) rotate({rot}deg); filter: {blobs[index].filter};"
		class="pointer-events-auto absolute top-0 left-0 object-contain will-change-transform"
	/>
</section>
