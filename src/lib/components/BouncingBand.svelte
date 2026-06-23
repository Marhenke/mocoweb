<script lang="ts">
	const blobSrc = '/blobs/blob-1.png';
	const filters = [
		'none',
		'hue-rotate(55deg) saturate(1.6) brightness(1.05)',
		'hue-rotate(200deg) saturate(1.4)',
		'grayscale(1) contrast(1.15)'
	];

	const SIZE = 150;
	const SPEED = 4.5; // más rápido

	let band = $state<HTMLElement>();

	type Blob = {
		x: number;
		y: number;
		rot: number;
		vx: number;
		vy: number;
		hovered: boolean;
		filter: string;
	};

	function makeBlob(filterIndex: number): Blob {
		const a = Math.random() * Math.PI * 2;
		return {
			x: Math.random() * 200 + 40,
			y: Math.random() * 100 + 40,
			rot: 0,
			vx: Math.cos(a) * SPEED,
			vy: Math.sin(a) * SPEED,
			hovered: false,
			filter: filters[filterIndex % filters.length]
		};
	}

	let blobs = $state<Blob[]>([makeBlob(0)]);

	function addBlob() {
		blobs = [...blobs, makeBlob(blobs.length)];
	}

	function stepBlob(b: Blob) {
		const el = band;
		if (!el) return;
		const W = el.clientWidth;
		const H = el.clientHeight;
		const maxX = Math.max(0, W - SIZE);
		const maxY = Math.max(0, H - SIZE);

		if (b.hovered) {
			b.rot += 3;
			return;
		}

		b.x += b.vx;
		b.y += b.vy;

		let bounced = false;
		if (b.x <= 0) { b.x = 0; b.vx = Math.abs(b.vx); bounced = true; }
		else if (b.x >= maxX) { b.x = maxX; b.vx = -Math.abs(b.vx); bounced = true; }
		if (b.y <= 0) { b.y = 0; b.vy = Math.abs(b.vy); bounced = true; }
		else if (b.y >= maxY) { b.y = maxY; b.vy = -Math.abs(b.vy); bounced = true; }

		if (bounced) {
			const jitter = (Math.random() - 0.5) * 0.9;
			const a = Math.atan2(b.vy, b.vx) + jitter;
			b.vx = Math.cos(a) * SPEED;
			b.vy = Math.sin(a) * SPEED;
		}
	}

	$effect(() => {
		let raf: number;
		const loop = () => {
			for (const b of blobs) stepBlob(b);
			blobs = [...blobs]; // trigger reactivity
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
</script>

<section
	bind:this={band}
	onclick={addBlob}
	onkeydown={(e) => e.key === 'Enter' && addBlob()}
	role="button"
	tabindex="0"
	aria-label="Agregar blob"
	class="relative h-[55vh] min-h-[360px] w-full cursor-pointer overflow-hidden bg-ink select-none"
>
	<span
		class="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-semibold tracking-widest text-cream/30 uppercase"
	>
		Hacé click para sumar · pasá el mouse para frenar
	</span>

	{#each blobs as blob, i (i)}
		<img
			src={blobSrc}
			alt=""
			draggable="false"
			onmouseenter={() => (blob.hovered = true)}
			onmouseleave={() => (blob.hovered = false)}
			style="width: {SIZE}px; height: {SIZE}px; transform: translate({blob.x}px, {blob.y}px) rotate({blob.rot}deg); filter: {blob.filter};"
			class="pointer-events-auto absolute top-0 left-0 object-contain will-change-transform"
		/>
	{/each}
</section>
