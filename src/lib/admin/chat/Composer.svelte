<script lang="ts">
	/**
	 * The message composer (Lane B6): auto-growing textarea (max height, then
	 * scroll), Enter-to-send / Shift+Enter-newline on desktop (Enter inserts a
	 * newline on touch devices — the button sends there instead, since a
	 * virtual keyboard's Enter/Return key is what people expect to make a new
	 * line), drag-and-drop with a visible drop-zone overlay, paste-to-attach,
	 * a file-picker button, thumbnails with per-file removal and upload
	 * progress, and a mobile keyboard-safe layout via `visualViewport`.
	 *
	 * Never a blocking button (per the brief): the send/stop control is
	 * ALWAYS clickable — while a turn is in flight it becomes Stop instead of
	 * being disabled, so there is never a moment where the person is staring
	 * at a frozen, unresponsive control.
	 */
	import type { PendingAttachment } from './types';

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
	let dragActive = $state(false);
	let dragDepth = 0;
	let composerEl: HTMLDivElement | undefined = $state();

	const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB — a client-side safety margin (see this file's callers for why an exact server limit isn't chased here).
	const ACCEPTED_TYPES = /^image\/|^video\/(mp4|webm|quicktime)/;
	let validationMessage = $state('');

	function autoGrow(): void {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`;
	}
	$effect(() => {
		void value;
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

	function validateFiles(files: File[]): File[] {
		const ok: File[] = [];
		const problems: string[] = [];
		for (const file of files) {
			if (!ACCEPTED_TYPES.test(file.type)) {
				problems.push(`"${file.name}": tipo de archivo no admitido (solo imágenes o video).`);
				continue;
			}
			if (file.size > MAX_FILE_BYTES) {
				problems.push(`"${file.name}": pesa demasiado (máximo ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
				continue;
			}
			ok.push(file);
		}
		validationMessage = problems.join(' ');
		if (ok.length > 0 && problems.length === 0) validationMessage = '';
		return ok;
	}

	function onFileInputChange(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const files = validateFiles(Array.from(input.files ?? []));
		if (files.length > 0) onFilesAdded(files);
		input.value = '';
	}

	function onDragEnter(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		dragDepth++;
		dragActive = true;
	}
	function onDragOver(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
	}
	function onDragLeave(event: DragEvent): void {
		event.preventDefault();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragActive = false;
	}
	function onDrop(event: DragEvent): void {
		event.preventDefault();
		dragDepth = 0;
		dragActive = false;
		const files = Array.from(event.dataTransfer?.files ?? []);
		const ok = validateFiles(files);
		if (ok.length > 0) onFilesAdded(ok);
	}

	function onPaste(event: ClipboardEvent): void {
		const items = Array.from(event.clipboardData?.items ?? []);
		const files = items
			.filter((it) => it.kind === 'file')
			.map((it) => it.getAsFile())
			.filter((f): f is File => f !== null);
		if (files.length === 0) return; // let normal text paste through
		event.preventDefault();
		const ok = validateFiles(files);
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
	role="group"
	aria-label="Compositor de mensajes"
	style={keyboardInset > 0 ? `padding-bottom: ${keyboardInset}px` : undefined}
	ondragenter={onDragEnter}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	{#if dragActive}
		<div class="drop-overlay" role="presentation">
			<div class="drop-message">Soltá para adjuntar</div>
		</div>
	{/if}

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

	<div class="composer">
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
		padding-bottom: env(safe-area-inset-bottom);
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--color-lime) 22%, white 60%);
		border: 2px dashed var(--color-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 5;
		pointer-events: none;
	}
	.drop-message {
		font-weight: 700;
		color: var(--color-ink);
	}

	.validation-msg {
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.4rem 1rem 0;
		font-size: 0.78rem;
		color: crimson;
	}

	.attachments {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.6rem 1rem 0;
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

	.composer {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		max-width: 46rem;
		margin: 0 auto;
		padding: 0.7rem 1rem;
	}

	.icon-btn {
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		min-width: 44px;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: white;
		border: none;
		cursor: pointer;
		color: var(--color-ink);
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

	.composer textarea {
		flex: 1;
		resize: none;
		max-height: 200px;
		min-height: 44px;
		padding: 0.65rem 0.85rem;
		border-radius: 1.3rem;
		border: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
		font-family: inherit;
		/* 16px minimum: iOS Safari zooms the page on focus for any input
		   font-size below this. */
		font-size: 16px;
		line-height: 1.4;
		background: white;
		color: var(--color-ink);
	}
	.composer textarea:focus-visible {
		outline: 2px solid var(--color-ink);
		outline-offset: 1px;
	}

	.send-btn {
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
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
		.composer {
			padding: 0.6rem 0.75rem;
		}
	}
</style>
