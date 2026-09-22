<script lang="ts">
	/**
	 * Lane B7 — the "approve this preview" card. Renders inside an assistant
	 * bubble (see `MessageBubble.svelte`) whenever that row's `changeCard` is
	 * set. Deliberately never says "borrador"/"draft"/"publishedData" — see
	 * this lane's brief — every label here is written for a non-technical
	 * reader: "antes → después", "Ver preview", "Aprobar", "Descartar".
	 */
	import type { ChangeCard } from './types';

	interface Props {
		card: ChangeCard;
		busy: boolean;
		onPreview: () => void;
		onApprove: () => void;
		onDiscard: () => void;
		onUndo: () => void;
	}
	let { card, busy, onPreview, onApprove, onDiscard, onUndo }: Props = $props();
</script>

<div class="change-card" class:published={card.status === 'published'}>
	<div class="change-card-header">
		<span class="badge badge-{card.status}">
			{#if card.status === 'pending'}Cambios preparados
			{:else if card.status === 'published'}✓ Publicado
			{:else if card.status === 'undone'}↩ Deshecho
			{:else}Descartado
			{/if}
		</span>
	</div>

	<div class="change-card-entries">
		{#each card.entries as entry (entry.collection + '::' + (entry.slug ?? ''))}
			<div class="entry">
				<div class="entry-label">
					{entry.label}
					{#if entry.isDeletion}<span class="tag tag-delete">se va a borrar</span>{:else if entry.isNew}<span class="tag">nuevo</span>{/if}
				</div>
				{#if entry.fields.length > 0}
					<div class="fields">
						{#each entry.fields as f (f.label)}
							<div class="field">
								<span class="field-label">{f.label}</span>
								<div class="field-diff">
									{#if f.before}<span class="before">{f.before}</span><span class="arrow">→</span>{/if}
									<span class="after">{f.after}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}
				{#if entry.images.length > 0}
					<div class="images">
						{#each entry.images as img (img.url)}
							<img src={img.url} alt={img.alt} loading="lazy" />
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="change-card-actions">
		{#if card.status === 'pending'}
			<button type="button" class="btn ghost" onclick={onPreview} disabled={busy}>Ver preview</button>
			<button type="button" class="btn discard" onclick={onDiscard} disabled={busy}>Descartar</button>
			<button type="button" class="btn approve" onclick={onApprove} disabled={busy}>
				{busy ? 'Publicando…' : 'Aprobar'}
			</button>
		{:else if card.status === 'published'}
			<button type="button" class="btn ghost" onclick={onPreview} disabled={busy}>Ver preview</button>
			<button type="button" class="btn undo" onclick={onUndo} disabled={busy}>
				{busy ? 'Deshaciendo…' : 'Deshacer'}
			</button>
		{/if}
	</div>
</div>

<style>
	.change-card {
		margin-top: 0.6em;
		border: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		border-radius: 0.8em;
		background: white;
		overflow: hidden;
	}
	.change-card.published {
		border-color: color-mix(in srgb, var(--color-lime) 60%, var(--color-ink) 20%);
	}
	.change-card-header {
		padding: 0.5em 0.8em 0;
	}
	.badge {
		display: inline-block;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.2em 0.6em;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
	}
	.badge-published {
		background: var(--color-lime);
		color: var(--color-ink);
	}
	.badge-discarded,
	.badge-undone {
		background: color-mix(in srgb, var(--color-ink) 10%, transparent);
		color: var(--color-muted, #666);
	}

	.change-card-entries {
		padding: 0.6em 0.8em;
		display: flex;
		flex-direction: column;
		gap: 0.7em;
	}
	.entry-label {
		font-weight: 700;
		font-size: 0.9rem;
		display: flex;
		align-items: center;
		gap: 0.4em;
	}
	.tag {
		font-size: 0.65rem;
		font-weight: 600;
		background: color-mix(in srgb, var(--color-ink) 10%, transparent);
		border-radius: 999px;
		padding: 0.1em 0.5em;
	}
	.tag-delete {
		background: color-mix(in srgb, crimson 15%, transparent);
		color: crimson;
	}
	.fields {
		margin-top: 0.35em;
		display: flex;
		flex-direction: column;
		gap: 0.3em;
	}
	.field-label {
		font-size: 0.72rem;
		color: var(--color-muted, #666);
		display: block;
	}
	.field-diff {
		font-size: 0.88rem;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.35em;
	}
	.before {
		text-decoration: line-through;
		opacity: 0.55;
	}
	.arrow {
		opacity: 0.5;
	}
	.after {
		font-weight: 600;
	}
	.images {
		margin-top: 0.4em;
		display: flex;
		gap: 0.4em;
		flex-wrap: wrap;
	}
	.images img {
		width: 4.5rem;
		height: 4.5rem;
		object-fit: cover;
		border-radius: 0.5em;
		display: block;
	}

	.change-card-actions {
		display: flex;
		gap: 0.5em;
		flex-wrap: wrap;
		padding: 0.6em 0.8em 0.8em;
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 8%, transparent);
	}
	.btn {
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		border-radius: 0.6em;
		padding: 0.5em 0.9em;
		min-height: 40px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.ghost {
		background: transparent;
		border-color: color-mix(in srgb, var(--color-ink) 25%, transparent);
		color: var(--color-ink);
	}
	.btn.approve {
		background: var(--color-ink);
		color: var(--color-cream);
	}
	.btn.discard {
		background: transparent;
		border-color: color-mix(in srgb, crimson 40%, transparent);
		color: crimson;
	}
	.btn.undo {
		background: transparent;
		border-color: color-mix(in srgb, var(--color-ink) 25%, transparent);
		color: var(--color-ink);
	}
</style>
