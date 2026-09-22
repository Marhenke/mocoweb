<script lang="ts">
	/**
	 * The message composer (Lane B6, reworked in B7): ONE contained rounded
	 * "well" — the attach button, the textarea, and the send/stop button all
	 * live inside a single rounded container (per the B7 brief; previously
	 * the textarea was its own separate pill next to two free-floating round
	 * buttons, which read as three components, not one). Collapsed to a
	 * single line by default; focusing it (even before typing) opens it to
	 * ~2 lines; typing grows it further up to 4 lines, then it scrolls
	 * internally with no native scrollbar visible until it actually
	 * overflows that 4th line (see `autoGrow` below — `resize: none` plus an
	 * explicit height cap is what fixes Safari's scrollbar/resize-handle
	 * artifact breaking the well's rounded corner, which is what "Safari
	 * scrollbar breaking its geometry" in the brief refers to).
	 *
	 * Drag-and-drop moved OUT of this component in B7 — the brief wants a
	 * file dropped ANYWHERE on the page to attach, not just on the composer,
	 * so that's now handled once, page-wide, by `ChatPanel.svelte`
	 * (`onWindowDrop` et al.) using the same `attachment-validation.ts` this
	 * file also uses for the file picker and paste-to-attach, so all three
	 * entry points enforce identical rules.
	 *
	 * Never a blocking button (per the brief): the send/stop control is
	 * ALWAYS clickable — while a turn is in flight it becomes Stop instead of
	 * being disabled, so there is never a moment where the person is staring
	 * at a frozen, unresponsive control.
	 */
	import type { PendingAttachment } from './types';
	import { validateAttachmentFiles } from './attachment-validation';

	interface Props {
		value: string;
		attachments: PendingAttachment[];
		sending: boolean;
		onSend: () => void;
		onStop: () => void;
		onFilesAdded: (files: File[]) => void;
		onRemoveAttachment: (id: string) => void;
	}
	let {
		value = $bindable(),
		attachments,
		sending,
		onSend,
		onStop,
		onFilesAdded,
		onRemoveAttachment
	}: Props = $props();

	// Touch devices get "Enter inserts a newline, the button sends" (per the
	// brief) — detected once, from the same signal iOS/Android browsers both
	// expose, rather than guessed from viewport width (a Bluetooth-keyboard
	// tablet is still a touch device by this check, correctly).
	const isTouchDevice =
		typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let fileInputEl: HTMLInputElement | undefined = $state();
	let composerEl: HTMLDivElement | undefined = $state();
	let focused = $state(false);

	let validationMessage = $state('');

	// One line ≈ 44px (matches the 44px touch-target minimum already used
	// throughout this app). ~2 lines while focused-but-not-grown, capped at
	// ~4 lines — past that, the textarea's own native `overflow-y: auto`
	// takes over (no scrollbar rendered at all until `scrollHeight` actually
	// exceeds this cap, which is the "no stray scrollbar" requirement).
	const LINE_PX = 22;
	const COLLAPSED_PX = 44;
	const FOCUSED_MIN_PX = 44 + LINE_PX; // ~2 lines
	const MAX_PX = 44 + LINE_PX * 3; // ~4 lines

	function autoGrow(): void {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const floor = focused ? FOCUSED_MIN_PX : COLLAPSED_PX;
		const next = Math.min(Math.max(textareaEl.scrollHeight, floor), MAX_PX);
		textareaEl.style.height = `${next}px`;
	}
	$effect(() => {
		void value;
		void focused;
		autoGrow();
	});

	function canSend(): boolean {
		return !sending && (value.trim().length > 0 || attachments.length > 0);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter') return;
		if (isTouchDevice) return; // Enter inserts a newline there; the button sends.
		if (event.shiftKey) return; // newline
		event.preventDefault();
		if (canSend()) onSend();
	}

	function onFileInputChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const { ok, message } = validateAttachmentFiles(Array.from(input.files ?? []));
		validationMessage = message;
		if (ok.length > 0) onFilesAdded(ok);
		input.value = '';
	}

	function onPaste(event: ClipboardEvent): void {
		const items = Array.from(event.clipboardData?.items ?? []);
		const files = items
			.filter((it) => it.kind === 'file')
			.map((it) => it.getAsFile())
			.filter((f): f is File => f !== null);
		if (files.length === 0) return; // let normal text paste through
		event.preventDefault();
		const { ok, message } = validateAttachmentFiles(files);
		validationMessage = message;
		if (ok.length > 0) onFilesAdded(ok);
	}

	// ── Mobile: keep the composer above the on-screen keyboard ──────────────
	// `100dvh`/safe-area insets handle notches and static layout, but an
	// on-screen keyboard on iOS Safari shrinks `visualViewport`, not the
	// layout viewport — without this, the composer stays pinned to a
	// `position: fixed` bottom that's now UNDER the keyboard. Pinning this
	// element's `bottom` offset to `window.innerHeight - visualViewport.height
	// - visualViewport.offsetTop` keeps it visible above the keyboard on every
	// browser that implements the API; browsers that don't (falls back to
	// `undefined` checks below) just keep the existing safe-area-only layout.
	let keyboardInset = $state(0);
	function updateKeyboardInset(): void {
		const vv = window.visualViewport;
		if (!vv) {
			keyboardInset = 0;
			return;
		}
		const inset = window.innerHeight - vv.height - vv.offsetTop;
		keyboardInset = Math.max(0, Math.round(inset));
	}
	$effect(() => {
		if (typeof window === 'undefined' || !window.visualViewport) return;
		const vv = window.visualViewport;
		updateKeyboardInset();
		vv.addEventListener('resize', updateKeyboardInset);
		vv.addEventListener('scroll', updateKeyboardInset);
		return () => {
			vv.removeEventListener('resize', updateKeyboardInset);
			vv.removeEventListener('scroll', updateKeyboardInset);
		};
	});
</script>

<div
	bind:this={composerEl}
	class="composer-wrap"
	style={keyboardInset > 0 ? `padding-bottom: ${keyboardInset}px` : undefined}
>
	{#if validationMessage}
		<div class="validation-msg" role="alert">{validationMessage}</div>
	{/if}

	{#if attachments.length > 0}
		<div class="attachments">
			{#each attachments as att (att.id)}
				<div class="attachment" class:has-error={att.status === 'error'}>
					{#if att.previewUrl}
						<img src={att.previewUrl} alt={att.file.name} />
					{:else}
						<span class="attachment-name">{att.file.name}</span>
					{/if}
					{#if att.status === 'uploading'}
						<div class="attachment-progress" aria-label="Subiendo…"></div>
					{/if}
					{#if att.status === 'error'}
						<div class="attachment-error" title={att.errorMessage ?? ''}>!</div>
					{/if}
					<button
						type="button"
						class="remove-btn"
						onclick={() => onRemoveAttachment(att.id)}
						aria-label={`Quitar ${att.file.name}`}
					>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="well" role="group" aria-label="Compositor de mensajes">
		<button
			type="button"
			class="icon-btn attach-btn"
			onclick={() => fileInputEl?.click()}
			aria-label="Adjuntar archivo"
		>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path
					fill="currentColor"
					d="M16.5 6.5v9a4.5 4.5 0 0 1-9 0v-10a3 3 0 0 1 6 0v9.5a1.5 1.5 0 0 1-3 0v-8.5h-1.5v8.5a3 3 0 0 0 6 0v-9.5a4.5 4.5 0 0 0-9 0v10a6 6 0 0 0 12 0v-9z"
				/>
			</svg>
		</button>
		<input
			bind:this={fileInputEl}
			type="file"
			accept="image/*,video/mp4,video/webm,video/quicktime"
			multiple
			class="visually-hidden-input"
			onchange={onFileInputChange}
		/>

		<textarea
			bind:this={textareaEl}
			bind:value
			onkeydown={handleKeydown}
			oninput={autoGrow}
			onpaste={onPaste}
			onfocus={() => (focused = true)}
			onblur={() => (focused = false)}
			placeholder="Escribí tu mensaje…"
			rows="1"
			aria-label="Mensaje"
		></textarea>

		{#if sending}
			<button type="button" class="send-btn stop" onclick={onStop} aria-label="Detener generación">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
				</svg>
			</button>
		{:else}
			<button
				type="button"
				class="send-btn"
				class:inactive={!canSend()}
				onclick={() => canSend() && onSend()}
				aria-label="Enviar mensaje"
			>
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path fill="currentColor" d="M3 11.5 20.5 4l-6 17-3.5-7.5L3 11.5Z" />
				</svg>
			</button>
		{/if}
	</div>
</div>

<style>
	.composer-wrap {
		position: relative;
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
		background: var(--color-cream-dark, #f4f0e6);
		padding: 0.7rem 1rem;
		padding-bottom: calc(0.7rem + env(safe-area-inset-bottom));
	}

	.validation-msg {
		max-width: 46rem;
		margin: 0 auto;
		padding: 0 0 0.4rem;
		font-size: 0.78rem;
		color: crimson;
	}

	.attachments {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		max-width: 46rem;
		margin: 0 auto;
		padding: 0 0 0.6rem;
	}
	.attachment {
		position: relative;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 0.6rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
		flex-shrink: 0;
	}
	.attachment img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.attachment-name {
		display: block;
		font-size: 0.55rem;
		padding: 0.25rem;
		word-break: break-all;
	}
	.attachment.has-error {
		outline: 2px solid crimson;
	}
	.attachment-progress {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, white 40%, transparent);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.attachment-progress::after {
		content: '';
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		border: 2px solid color-mix(in srgb, var(--color-ink) 30%, transparent);
		border-top-color: var(--color-ink);
		animation: spin 0.8s linear infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.attachment-progress::after {
			animation: none;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.attachment-error {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, crimson 15%, white);
		color: crimson;
		font-weight: 700;
	}
	.remove-btn {
		position: absolute;
		top: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.65);
		color: white;
		border: none;
		width: 1.3rem;
		height: 1.3rem;
		line-height: 1;
		border-radius: 0 0 0 0.4rem;
		cursor: pointer;
		font-size: 0.9rem;
	}

	/* ── The single rounded well ─────────────────────────────────────────── */
	.well {
		display: flex;
		align-items: flex-end;
		gap: 0.35rem;
		max-width: 46rem;
		margin: 0 auto;
		background: white;
		border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent);
		border-radius: 1.4rem;
		padding: 0.3rem 0.35rem;
		box-sizing: border-box;
	}
	.well:focus-within {
		border-color: color-mix(in srgb, var(--color-ink) 40%, transparent);
	}

	.icon-btn {
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-ink);
	}
	.icon-btn:hover {
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
	}
	.icon-btn:focus-visible {
		outline: 2px solid var(--color-ink);
		outline-offset: 2px;
	}

	.visually-hidden-input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}

	.well textarea {
		flex: 1;
		resize: none;
		min-height: 44px;
		max-height: 110px; /* ~4 lines — kept in sync with MAX_PX in the script */
		padding: 0.65rem 0.4rem;
		border: none;
		outline: none;
		background: transparent;
		font-family: inherit;
		/* 16px minimum: iOS Safari zooms the page on focus for any input
		   font-size below this. */
		font-size: 16px;
		line-height: 1.4;
		color: var(--color-ink);
		/* `overflow-y: auto` (the browser default) already means no scrollbar
		   renders until `scrollHeight` exceeds the element's own height — the
		   cap above is what makes that point "4 lines," not sooner. `resize:
		   none` is what stops Safari/Chrome from drawing a resize handle in
		   the corner, which is what broke the well's rounded geometry before
		   this lane (a square-cornered grab handle sitting on top of a
		   rounded pill). */
	}

	.send-btn {
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		min-width: 44px;
		min-height: 44px;
		border-radius: 50%;
		border: none;
		background: var(--color-ink);
		color: var(--color-cream);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}
	.send-btn.inactive {
		opacity: 0.4;
	}
	.send-btn.stop {
		background: crimson;
	}
	.send-btn:focus-visible {
		outline: 2px solid var(--color-ink);
		outline-offset: 2px;
	}

	@media (max-width: 30rem) {
		.composer-wrap {
			padding: 0.6rem 0.75rem;
			padding-bottom: calc(0.6rem + env(safe-area-inset-bottom));
		}
	}
</style>
