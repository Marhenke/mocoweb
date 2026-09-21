<script lang="ts">
	/**
	 * The admin chat panel (Lane B5). Two screens in one component: a login
	 * form (owner key only — no scope choice; the panel is the site's fixed
	 * internal OAuth client and the server grants it full access
	 * automatically, see `auth/internal-client.ts`) run through this site's
	 * own OAuth authorization-code + PKCE flow (`$lib/admin/oauth-client.ts`),
	 * and, once authorized, a chat that talks to `/api/chat`. No cookie is
	 * ever involved; the access token lives only in this component's
	 * in-memory `tokens` state (see the file header of `oauth-client.ts` for
	 * why). There is exactly one conversation per site (see
	 * `chat/store.ts`'s `getOrCreateSingletonConversation`) — "Borrar
	 * conversación" clears it, there is no notion of switching between
	 * several.
	 */
	import { onMount } from 'svelte';
	import {
		loginWithOwnerKey,
		tryRefresh,
		clearSession,
		hasStoredRefreshToken,
		SessionExpiredError,
		type TokenSet
	} from '$lib/admin/oauth-client';

	interface ContentBlock {
		type: string;
		text?: string;
		name?: string;
		[key: string]: unknown;
	}
	interface StoredRow {
		id: string;
		role: 'user' | 'assistant';
		content: ContentBlock[];
		budgetBlocked: boolean;
		createdAt: string;
	}
	interface DisplayItem {
		id: string;
		role: 'user' | 'assistant';
		text: string;
		toolNames: string[];
		budgetBlocked: boolean;
	}
	interface PendingFile {
		file: File;
		previewUrl: string | null;
	}

	let tokens = $state<TokenSet | null>(null);
	let bootLoading = $state(true);

	// Login form state — no scope choice anymore: the panel always logs in
	// as the fixed internal client, which the server grants full access to
	// automatically (see oauth-client.ts / auth/internal-client.ts).
	let ownerKeyInput = $state('');
	let loginError = $state('');
	let loggingIn = $state(false);

	// Chat state — there is exactly one conversation for this site (see
	// chat/store.ts's getOrCreateSingletonConversation); `conversationId` is
	// only kept to pass along to /api/chat, never shown or chosen in the UI.
	let conversationId = $state<string | null>(null);
	let items = $state<DisplayItem[]>([]);
	let chatInput = $state('');
	let sending = $state(false);
	let chatError = $state('');
	let pendingFiles = $state<PendingFile[]>([]);
	let confirmingReset = $state(false);
	let resettingConversation = $state(false);
	let scrollAnchor: HTMLDivElement | undefined = $state();

	function toDisplayItems(rows: StoredRow[]): DisplayItem[] {
		const out: DisplayItem[] = [];
		for (const row of rows) {
			const blocks = row.content ?? [];
			// Rows that are only a tool_result (the plumbing `agent.ts` appends
			// after running a tool) are internal — not something a person typed
			// or said, so they're not rendered as a chat bubble.
			if (row.role === 'user' && blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) continue;
			const text = blocks
				.filter((b) => b.type === 'text' && typeof b.text === 'string')
				.map((b) => b.text as string)
				.join('\n\n');
			const toolNames = blocks.filter((b) => b.type === 'tool_use').map((b) => String(b.name ?? ''));
			if (!text && toolNames.length === 0) continue;
			out.push({ id: row.id, role: row.role, text, toolNames, budgetBlocked: row.budgetBlocked });
		}
		return out;
	}

	async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
		if (!tokens) throw new SessionExpiredError();
		if (Date.now() > tokens.expiresAt - 30_000) {
			const refreshed = await tryRefresh();
			if (!refreshed) {
				tokens = null;
				throw new SessionExpiredError();
			}
			tokens = refreshed;
		}
		const withAuth = (t: TokenSet) => ({
			...init,
			headers: { ...(init.headers ?? {}), authorization: `Bearer ${t.accessToken}` }
		});
		let res = await fetch(path, withAuth(tokens));
		if (res.status === 401) {
			const refreshed = await tryRefresh();
			if (!refreshed) {
				tokens = null;
				throw new SessionExpiredError();
			}
			tokens = refreshed;
			res = await fetch(path, withAuth(tokens));
		}
		return res;
	}

	/** Loads the site's one conversation, if it exists yet. */
	async function loadConversation(): Promise<void> {
		const res = await authedFetch('/api/chat');
		if (!res.ok) return;
		const data = (await res.json()) as {
			conversation: { id: string } | null;
			messages: StoredRow[];
		};
		conversationId = data.conversation?.id ?? null;
		items = toDisplayItems(data.messages ?? []);
		queueScroll();
	}

	function queueScroll(): void {
		requestAnimationFrame(() => scrollAnchor?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
	}

	onMount(async () => {
		if (hasStoredRefreshToken()) {
			try {
				const refreshed = await tryRefresh();
				if (refreshed) {
					tokens = refreshed;
					await loadConversation();
				}
			} catch {
				// Silent — the login form is the fallback, no need to surface this.
			}
		}
		bootLoading = false;
	});

	async function handleLogin(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		loginError = '';
		loggingIn = true;
		try {
			tokens = await loginWithOwnerKey(ownerKeyInput);
			ownerKeyInput = '';
			await loadConversation();
		} catch (err) {
			loginError = err instanceof Error ? err.message : 'Error desconocido.';
		} finally {
			loggingIn = false;
		}
	}

	function logout(): void {
		clearSession();
		tokens = null;
		items = [];
		conversationId = null;
		confirmingReset = false;
	}

	function askResetConversation(): void {
		confirmingReset = true;
	}

	function cancelResetConversation(): void {
		confirmingReset = false;
	}

	/** "Borrar conversación": deletes the site's one conversation (and every message in it) after an explicit confirmation step. */
	async function confirmResetConversation(): Promise<void> {
		if (resettingConversation) return;
		resettingConversation = true;
		chatError = '';
		try {
			const res = await authedFetch('/api/chat', { method: 'DELETE' });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error_description?: string };
				throw new Error(body.error_description ?? 'No se pudo borrar la conversación.');
			}
			conversationId = null;
			items = [];
		} catch (err) {
			if (err instanceof SessionExpiredError) tokens = null;
			chatError = err instanceof Error ? err.message : 'Error desconocido.';
		} finally {
			resettingConversation = false;
			confirmingReset = false;
		}
	}

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// result is a data: URL ("data:image/png;base64,AAAA..."); we only want the payload.
				const comma = result.indexOf(',');
				resolve(comma >= 0 ? result.slice(comma + 1) : result);
			};
			reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
			reader.readAsDataURL(file);
		});
	}

	function onFilesChosen(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		for (const file of files) {
			pendingFiles.push({ file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
		}
		pendingFiles = pendingFiles;
		input.value = '';
	}

	function removePendingFile(index: number): void {
		const [removed] = pendingFiles.splice(index, 1);
		if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
		pendingFiles = pendingFiles;
	}

	async function sendMessage(): Promise<void> {
		if (sending) return;
		const text = chatInput.trim();
		if (!text && pendingFiles.length === 0) return;
		sending = true;
		chatError = '';
		try {
			const attachments = await Promise.all(
				pendingFiles.map(async (p) => ({
					filename: p.file.name,
					mime: p.file.type || 'application/octet-stream',
					dataBase64: await fileToBase64(p.file)
				}))
			);
			const res = await authedFetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ conversationId, message: text, attachments })
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error_description?: string };
				throw new Error(body.error_description ?? 'No se pudo enviar el mensaje.');
			}
			const data = (await res.json()) as { conversationId: string };
			conversationId = data.conversationId;
			chatInput = '';
			for (const p of pendingFiles) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
			pendingFiles = [];
			await loadConversation();
		} catch (err) {
			if (err instanceof SessionExpiredError) tokens = null;
			chatError = err instanceof Error ? err.message : 'Error desconocido.';
		} finally {
			sending = false;
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void sendMessage();
		}
	}
</script>

<svelte:head>
	<title>Panel — Moco</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="admin-shell">
	{#if bootLoading}
		<div class="center-fill">
			<p>Cargando…</p>
		</div>
	{:else if !tokens}
		<div class="center-fill">
			<form class="login-card" onsubmit={handleLogin}>
				<h1>Panel de Moco</h1>
				<p class="subtitle">Ingresá la clave del sitio para chatear con tu web. Tenés acceso completo: leer, escribir, publicar y ver los mensajes de contacto.</p>
				{#if loginError}
					<div class="error-box">{loginError}</div>
				{/if}
				<label class="field">
					<span>Clave del sitio</span>
					<input
						type="password"
						autocomplete="off"
						bind:value={ownerKeyInput}
						required
						disabled={loggingIn}
					/>
				</label>
				<button type="submit" disabled={loggingIn}>{loggingIn ? 'Ingresando…' : 'Ingresar'}</button>
			</form>
		</div>
	{:else}
		<header class="topbar">
			<div class="topbar-title">
				<span class="brand">Moco</span>
				<span class="divider">·</span>
				<span>Panel</span>
			</div>
			<div class="topbar-actions">
				{#if confirmingReset}
					<span class="confirm-text">¿Borrar toda la conversación?</span>
					<button type="button" class="ghost" onclick={cancelResetConversation} disabled={resettingConversation}>Cancelar</button>
					<button type="button" class="danger" onclick={confirmResetConversation} disabled={resettingConversation}>
						{resettingConversation ? 'Borrando…' : 'Sí, borrar'}
					</button>
				{:else}
					<button type="button" class="ghost" onclick={askResetConversation} disabled={items.length === 0}>Borrar conversación</button>
				{/if}
				<button type="button" class="ghost" onclick={logout}>Cerrar sesión</button>
			</div>
		</header>

		<div class="chat-area">
			{#if items.length === 0}
				<div class="empty-state">
					<p>Contame qué querés cambiar en el sitio, o adjuntá una imagen.</p>
				</div>
			{/if}
			{#each items as item (item.id)}
				<div class="bubble-row {item.role}">
					<div class="bubble {item.role}" class:budget={item.budgetBlocked}>
						{#each item.toolNames as name (name)}
							<div class="tool-note">🔧 usó la herramienta "{name}"</div>
						{/each}
						{#if item.text}
							<p class="bubble-text">{item.text}</p>
						{/if}
					</div>
				</div>
			{/each}
			<div bind:this={scrollAnchor}></div>
		</div>

		{#if chatError}
			<div class="error-box inline">{chatError}</div>
		{/if}

		{#if pendingFiles.length > 0}
			<div class="pending-files">
				{#each pendingFiles as pending, index (pending.file.name + index)}
					<div class="pending-file">
						{#if pending.previewUrl}
							<img src={pending.previewUrl} alt={pending.file.name} />
						{:else}
							<span class="pending-file-name">{pending.file.name}</span>
						{/if}
						<button type="button" onclick={() => removePendingFile(index)} aria-label="Quitar">×</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="composer">
			<label class="attach-button" aria-label="Adjuntar imagen">
				📎
				<input type="file" accept="image/*" multiple onchange={onFilesChosen} disabled={sending} />
			</label>
			<textarea
				bind:value={chatInput}
				onkeydown={handleKeydown}
				placeholder="Escribí tu mensaje…"
				rows="1"
				disabled={sending}
			></textarea>
			<button type="button" onclick={sendMessage} disabled={sending}>{sending ? '…' : 'Enviar'}</button>
		</div>
	{/if}
</div>

<style>
	.admin-shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--color-cream);
		color: var(--color-ink);
		font-family: var(--font-sans);
	}

	.center-fill {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}

	.login-card {
		width: 100%;
		max-width: 24rem;
		background: white;
		border-radius: 1rem;
		padding: 2rem 1.75rem;
		box-shadow: 0 1px 3px color-mix(in srgb, var(--color-ink) 12%, transparent);
	}

	.login-card h1 {
		font-family: var(--font-display);
		font-size: 1.5rem;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		color: var(--color-muted);
		margin: 0 0 1.25rem;
		font-size: 0.9rem;
	}

	.field {
		display: block;
		margin-bottom: 1rem;
		border: none;
		padding: 0;
	}

	.field span {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 0.35rem;
		padding: 0;
	}

	.field input[type='password'] {
		width: 100%;
		box-sizing: border-box;
		padding: 0.65rem 0.75rem;
		font-size: 1rem;
		border-radius: 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent);
	}

	.error-box {
		background: color-mix(in srgb, crimson 10%, transparent);
		border: 1px solid crimson;
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}
	.error-box.inline {
		margin: 0 1rem;
	}

	button {
		cursor: pointer;
		font-family: inherit;
	}

	.login-card button[type='submit'] {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		border: none;
		border-radius: 0.5rem;
		background: var(--color-lime);
		color: var(--color-ink);
	}
	.login-card button[type='submit']:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
		background: var(--color-cream-dark);
	}
	.topbar-title {
		font-family: var(--font-display);
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.divider {
		opacity: 0.4;
	}
	.topbar-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.ghost {
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent);
		border-radius: 0.5rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.8rem;
		color: var(--color-ink);
	}
	.ghost:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.danger {
		background: crimson;
		color: white;
		border: 1px solid crimson;
		border-radius: 0.5rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.8rem;
	}
	.danger:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.confirm-text {
		font-size: 0.78rem;
		color: var(--color-muted);
	}

	.chat-area {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted);
		text-align: center;
		padding: 2rem 1rem;
	}

	.bubble-row {
		display: flex;
	}
	.bubble-row.assistant {
		justify-content: flex-start;
	}
	.bubble-row.user {
		justify-content: flex-end;
	}

	.bubble {
		max-width: min(34rem, 85%);
		border-radius: 1rem;
		padding: 0.65rem 0.9rem;
		font-size: 0.95rem;
		line-height: 1.45;
	}
	.bubble.assistant {
		background: white;
		border-bottom-left-radius: 0.25rem;
	}
	.bubble.user {
		background: var(--color-lime);
		color: var(--color-ink);
		border-bottom-right-radius: 0.25rem;
	}
	.bubble.budget {
		background: color-mix(in srgb, orange 15%, white);
		border: 1px solid color-mix(in srgb, orange 40%, transparent);
	}

	.bubble-text {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.tool-note {
		font-size: 0.78rem;
		color: var(--color-muted);
		margin-bottom: 0.3rem;
	}

	.pending-files {
		display: flex;
		gap: 0.5rem;
		padding: 0 1rem 0.5rem;
		flex-wrap: wrap;
	}
	.pending-file {
		position: relative;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 0.5rem;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
	}
	.pending-file img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.pending-file-name {
		display: block;
		font-size: 0.6rem;
		padding: 0.3rem;
		word-break: break-all;
	}
	.pending-file button {
		position: absolute;
		top: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.6);
		color: white;
		border: none;
		width: 1.1rem;
		height: 1.1rem;
		line-height: 1;
		border-radius: 0 0 0 0.3rem;
	}

	.composer {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
		background: var(--color-cream-dark);
	}

	.attach-button {
		flex-shrink: 0;
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: white;
		cursor: pointer;
		font-size: 1.1rem;
	}
	.attach-button input {
		display: none;
	}

	.composer textarea {
		flex: 1;
		resize: none;
		max-height: 8rem;
		min-height: 2.5rem;
		padding: 0.6rem 0.8rem;
		border-radius: 1.2rem;
		border: 1px solid color-mix(in srgb, var(--color-ink) 20%, transparent);
		font-family: inherit;
		font-size: 0.95rem;
	}

	.composer button {
		flex-shrink: 0;
		padding: 0.6rem 1.1rem;
		border-radius: 1.2rem;
		border: none;
		background: var(--color-ink);
		color: var(--color-cream);
		font-weight: 600;
	}
	.composer button:disabled {
		opacity: 0.5;
	}

	@media (max-width: 30rem) {
		.login-card {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
