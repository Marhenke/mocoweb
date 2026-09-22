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
	import PreviewOverlay from './PreviewOverlay.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { validateAttachmentFiles } from './attachment-validation';
	import type { ChatBubble, ToolActivity, PendingAttachment, ChangeCard } from './types';

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
		changeCard: ChangeCard | null;
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
	let confirmingLogout = $state(false);
	// Lane B7 — preview-approval state. `cardBusyId` is the bubble id whose
	// Aprobar/Descartar/Deshacer is currently in flight (disables that
	// card's buttons only, not the whole chat). `previewBubbleId`/
	// `previewCard` drive the full-screen overlay.
	let cardBusyId = $state<string | null>(null);
	let previewBubbleId = $state<string | null>(null);
	let previewCard = $state<ChangeCard | null>(null);
	// Lane B7 — page-wide drag-and-drop (moved here from `Composer.svelte`;
	// see that component's header). `pageDragDepth` is a plain counter, not
	// `$state`, because `dragenter`/`dragleave` fire once per DOM boundary
	// the pointer crosses (they bubble like ordinary events, unlike
	// mouseenter/mouseleave) — only `pageDragActive` (derived from the
	// counter reaching/leaving zero) needs to be reactive.
	let pageDragActive = $state(false);
	let pageDragDepth = 0;

	let conversationId: string | null = null;
	let currentAbort: AbortController | null = null;
	let liveBubbleId: string | null = null;
	let retryPayloads: Record<string, { text: string; attachments: PendingAttachment[] }> = {};
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
			if (!text && images.length === 0 && toolUses.length === 0 && !row.changeCard) continue;
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
				failed: false,
				changeCard: row.changeCard ?? null
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
			failed: false,
			changeCard: null
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

	function finalizeLiveBubble(row: {
		id: string;
		content: ContentBlock[];
		budgetBlocked: boolean;
		stopped: boolean;
		changeCard?: ChangeCard | null;
		createdAt: string;
	}): void {
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
			streaming: false,
			changeCard: row.changeCard ?? b.changeCard
		};
		bubbles = bubbles.map((x) => (x.id === b.id ? merged : x));
		liveBubbleId = null;
	}

	/** Lane B7 — the `change_card` SSE event: relocates the card to `row`'s bubble (creating it if the turn produced no text, which shouldn't normally happen but is handled defensively) and clears it off whatever bubble previously showed it, if that bubble is currently in view. */
	function applyChangeCardEvent(row: StoredRow, previousCardMessageId: string | null): void {
		let found = false;
		bubbles = bubbles.map((b) => {
			if (previousCardMessageId && b.id === previousCardMessageId) return { ...b, changeCard: null };
			if (b.id === row.id) {
				found = true;
				return { ...b, changeCard: row.changeCard };
			}
			return b;
		});
		if (!found) {
			// The row's own bubble doesn't exist yet in this session's list
			// (shouldn't happen — `assistant_message`/`stopped` always fires
			// first — but never silently drop the card over ordering).
			const { text, images } = blockFields(row.content);
			bubbles = [
				...bubbles,
				{
					id: row.id,
					role: 'assistant',
					text,
					toolIds: [],
					images,
					budgetBlocked: row.budgetBlocked,
					stopped: row.stopped,
					createdAt: row.createdAt,
					streaming: false,
					pending: false,
					failed: false,
					changeCard: row.changeCard
				}
			];
		}
		// Keep the preview overlay (if open) showing the freshest card data.
		if (previewBubbleId === row.id) previewCard = row.changeCard;
	}

	function resetLiveAnnounceTimer(): void {
		if (liveAnnounceTimer) {
			clearTimeout(liveAnnounceTimer);
			liveAnnounceTimer = null;
		}
	}

	// Lane B7 fix: this used to read `pendingAttachments` (component-level
	// state) directly for the optimistic preview thumbnail and the
	// per-file "uploading" status — but every caller already clears
	// `pendingAttachments = []` BEFORE calling this function (so the
	// composer visually empties immediately on send), so both reads always
	// saw an empty array. The sent message showed no thumbnail at all in
	// the optimistic bubble, and — because the same broken read also fed
	// what got persisted to `retryPayloads`/shown after the `user_message`
	// SSE event in the *usual* case still worked (that path re-derives
	// images from the server's own row), the bug was easy to miss outside
	// of the split-second before the server confirms — but a slow
	// connection, or reading the code, made it obvious. Fix: the caller
	// hands over its own snapshot of the attachments (taken before
	// clearing `pendingAttachments`) instead of this function reading
	// shared state that's already moved on.
	async function runTurn(text: string, attachments: PendingAttachment[]): Promise<void> {
		const userTempId = tempId();
		retryPayloads[userTempId] = { text, attachments };

		const previewImages = attachments
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
				failed: false,
				changeCard: null
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
				attachments.map(async (a) => {
					// Mutating the snapshot object directly (not the — already
					// cleared — `pendingAttachments` state) is enough: nothing else
					// reads this attachment's `status` after send, this is purely
					// informational for anyone inspecting the snapshot mid-flight.
					a.status = 'uploading';
					return {
						filename: a.file.name,
						mime: a.file.type || 'application/octet-stream',
						dataBase64: await fileToBase64(a.file)
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
					case 'change_card': {
						const row = d.row as StoredRow;
						const previousCardMessageId = (d.previousCardMessageId as string | null) ?? null;
						applyChangeCardEvent(row, previousCardMessageId);
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
		if (!text && pendingAttachments.length === 0) return;
		chatInput = '';
		const attachmentsSnapshot = pendingAttachments;
		pendingAttachments = [];
		await runTurn(text, attachmentsSnapshot);
		for (const a of attachmentsSnapshot) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
	}

	function handleRetry(bubble: ChatBubble): void {
		const payload = retryPayloads[bubble.id];
		if (!payload) return;
		bubbles = bubbles.filter((b) => b.id !== bubble.id);
		delete retryPayloads[bubble.id];
		// The snapshot's preview URLs were already revoked after the failed
		// send (see `handleSend`) — regenerate fresh ones from the still-valid
		// `File` objects so the retried optimistic bubble shows a thumbnail too.
		const attachments = payload.attachments.map((a) => ({
			...a,
			previewUrl: a.file.type.startsWith('image/') ? URL.createObjectURL(a.file) : null,
			status: 'ready' as const
		}));
		void runTurn(payload.text, attachments);
	}

	// Lane B7: a suggestion chip sends immediately (per the brief) rather than
	// just filling the composer for the owner to press send themselves —
	// tapping a suggestion IS the action, not a shortcut to typing it.
	function handlePickSuggestion(text: string): void {
		if (sending) return;
		void runTurn(text, []);
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

	// ── Lane B7: page-wide drop ───────────────────────────────────────────
	// `dragover` is ALWAYS prevented, regardless of what's being dragged —
	// that's the one call that stops the browser from navigating to a
	// dropped file (per the brief: "dropping outside the composer must
	// never make the browser navigate to the file"). The overlay/attach
	// behavior below it is additionally gated on the drag actually carrying
	// files, so dragging plain text around the page is unaffected.
	function isFileDrag(event: DragEvent): boolean {
		return !!event.dataTransfer?.types.includes('Files');
	}
	function onWindowDragEnter(event: DragEvent): void {
		event.preventDefault();
		if (!isFileDrag(event)) return;
		pageDragDepth++;
		pageDragActive = true;
	}
	function onWindowDragOver(event: DragEvent): void {
		event.preventDefault();
	}
	function onWindowDragLeave(event: DragEvent): void {
		event.preventDefault();
		pageDragDepth = Math.max(0, pageDragDepth - 1);
		if (pageDragDepth === 0) pageDragActive = false;
	}
	function onWindowDrop(event: DragEvent): void {
		event.preventDefault();
		pageDragDepth = 0;
		pageDragActive = false;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length === 0) return;
		const { ok, message } = validateAttachmentFiles(files);
		if (message) chatError = message;
		if (ok.length > 0) onFilesAdded(ok);
	}

	// ── Lane B7: preview-approval actions ────────────────────────────────────
	// Each endpoint acts on the conversation's CURRENT pending set (approve/
	// discard) or a specific card by message id (undo — see
	// `routes/api/chat/undo`'s header for why undo needs the id explicitly).
	// All three return `{ ok, card, messageId, error_description? }`; the
	// returned card always replaces whatever that bubble was showing, so the
	// UI never has to guess the new state itself.
	function applyCardResult(fallbackBubbleId: string, data: Record<string, unknown>): void {
		const messageId = (data.messageId as string | undefined) ?? fallbackBubbleId;
		const card = (data.card as ChangeCard | null | undefined) ?? null;
		bubbles = bubbles.map((b) => (b.id === messageId ? { ...b, changeCard: card } : b));
		if (previewBubbleId === messageId) {
			if (card && (card.status === 'pending' || card.status === 'published')) {
				// Keep the overlay open: on Aprobar it now shows the page that's
				// actually live (worth confirming at a glance), just without the
				// action bar (see `PreviewOverlay.svelte` — only 'pending' gets one).
				previewCard = card;
			} else {
				// Descartar/Deshacer: nothing left to review, close it.
				previewBubbleId = null;
				previewCard = null;
			}
		}
		const errors = data.errors as string[] | undefined;
		if (data.ok === false) {
			chatError =
				(data.error_description as string | undefined) ??
				(errors && errors.length > 0
					? `No se pudo completar del todo: ${errors[0]}`
					: 'No se pudo completar la acción. Probá de nuevo.');
		} else {
			chatError = '';
		}
	}

	async function postCardAction(path: string, bubbleId: string, body?: unknown): Promise<void> {
		if (cardBusyId) return;
		cardBusyId = bubbleId;
		try {
			const res = await authedFetch(path, {
				method: 'POST',
				headers: body ? { 'content-type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
			let data: Record<string, unknown>;
			try {
				data = (await res.json()) as Record<string, unknown>;
			} catch {
				data = { ok: false, error_description: 'No se pudo leer la respuesta del servidor. Probá de nuevo.' };
			}
			if (!res.ok && !('card' in data)) {
				chatError =
					(data.error_description as string | undefined) ?? 'No se pudo completar la acción. Probá de nuevo.';
				return;
			}
			applyCardResult(bubbleId, data);
		} catch {
			chatError = 'No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.';
		} finally {
			cardBusyId = null;
		}
	}

	function handleCardApprove(bubble: ChatBubble): void {
		void postCardAction('/api/chat/approve', bubble.id);
	}
	function handleCardDiscard(bubble: ChatBubble): void {
		void postCardAction('/api/chat/discard', bubble.id);
	}
	function handleCardUndo(bubble: ChatBubble): void {
		void postCardAction('/api/chat/undo', bubble.id, { messageId: bubble.id });
	}
	function handleCardPreview(bubble: ChatBubble): void {
		if (!bubble.changeCard) return;
		previewBubbleId = bubble.id;
		previewCard = bubble.changeCard;
	}
	function closePreview(): void {
		previewBubbleId = null;
		previewCard = null;
	}
	function handlePreviewApprove(): void {
		if (previewBubbleId) handleCardApprove({ id: previewBubbleId } as ChatBubble);
	}
	function handlePreviewDiscard(): void {
		if (previewBubbleId) handleCardDiscard({ id: previewBubbleId } as ChatBubble);
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

	function askLogout(): void {
		confirmingLogout = true;
	}
	function cancelLogout(): void {
		confirmingLogout = false;
	}
	function confirmLogout(): void {
		confirmingLogout = false;
		onLogout();
	}
</script>

<svelte:window
	ondragenter={onWindowDragEnter}
	ondragover={onWindowDragOver}
	ondragleave={onWindowDragLeave}
	ondrop={onWindowDrop}
/>

<div class="chat-shell">
	{#if pageDragActive}
		<div class="page-drop-overlay" role="presentation">
			<div class="page-drop-message">Soltá la imagen o el video para adjuntarlo</div>
		</div>
	{/if}

	<div class="chat-topbar">
		<div class="chat-topbar-title">
			<span class="brand">Moco</span>
			<span class="divider">·</span>
			<span>Panel</span>
		</div>
		<div class="chat-topbar-actions">
			<button type="button" class="ghost" onclick={askResetConversation} disabled={bubbles.length === 0}>Borrar conversación</button>
			<button type="button" class="ghost" onclick={askLogout}>Cerrar sesión</button>
		</div>
	</div>

	<div class="chat-body">
		{#if loadingHistory}
			<div class="loading-fill"><p>Cargando conversación…</p></div>
		{:else if bubbles.length === 0}
			<EmptyState onPick={handlePickSuggestion} />
		{:else}
			<MessageList
				{bubbles}
				{tools}
				showTyping={awaitingFirstToken}
				{liveAnnouncement}
				{updateTick}
				onRetry={handleRetry}
				{cardBusyId}
				onCardPreview={handleCardPreview}
				onCardApprove={handleCardApprove}
				onCardDiscard={handleCardDiscard}
				onCardUndo={handleCardUndo}
			/>
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

{#if previewCard}
	<PreviewOverlay
		card={previewCard}
		busy={cardBusyId === previewBubbleId}
		onApprove={handlePreviewApprove}
		onDiscard={handlePreviewDiscard}
		onClose={closePreview}
	/>
{/if}

{#if confirmingReset}
	<ConfirmDialog
		title="Borrar conversación"
		message="Se va a borrar toda la conversación con este chat. Esta acción no se puede deshacer."
		confirmLabel={resettingConversation ? 'Borrando…' : 'Sí, borrar'}
		danger
		busy={resettingConversation}
		onConfirm={confirmResetConversation}
		onCancel={cancelResetConversation}
	/>
{/if}

{#if confirmingLogout}
	<ConfirmDialog
		title="Cerrar sesión"
		message="Vas a tener que volver a ingresar tu clave para entrar de nuevo al panel."
		confirmLabel="Cerrar sesión"
		onConfirm={confirmLogout}
		onCancel={cancelLogout}
	/>
{/if}

<style>
	.chat-shell {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		position: relative;
	}

	.page-drop-overlay {
		position: absolute;
		inset: 0;
		z-index: 50;
		background: color-mix(in srgb, var(--color-lime) 22%, white 60%);
		border: 3px dashed var(--color-ink);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.page-drop-message {
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--color-ink);
		background: white;
		padding: 0.7rem 1.2rem;
		border-radius: 0.8rem;
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
