<script lang="ts">
	/**
	 * Lane B8 — the site's ONE open change set, as a persistent pinned bar.
	 * Replaces the B7 in-thread "change card" (`ChangeCardView.svelte`,
	 * removed) entirely: this never renders inside the message list, is
	 * never a bubble, and there is only ever one of these on screen — see
	 * `$lib/server/cms/chat/pending-changes.ts`'s header and this lane's
	 * brief ("it must be impossible to have more than one preview open").
	 *
	 * Shows a live, same-origin, non-interactive thumbnail of the actual
	 * page with the change applied (a scaled-down iframe against the real
	 * signed preview URL — never a reconstructed diff/collage, see
	 * `$lib/server/cms/chat/change-card.ts`'s header for why that changed),
	 * one sober line per touched entry, and Ver preview / Aprobar / Descartar
	 * — or, once approved, Deshacer instead. Absent entirely when `card` is
	 * null (nothing open).
	 */
	import { dedupePages } from './pages';
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

	let pages = $derived(dedupePages(card));
	let activeIndex = $state(0);
	$effect(() => {
		if (activeIndex >= pages.length) activeIndex = 0;
	});

	function cyclePage(): void {
		if (pages.length <= 1) return;
		activeIndex = (activeIndex + 1) % pages.length;
	}

	let headline = $derived(card.entries[0] ? `${card.entries[0].label} — ${card.entries[0].summary}` : '');
	let extraCount = $derived(Math.max(0, card.entries.length - 1));
</script>

{#if card.entries.length > 0}
	<div class="pending-bar" class:published={card.status === 'published'}>
		<button
			type="button"
			class="thumb"
			onclick={pages.length > 1 ? cyclePage : onPreview}
			aria-label={pages.length > 1 ? `Cambiar de página en la miniatura (mostrando ${pages[activeIndex]?.label ?? ''})` : 'Ver preview'}
		>
			<span class="thumb-frame-wrap">
				{#if pages[activeIndex]?.previewUrl}
					{#key pages[activeIndex].previewUrl}
						<iframe
							class="thumb-frame"
							src={pages[activeIndex].previewUrl}
							loading="lazy"
							sandbox="allow-scripts allow-same-origin"
							tabindex="-1"
							title={`Miniatura: ${pages[activeIndex].label}`}
						></iframe>
					{/key}
				{/if}
			</span>
			{#if pages.length > 1}
				<span class="thumb-page-tag">{pages[activeIndex]?.label} ⇄</span>
			{/if}
		</button>

		<div class="pending-text">
			<div class="pending-title">
				{card.status === 'published' ? 'Publicado ✓' : 'Tenés cambios preparados'}
			</div>
			<div class="pending-summary">
				{headline}{#if extraCount > 0}<span class="extra"> y {extraCount} {extraCount === 1 ? 'cambio más' : 'cambios más'}</span>{/if}
			</div>
		</div>

		<div class="pending-actions">
			<button type="button" class="btn ghost" onclick={onPreview} disabled={busy}>Ver preview</button>
			{#if card.status === 'pending'}
				<button type="button" class="btn discard" onclick={onDiscard} disabled={busy}>Descartar</button>
				<button type="button" class="btn approve" onclick={onApprove} disabled={busy}>
					{busy ? 'Publicando…' : 'Aprobar'}
				</button>
			{:else}
				<button type="button" class="btn undo" onclick={onUndo} disabled={busy}>
					{busy ? 'Deshaciendo…' : 'Deshacer'}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.pending-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		padding: 0.6rem 0.9rem;
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		background: var(--color-cream-dark, #e8e2d2);
	}
	.pending-bar.published {
		background: color-mix(in srgb, var(--color-lime) 22%, var(--color-cream-dark, #e8e2d2));
	}

	.thumb {
		flex-shrink: 0;
		display: block;
		position: relative;
		width: 96px;
		height: 64px;
		padding: 0;
		border: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
		border-radius: 0.5em;
		overflow: hidden;
		background: white;
		cursor: pointer;
	}
	.thumb-frame-wrap {
		display: block;
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.thumb-frame {
		position: absolute;
		top: 0;
		left: 0;
		width: 1280px;
		height: 853px;
		border: none;
		transform: scale(0.075);
		transform-origin: top left;
		/* Lane B8 brief: clicks on the thumbnail open the overlay (or cycle
		   pages) rather than interacting with the embedded page underneath. */
		pointer-events: none;
	}
	.thumb-page-tag {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		font-size: 0.6rem;
		font-weight: 600;
		text-align: center;
		background: color-mix(in srgb, var(--color-ink) 70%, transparent);
		color: white;
		padding: 0.1em 0;
	}

	.pending-text {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.pending-title {
		font-weight: 700;
		font-size: 0.85rem;
	}
	.pending-summary {
		font-size: 0.8rem;
		color: var(--color-muted, #666);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.extra {
		opacity: 0.8;
	}

	.pending-actions {
		display: flex;
		gap: 0.5em;
		flex-wrap: wrap;
	}
	.btn {
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		border-radius: 0.6em;
		padding: 0.5em 0.9em;
		min-height: 44px;
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

	@media (max-width: 480px) {
		.pending-bar {
			gap: 0.5rem;
		}
		.thumb {
			width: 72px;
			height: 48px;
		}
		.thumb-frame {
			width: 960px;
			height: 640px;
			transform: scale(0.075);
		}
		.pending-text {
			flex-basis: 100%;
			order: 3;
		}
		.pending-actions {
			flex-basis: 100%;
			order: 4;
		}
		.pending-actions .btn {
			flex: 1;
		}
	}
</style>
