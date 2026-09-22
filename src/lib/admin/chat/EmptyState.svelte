<script lang="ts">
	/** Empty-state suggestions (Lane B6) — a few prompts relevant to operating a site, per the brief. */
	interface Props {
		onPick: (text: string) => void;
	}
	let { onPick }: Props = $props();

	const SUGGESTIONS = [
		'¿Cuántas visitas tuve esta semana?',
		'Leeme los mensajes nuevos',
		'Cambiá el título del home',
		'¿Qué proyectos tengo publicados ahora mismo?'
	];
</script>

<div class="empty-state">
	<p class="lead">Contame qué querés cambiar en el sitio, o adjuntá una imagen.</p>
	<div class="suggestions">
		{#each SUGGESTIONS as text (text)}
			<button type="button" class="suggestion" onclick={() => onPick(text)}>{text}</button>
		{/each}
	</div>
</div>

<style>
	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		text-align: center;
		padding: 2rem 1rem;
		color: var(--color-muted, #666);
	}
	.lead {
		margin: 0;
		font-size: 1rem;
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
		max-width: 32rem;
	}
	.suggestion {
		font-family: inherit;
		font-size: 0.85rem;
		background: white;
		border: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		border-radius: 999px;
		padding: 0.5rem 0.9rem;
		cursor: pointer;
		color: var(--color-ink);
		min-height: 44px;
	}
	.suggestion:hover {
		background: var(--color-cream-dark, #f4f0e6);
	}
	.suggestion:focus-visible {
		outline: 2px solid var(--color-ink);
		outline-offset: 2px;
	}
</style>
