<script lang="ts">
	/**
	 * The chat panel's orchestrator (Lane B6) — everything that used to live
	 * directly in `routes/admin/+page.svelte`'s chat screen, extracted so that
	 * file stays focused on login/session plumbing. Owns the message list,
	 * the SSE turn loop, tool-activity status, and the composer's attachment
	 * pipeline.
	 *
	 * `getAccessToken` / `authedFetch` are handed down from `+page.svelte`
	 * rather than reimplemented here — this component never touches
	 * `localStorage` or the refresh-token flow directly (see
	 * `oauth-client.ts`'s header for why that split matters).
	 */
	import { onMount } from 'svelte';
	import MessageList from './MessageList.svelte';
	import Composer from './Composer.svelte';
	import EmptyState from './EmptyState.svelte';
	import { streamChat, isAbortError } from './sse';
	import { toolActivityLabelFallback } from './tool-labels';
	import type { ChatBubble, ToolActivity, PendingAttachment } from './types';

	interface ContentBlock {
		type: string;
		text?: string;
		name?: string;
		id?: string;
		source?: { type: string; url?: string };
		tool_use_id?: string;
		is_error?: boolean;
		[key: string]: unknown;
	}
	interface StoredRow {
		id: string;
		role: 'user' | 'assistant';
		content: ContentBlock[];
		budgetBlocked: boolean;
		stopped: boolean;
		createdAt: string;
	}

	interface Props {
		getAccessToken: () => Promise<string | null>;
		authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
		onSessionExpired: () => void;
		onLogout: () => void;
	}
	let { getAccessToken, authedFetch, onSessionExpired, onLogout }: Props = $props();

	let bubbles = $state<ChatBubble[]>([]);
	let tools = $state<Record<string, ToolActivity>>({});
	let chatInput = $state('');
	let pendingAttachments = $state<PendingAttachment[]>([]);
	let sending = $state(false);
	let awaitingFirstToken = $state(false);
	let chatError = $state('');
	let liveAnnouncement = $state('');
	let updateTick = $state(0);
	let loadingHistory = $state(true);
	let confirmingReset = $state(false);
	let resettingConversation = $state(false);

	let conversationId: string | null = null;
	let currentAbort: AbortController | null = null;
	let liveBubbleId: string | null = null;
	let retryPayloads: Record<string, { text: string; files: File[] }> = {};
	let liveAnnounceTimer: ReturnType<typeof setTimeout> | null = null;

	function tempId(): string {
		return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	// `routes/api/chat/+server.ts` appends a synthetic text block per
	// attachment ("[Imagen adjunta por el usuario — YA subida...] key=... " —
	// key/url/width/height/ratio for the MODEL to reference) to every
	// attached-image user turn. That block is for Claude, not for the human
	// reading the thread — filtered out of the DISPLAYED text here only; the
	// stored row (and what's replayed to the model) is untouched.
	const ATTACHMENT_DESCRIPTOR_RE = /^\[Imagen adjunta por el usuario/;

	function blockFields(content: ContentBlock[]): { text: string; images: { url: string; alt: string }[]; toolUses: { id: string; name: string }[] } {
		const text = content
			.filter((b) => b.type === 'text' && typeof b.text === 'string' && !ATTACHMENT_DESCRIPTOR_RE.test(b.text as string))
			.map((b) => b.text as string)
			.join('\n\n');
		const images = content
			.filter((b) => b.type === 'image' && b.source?.type === 'url' && typeof b.source.url === 'string')
			.map((b) => ({ url: b.source!.url as string, alt: 'Imagen adjunta' }));
		const toolUses = content
			.filter((b) => b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string')
			.map((b) => ({ id: b.id as string, name: b.name as string }));
		return { text, images, toolUses };
	}

	function rowsToBubbles(rows: StoredRow[]): ChatBubble[] {
		const out: ChatBubble[] = [];
		const nextTools: Record<string, ToolActivity> = {};
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			// A row that's ONLY tool_result blocks is internal plumbing appended
			// by `agent.ts` after running a tool — never something a person
			// typed or said, so it's never its own bubble. Its content is used
			// here only to resolve the PRECEDING assistant row's tool status.
			if (row.role === 'user' && row.content.length > 0 && row.content.every((b) => b.type === 'tool_result')) {
				for (const b of row.content) {
					if (typeof b.tool_use_id === 'string' && nextTools[b.tool_use_id]) {
						nextTools[b.tool_use_id].status = b.is_error ? 'error' : 'done';
					}
				}
				continue;
			}
			const { text, images, toolUses } = blockFields(row.content);
			for (const t of toolUses) {
				nextTools[t.id] = { id: t.id, name: t.name, label: toolActivityLabelFallback(t.name), status: 'running' };
			}
			if (!text && images.length === 0 && toolUses.length === 0) continue;
			out.push({
				id: row.id,
				role: row.role,
				text,
				toolIds: toolUses.map((t) => t.id),
				images,
				budgetBlocked: row.budgetBlocked,
				stopped: row.stopped,
				createdAt: row.createdAt,
				streaming: false,
				pending: false,
				failed: false
			});
		}
		tools = { ...tools, ...nextTools };
		return out;
	}

	async function loadHistory(): Promise<void> {
		loadingHistory = true;
		try {
			const res = await authedFetch('/api/chat');
			if (!res.ok) return;
			const data = (await res.json()) as { conversation: { id: string } | null; messages: StoredRow[] };
			conversationId = data.conversation?.id ?? null;
			bubbles = rowsToBubbles(data.messages ?? []);
		} finally {
			loadingHistory = false;
		}
	}

	onMount(() => {
		void loadHistory();
	});

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				const comma = result.indexOf(',');
				resolve(comma >= 0 ? result.slice(comma + 1) : result);
			};
			reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
			reader.readAsDataURL(file);
		});
	}

	function ensureLiveBubble(): ChatBubble {
		if (liveBubbleId) {
			const existing = bubbles.find((b) => b.id === liveBubbleId);
			if (existing) return existing;
		}
		const b: ChatBubble = {
			id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			role: 'assistant',
			text: '',
			toolIds: [],
			images: [],
			budgetBlocked: false,
			stopped: false,
			createdAt: new Date().toISOString(),
			streaming: true,
			pending: false,
			failed: false
		};
		liveBubbleId = b.id;
		bubbles = [...bubbles, b];
		return b;
	}

	function updateLiveBubble(mutate: (b: ChatBubble) => void): void {
		const b = ensureLiveBubble();
		mutate(b);
		bubbles = bubbles.map((x) => (x.id === b.id ? b : x));
		updateTick++;
	}

	function scheduleLiveAnnouncement(text: string): void {
		// Throttled: a screen reader announcing a `polite` live region on
		// every single token would be unusable. Updated at most every ~900ms
		// while streaming, plus once more, immediately, when the turn ends
		// (see the `done`/`stopped` handling below) so the final text is
		// always announced even if the throttle window hasn't elapsed.
		if (liveAnnounceTimer) return;
		liveAnnounceTimer = setTimeout(() => {
			liveAnnounceTimer = null;
			liveAnnouncement = text;
		}, 900);
	}

	function finalizeLiveBubble(row: { id: string; content: ContentBlock[]; budgetBlocked: boolean; stopped: boolean; createdAt: string }): void {
		const { text, images, toolUses } = blockFields(row.content);
		for (const t of toolUses) {
			if (!tools[t.id]) tools = { ...tools, [t.id]: { id: t.id, name: t.name, label: toolActivityLabelFallback(t.name), status: 'running' } };
		}
		const b = ensureLiveBubble();
		const merged: ChatBubble = {
			...b,
			id: row.id,
			text: text || b.text,
			images: images.length > 0 ? images : b.images,
			toolIds: [...new Set([...b.toolIds, ...toolUses.map((t) => t.id)])],
			budgetBlocked: row.budgetBlocked,
			stopped: row.stopped,
			createdAt: row.createdAt,
			streaming: false
		};
		bubbles = bubbles.map((x) => (x.id === b.id ? merged : x));
		liveBubbleId = null;
	}

	function resetLiveAnnounceTimer(): void {
		if (liveAnnounceTimer) {
			clearTimeout(liveAnnounceTimer);
			liveAnnounceTimer = null;
		}
	}

	async function runTurn(text: string, attachmentFiles: File[]): Promise<void> {
		const userTempId = tempId();
		retryPayloads[userTempId] = { text, files: attachmentFiles };

		const previewImages = pendingAttachments
			.filter((a) => a.previewUrl)
			.map((a) => ({ url: a.previewUrl as string, alt: a.file.name }));

		bubbles = [
			...bubbles,
			{
				id: userTempId,
				role: 'user',
				text,
				toolIds: [],
				images: previewImages,
				budgetBlocked: false,
				stopped: false,
				createdAt: new Date().toISOString(),
				streaming: false,
				pending: true,
				failed: false
			}
		];

		sending = true;
		awaitingFirstToken = true;
		chatError = '';
		liveBubbleId = null;
		const abort = new AbortController();
		currentAbort = abort;
		let userConfirmed = false;

		try {
			const token = await getAccessToken();
			if (!token) {
				onSessionExpired();
				return;
			}

			const attachmentsPayload = await Promise.all(
				attachmentFiles.map(async (file, i) => {
					const match = pendingAttachments[i];
					if (match) match.status = 'uploading';
					pendingAttachments = [...pendingAttachments];
					return {
						filename: file.name,
						mime: file.type || 'application/octet-stream',
						dataBase64: await fileToBase64(file)
					};
				})
			);

			for await (const { event, data } of streamChat({
				token,
				body: { conversationId, message: text, attachments: attachmentsPayload },
				signal: abort.signal
			})) {
				const d = data as Record<string, unknown>;
				switch (event) {
					case 'attachments':
						pendingAttachments = pendingAttachments.map((a) => ({ ...a, status: 'done' as const }));
						break;
					case 'user_message': {
						userConfirmed = true;
						const row = (d.row as StoredRow) ?? null;
						if (row) {
							const { text: t, images } = blockFields(row.content);
							bubbles = bubbles.map((b) =>
								b.id === userTempId
									? { ...b, id: row.id, text: t || b.text, images: images.length > 0 ? images : b.images, pending: false, createdAt: row.createdAt }
									: b
							);
						}
						break;
					}
					case 'text_delta': {
						awaitingFirstToken = false;
						const chunk = (d.text as string) ?? '';
						updateLiveBubble((b) => (b.text += chunk));
						scheduleLiveAnnouncement(ensureCurrentLiveText());
						break;
					}
					case 'tool_start': {
						awaitingFirstToken = false;
						const id = d.id as string;
						const name = d.name as string;
						const label = (d.label as string) ?? toolActivityLabelFallback(name);
						tools = { ...tools, [id]: { id, name, label, status: 'running' } };
						updateLiveBubble((b) => {
							if (!b.toolIds.includes(id)) b.toolIds = [...b.toolIds, id];
						});
						break;
					}
					case 'tool_result': {
						const id = d.id as string;
						const isError = Boolean(d.isError);
						if (tools[id]) {
							tools = { ...tools, [id]: { ...tools[id], status: isError ? 'error' : 'done' } };
						}
						updateTick++;
						break;
					}
					case 'assistant_message': {
						const row = d.row as { id: string; content: ContentBlock[]; budgetBlocked: boolean; stopped: boolean; createdAt: string };
						finalizeLiveBubble(row);
						break;
					}
					case 'stopped': {
						const row = d.row as { id: string; content: ContentBlock[]; budgetBlocked: boolean; stopped: boolean; createdAt: string };
						finalizeLiveBubble(row);
						break;
					}
					case 'done': {
						resetLiveAnnounceTimer();
						liveAnnouncement = (d.assistantText as string) || liveAnnouncement;
						break;
					}
					case 'error': {
						chatError = (d.error_description as string) ?? 'Ocurrió un error inesperado.';
						break;
					}
				}
			}
		} catch (err) {
			if (isAbortError(err)) {
				// Stop already finalized the UI (see `stopGeneration` below) —
				// nothing more to do here.
			} else {
				const message = err instanceof Error ? err.message : 'No se pudo enviar el mensaje.';
				if (!userConfirmed) {
					bubbles = bubbles.map((b) => (b.id === userTempId ? { ...b, pending: false, failed: true } : b));
				}
				chatError = message;
				// Drop an unfinalized live bubble — it was never confirmed by the
				// server, so nothing was actually persisted for it.
				if (liveBubbleId) {
					bubbles = bubbles.filter((b) => b.id !== liveBubbleId);
					liveBubbleId = null;
				}
			}
		} finally {
			sending = false;
			awaitingFirstToken = false;
			currentAbort = null;
			resetLiveAnnounceTimer();
			if (liveBubbleId) {
				// Belt-and-suspenders: make sure nothing is left permanently
				// "streaming" if the loop ended without an explicit finalize.
				bubbles = bubbles.map((b) => (b.id === liveBubbleId ? { ...b, streaming: false } : b));
				liveBubbleId = null;
			}
		}
	}

	function ensureCurrentLiveText(): string {
		const b = liveBubbleId ? bubbles.find((x) => x.id === liveBubbleId) : undefined;
		return b?.text ?? '';
	}

	function stopGeneration(): void {
		if (!currentAbort) return;
		if (liveBubbleId) {
			bubbles = bubbles.map((b) => (b.id === liveBubbleId ? { ...b, streaming: false, stopped: true } : b));
		}
		sending = false;
		awaitingFirstToken = false;
		currentAbort.abort();
		currentAbort = null;
	}

	async function handleSend(): Promise<void> {
		if (sending) return;
		const text = chatInput.trim();
		const files = pendingAttachments.map((a) => a.file);
		if (!text && files.length === 0) return;
		chatInput = '';
		const attachmentsSnapshot = pendingAttachments;
		pendingAttachments = [];
		await runTurn(text, files);
		for (const a of attachmentsSnapshot) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
	}

	function handleRetry(bubble: ChatBubble): void {
		const payload = retryPayloads[bubble.id];
		if (!payload) return;
		bubbles = bubbles.filter((b) => b.id !== bubble.id);
		delete retryPayloads[bubble.id];
		void runTurn(payload.text, payload.files);
	}

	function handlePickSuggestion(text: string): void {
		chatInput = text;
	}

	function onFilesAdded(files: File[]): void {
		const added: PendingAttachment[] = files.map((file) => ({
			id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			file,
			previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
			status: 'ready',
			errorMessage: null
		}));
		pendingAttachments = [...pendingAttachments, ...added];
	}

	function onRemoveAttachment(id: string): void {
		const target = pendingAttachments.find((a) => a.id === id);
		if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
		pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
	}

	function askResetConversation(): void {
		confirmingReset = true;
	}
	function cancelResetConversation(): void {
		confirmingReset = false;
	}
	async function confirmResetConversation(): Promise<void> {
		if (resettingConversation) return;
		resettingConversation = true;
		chatError = '';
		try {
			const res = await authedFetch('/api/chat', { method: 'DELETE' });
			if (!res.ok) throw new Error('No se pudo borrar la conversación.');
			bubbles = [];
			tools = {};
			conversationId = null;
		} catch (err) {
			chatError = err instanceof Error ? err.message : 'Error desconocido.';
		} finally {
			resettingConversation = false;
			confirmingReset = false;
		}
	}
</script>

<div class="chat-shell">
	<div class="chat-topbar">
		<div class="chat-topbar-title">
			<span class="brand">Moco</span>
			<span class="divider">·</span>
			<span>Panel</span>
		</div>
		<div class="chat-topbar-actions">
			{#if confirmingReset}
				<span class="confirm-text">¿Borrar toda la conversación?</span>
				<button type="button" class="ghost" onclick={cancelResetConversation} disabled={resettingConversation}>Cancelar</button>
				<button type="button" class="danger" onclick={confirmResetConversation} disabled={resettingConversation}>
					{resettingConversation ? 'Borrando…' : 'Sí, borrar'}
				</button>
			{:else}
				<button type="button" class="ghost" onclick={askResetConversation} disabled={bubbles.length === 0}>Borrar conversación</button>
			{/if}
			<button type="button" class="ghost" onclick={onLogout}>Cerrar sesión</button>
		</div>
	</div>

	<div class="chat-body">
		{#if loadingHistory}
			<div class="loading-fill"><p>Cargando conversación…</p></div>
		{:else if bubbles.length === 0}
			<EmptyState onPick={handlePickSuggestion} />
		{:else}
			<MessageList {bubbles} {tools} showTyping={awaitingFirstToken} {liveAnnouncement} {updateTick} onRetry={handleRetry} />
		{/if}
	</div>

	{#if chatError}
		<div class="error-box" role="alert">{chatError}</div>
	{/if}

	<Composer
		bind:value={chatInput}
		attachments={pendingAttachments}
		{sending}
		onSend={handleSend}
		onStop={stopGeneration}
		{onFilesAdded}
		{onRemoveAttachment}
	/>
</div>

<style>
	.chat-shell {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.chat-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.85rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-ink) 12%, transparent);
		background: var(--color-cream-dark, #e8e2d2);
	}
	.chat-topbar-title {
		font-family: var(--font-display);
		font-weight: 700;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.divider {
		opacity: 0.4;
	}
	.chat-topbar-actions {
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
		min-height: 44px;
	}
	.ghost:disabled {
		opacity: 0.45;
	}
	.danger {
		background: crimson;
		color: white;
		border: 1px solid crimson;
		border-radius: 0.5rem;
		padding: 0.4rem 0.7rem;
		font-size: 0.8rem;
		min-height: 44px;
	}
	.confirm-text {
		font-size: 0.78rem;
		color: var(--color-muted, #666);
	}

	.chat-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
	}
	.loading-fill {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-muted, #666);
	}

	.error-box {
		max-width: 46rem;
		margin: 0 auto;
		width: 100%;
		box-sizing: border-box;
		background: color-mix(in srgb, crimson 10%, transparent);
		border: 1px solid crimson;
		border-radius: 0.5rem;
		padding: 0.6rem 0.9rem;
		font-size: 0.85rem;
	}
</style>
