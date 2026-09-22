<script lang="ts">
	/**
	 * Lane B7 — "Ver preview": a full-screen, same-origin iframe overlay
	 * showing the real page(s) with the pending draft applied (the signed
	 * preview links already built server-side, `change-card.ts`), with a
	 * fixed bottom bar carrying the same Aprobar/Descartar the chat card
	 * has. If more than one page is affected (an entry's change can touch
	 * more than one route — e.g. a project touches home, /trabajos, AND its
	 * own detail page), a tab strip lets the owner switch between them.
	 *
	 * Same-origin by construction (`change-card.ts` always builds these
	 * URLs from this app's own `origin`) — the admin CSP's `default-src
	 * 'self'` (no explicit `frame-src`, see `hooks.server.ts`) already
	 * permits embedding it; `hooks.server.ts` also adds `frame-ancestors
	 * 'self'` to every PUBLIC page's response so this iframe is allowed to
	 * embed it while any OTHER origin still cannot.
	 */
	import type { ChangeCard, ChangeCardPage } from './types';

	interface Props {
		card: ChangeCard;
		busy: boolean;
		onApprove: () => void;
		onDiscard: () => void;
		onClose: () => void;
	}
	let { card, busy, onApprove, onDiscard, onClose }: Props = $props();

	// Flatten every page across every entry in the card, deduped by pattern
	// (two entries can legitimately share a page, e.g. both back the home
	// preview grid).
	let pages = $derived.by(() => {
		const seen = new Map<string, ChangeCardPage>();
		for (const entry of card.entries) {
			for (const p of entry.pages) {
				if (p.previewUrl) seen.set(p.pattern, p);
			}
		}
		return [...seen.values()];
	});

	let activeIndex = $state(0);
	$effect(() => {
		if (activeIndex >= pages.length) activeIndex = 0;
	});

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="preview-overlay" role="dialog" aria-modal="true" aria-label="Vista previa del cambio">
	<div class="preview-topbar">
		<div class="tabs">
			{#each pages as p, i (p.pattern)}
				<button type="button" class="tab" class:active={i === activeIndex} onclick={() => (activeIndex = i)}>
					{p.label}
				</button>
			{/each}
		</div>
		<button type="button" class="close-btn" onclick={onClose} aria-label="Cerrar vista previa">×</button>
	</div>

	<div class="preview-frame-wrap">
		{#if pages[activeIndex]?.previewUrl}
			{#key pages[activeIndex].previewUrl}
				<iframe class="preview-frame" src={pages[activeIndex].previewUrl} title={`Vista previa: ${pages[activeIndex].label}`}
				></iframe>
			{/key}
		{:else}
			<div class="no-pages">No hay una página para mostrar en preview.</div>
		{/if}
	</div>

	{#if card.status === 'pending'}
		<div class="preview-bar">
			<button type="button" class="btn discard" onclick={onDiscard} disabled={busy}>Descartar</button>
			<button type="button" class="btn approve" onclick={onApprove} disabled={busy}>
				{busy ? 'Publicando…' : 'Aprobar'}
			</button>
		</div>
	{/if}
</div>

<style>
	.preview-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: var(--color-cream, #f4f0e6);
		display: flex;
		flex-direction: column;
	}
	.preview-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		background: var(--color-cream-dark, #e8e2d2);
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		overflow-x: auto;
	}
	.tab {
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.45rem 0.8rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-ink);
		cursor: pointer;
		white-space: nowrap;
		min-height: 40px;
	}
	.tab.active {
		background: white;
		border-color: color-mix(in srgb, var(--color-ink) 20%, transparent);
	}
	.close-btn {
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		min-width: 44px;
		min-height: 44px;
		border-radius: 50%;
		border: none;
		background: white;
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
		color: var(--color-ink);
	}

	.preview-frame-wrap {
		flex: 1;
		min-height: 0;
	}
	.preview-frame {
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}
	.no-pages {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-muted, #666);
	}

	.preview-bar {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.7rem 1rem;
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		background: var(--color-cream-dark, #e8e2d2);
		padding-bottom: calc(0.7rem + env(safe-area-inset-bottom));
	}
	.btn {
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		border-radius: 0.6em;
		padding: 0.6em 1.2em;
		min-height: 44px;
		cursor: pointer;
		border: 1px solid transparent;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
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
</style>
