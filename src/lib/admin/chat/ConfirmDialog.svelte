<script lang="ts">
	/**
	 * A centred, accessible confirm modal (Lane B7) — replaces the inline
	 * "¿Borrar toda la conversación?" text that used to appear directly in
	 * the topbar (easy to trigger by accident, no real focus management) and
	 * backs the brand-new confirm step for "Cerrar sesión" (previously NONE
	 * at all — one misclick logged the owner out). Accessible per the brief:
	 * traps Tab focus inside the dialog, Esc cancels, and focus returns to
	 * whatever triggered it on close.
	 */
	interface Props {
		title: string;
		message: string;
		confirmLabel: string;
		cancelLabel?: string;
		danger?: boolean;
		busy?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}
	let { title, message, confirmLabel, cancelLabel = 'Cancelar', danger = false, busy = false, onConfirm, onCancel }: Props =
		$props();

	let dialogEl: HTMLDivElement | undefined = $state();
	let confirmBtnEl: HTMLButtonElement | undefined = $state();
	let previouslyFocused: HTMLElement | null = null;

	function focusables(): HTMLElement[] {
		if (!dialogEl) return [];
		return [...dialogEl.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
			(el) => !el.hasAttribute('disabled')
		);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key !== 'Tab') return;
		const items = focusables();
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		previouslyFocused = document.activeElement as HTMLElement | null;
		confirmBtnEl?.focus();
		return () => {
			previouslyFocused?.focus?.();
		};
	});
</script>

<div class="backdrop" role="presentation" onclick={onCancel}>
	<div
		class="dialog"
		bind:this={dialogEl}
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="confirm-dialog-title"
		aria-describedby="confirm-dialog-message"
		tabindex="-1"
		onkeydown={handleKeydown}
		onclick={(e) => e.stopPropagation()}
	>
		<h2 id="confirm-dialog-title">{title}</h2>
		<p id="confirm-dialog-message">{message}</p>
		<div class="actions">
			<button type="button" class="btn ghost" onclick={onCancel} disabled={busy}>{cancelLabel}</button>
			<button
				bind:this={confirmBtnEl}
				type="button"
				class="btn"
				class:danger
				onclick={onConfirm}
				disabled={busy}
			>
				{busy ? '…' : confirmLabel}
			</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: color-mix(in srgb, black 45%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}
	.dialog {
		background: var(--color-cream, #fff);
		color: var(--color-ink);
		border-radius: 1rem;
		padding: 1.4rem;
		max-width: 24rem;
		width: 100%;
		box-shadow: 0 10px 40px color-mix(in srgb, black 25%, transparent);
	}
	.dialog h2 {
		margin: 0 0 0.5rem;
		font-family: var(--font-display);
		font-size: 1.15rem;
	}
	.dialog p {
		margin: 0 0 1.2rem;
		font-size: 0.9rem;
		color: var(--color-muted, #555);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}
	.btn {
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 0.6em;
		padding: 0.55em 1.1em;
		min-height: 44px;
		cursor: pointer;
		border: 1px solid transparent;
		background: var(--color-ink);
		color: var(--color-cream);
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
	.btn.danger {
		background: crimson;
		border-color: crimson;
		color: white;
	}
</style>
