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
	import PendingChangeBar from './PendingChangeBar.svelte';
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
	// Lane B7, redesigned in Lane B8 — the site's ONE open change set, as a
	// persistent pinned bar (`PendingChangeBar.svelte`) — never attached to a
	// bubble/message anymore (see `pending-changes.ts`'s header on the
	// server). `openChange` is the single source of truth for what the bar
	// (and, when open, the full-screen overlay) shows; `actionBusy` disables
	// Aprobar/Descartar/Deshacer while one of those is in flight;
	// `previewOpen` toggles the full-screen overlay.
	let openChange = $state<ChangeCard | null>(null);
	let actionBusy = $state(false);
	let previewOpen = $state(false);
	// Lane B9 — the bar now clears the instant there's nothing open (see
	// `open-change-set.ts`'s header), so a successful Aprobar needs its OWN,
	// separate, brief confirmation — never the bar itself lingering. `null`
	// when nothing to show; dismisses itself on a short timeout, on the next
	// message send (`handleSend`), or the instant a NEW pending change
	// arrives (`pending_change` SSE case) — "no stacking, still exactly one
	// bar" from the brief applies here too: a confirmation and a real
	// pending-change bar never show at the same time.
	let approvalToast = $state(false);
	let approvalToastTimer: ReturnType<typeof setTimeout> | null = null;
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
					// Lane B8 — same rule as the live `tool_result` handler above: a
					// recovered tool error must never render as a failure, even when
					// rebuilding history after a reload.
					if (typeof b.tool_use_id === 'string' && nextTools[b.tool_use_id]) {
						nextTools[b.tool_use_id].status = 'done';
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
			const data = (await res.json()) as {
				conversation: { id: string } | null;
				messages: StoredRow[];
				pendingChange: ChangeCard | null;
			};
			conversationId = data.conversation?.id ?? null;
			bubbles = rowsToBubbles(data.messages ?? []);
			// Lane B8 — the persistent pinned bar survives a reload/re-login by
			// reading the conversation's own state, never a message row.
			openChange = data.pendingChange ?? null;
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

	function finalizeLiveBubble(row: {
		id: string;
		content: ContentBlock[];
		budgetBlocked: boolean;
		stopped: boolean;
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
						// Lane B8 — a tool call that fails and gets silently retried/
						// corrected by the agent must never look like a failure to the
						// owner (see the brief: "internal failures must never reach the
						// user"). This chip only ever shows work-in-progress → done,
						// regardless of `isError` — the server still knows the truth
						// (logged, and used to decide whether the TURN itself ends in
						// failure), but a single tool round failing is normal agent
						// self-correction, not something to alarm a non-technical owner
						// with. A turn that genuinely can't recover surfaces through the
						// separate `error` SSE event / `chatError` banner below, never
						// through this chip.
						const id = d.id as string;
						if (tools[id]) {
							// Lane B9 — `offerUndo` rides along on this same event (see
							// `agent.ts`'s `isUndoAvailable`): true only for a successful
							// `offer_undo_last_change` call that found something
							// undoable. Threaded onto the tool's own activity record so
							// `MessageBubble.svelte` can render a click-to-undo action
							// directly on the reply that offered it — the model never
							// runs the undo itself, only this flag exists so the OWNER
							// can.
							tools = { ...tools, [id]: { ...tools[id], status: 'done', offerUndo: (d.offerUndo as boolean) === true } };
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
					case 'pending_change': {
						// Lane B8 — no bubble/row involved: the persistent pinned bar
						// is the single source of truth, updated straight from the
						// event.
						openChange = (d.card as ChangeCard | null) ?? null;
						if (previewOpen) {
							// Keep the overlay (if open) showing the freshest card data.
							if (!openChange) previewOpen = false;
						}
						// Lane B9 — new prepared work replaces a still-showing
						// confirmation toast cleanly instead of stacking with it (the
						// brief: "still exactly one bar").
						if (openChange) dismissApprovalToast();
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
		// Lane B9 — "dismisses itself... when the owner sends the next
		// message" (the brief, verbatim) — the conversation continuing is
		// itself the signal that the confirmation has served its purpose.
		dismissApprovalToast();
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

	// ── Lane B7, redesigned in Lane B8: change-set actions ────────────────────
	// Each endpoint acts on the conversation's ONE open change set — never a
	// specific message anymore (see `routes/api/chat/{approve,discard,undo}`'s
	// headers). All three return `{ ok, card, errors?, error_description? }`;
	// the returned card always replaces `openChange` wholesale, so the UI
	// never has to guess the new state itself.
	function applyOpenChangeResult(data: Record<string, unknown>): void {
		openChange = (data.card as ChangeCard | null | undefined) ?? null;
		if (!openChange) previewOpen = false;
		// Lane B9 — the bar and the confirmation toast are mutually exclusive
		// (never stacked, per the brief) — any action that leaves real open
		// work behind (e.g. clicking Deshacer, which re-adds the entry to the
		// pending set) supersedes a still-showing toast from an earlier
		// Aprobar.
		if (openChange) dismissApprovalToast();
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

	async function postCardAction(path: string): Promise<boolean> {
		if (actionBusy) return false;
		actionBusy = true;
		try {
			const res = await authedFetch(path, { method: 'POST' });
			let data: Record<string, unknown>;
			try {
				data = (await res.json()) as Record<string, unknown>;
			} catch {
				data = { ok: false, error_description: 'No se pudo leer la respuesta del servidor. Probá de nuevo.' };
			}
			if (!res.ok && !('card' in data)) {
				chatError =
					(data.error_description as string | undefined) ?? 'No se pudo completar la acción. Probá de nuevo.';
				return false;
			}
			applyOpenChangeResult(data);
			return data.ok !== false;
		} catch {
			chatError = 'No se pudo conectar con el servidor. Revisá tu conexión y probá de nuevo.';
			return false;
		} finally {
			actionBusy = false;
		}
	}

	// Lane B9 — shows for a fixed, short window and clears itself; also
	// cleared early by `dismissApprovalToast` (next message sent, or a new
	// change replacing it — see the `pending_change` SSE case and
	// `handleSend`).
	function showApprovalToast(): void {
		approvalToast = true;
		if (approvalToastTimer) clearTimeout(approvalToastTimer);
		approvalToastTimer = setTimeout(() => {
			approvalToastTimer = null;
			approvalToast = false;
		}, 6000);
	}
	function dismissApprovalToast(): void {
		if (approvalToastTimer) {
			clearTimeout(approvalToastTimer);
			approvalToastTimer = null;
		}
		approvalToast = false;
	}

	async function handleCardApprove(): Promise<void> {
		// Lane B9 — the bar itself clears the instant the server confirms
		// (`postCardAction` → `applyOpenChangeResult` sets `openChange` to
		// whatever's left, null if nothing is), per the brief: Aprobar must
		// never leave the bar sitting there. The toast is a SEPARATE, brief,
		// dismissible stand-in for "yes, that worked, and here's Deshacer if
		// you want it" — shown only once nothing else is left open, so it
		// never appears alongside a still-pending remainder of a partial
		// failure (see `routes/api/chat/approve`'s header on partial
		// failure).
		const ok = await postCardAction('/api/chat/approve');
		if (ok && !openChange) showApprovalToast();
	}
	function handleCardDiscard(): void {
		dismissApprovalToast();
		void postCardAction('/api/chat/discard');
	}
	function handleCardUndo(): void {
		void postCardAction('/api/chat/undo');
	}

	// Lane B9 — the click behind the inline "Deshacer" the agent OFFERS (never
	// executes) when the owner asks in chat to undo the last approved change
	// (`offer_undo_last_change`, see `chat-only-tools.ts`). Reuses the exact
	// same `/api/chat/undo` endpoint the old persistent bar's Deshacer button
	// called — there is still only ONE way anything gets undone, this is
	// just a second place in the UI that can trigger it. On success the
	// returned card (now 'pending' again, ready for a fresh Aprobar) replaces
	// `openChange` exactly like every other card action; the offer itself is
	// cleared from `tools` so the button can't be clicked a second time for
	// something that no longer applies.
	async function handleInlineUndo(toolId: string): Promise<void> {
		const ok = await postCardAction('/api/chat/undo');
		if (ok) {
			dismissApprovalToast();
			if (tools[toolId]) tools = { ...tools, [toolId]: { ...tools[toolId], offerUndo: false } };
		}
	}

	function handleCardPreview(): void {
		if (!openChange) return;
		previewOpen = true;
	}
	function closePreview(): void {
		previewOpen = false;
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
			// "Borrar conversación" deletes the whole conversation row, which is
			// also where the open change set lives (see `pending-changes.ts`) —
			// clear it client-side too rather than leaving a stale bar up.
			openChange = null;
			previewOpen = false;
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
				onInlineUndo={handleInlineUndo}
				undoBusy={actionBusy}
			/>
		{/if}
	</div>

	{#if chatError}
		<div class="error-box" role="alert">{chatError}</div>
	{/if}

	<!--
		Lane B8, narrowed in Lane B9 — the persistent pinned bar: exactly one,
		never a message in the thread above, and for OPEN work only. Sits
		right above the composer so it's visible whenever there's something
		pending, on every screen size, and disappears the INSTANT `openChange`
		is null — Aprobar and Descartar both clear it immediately (see
		`open-change-set.ts`'s header) rather than leaving a "Publicado ✓"
		state sitting there.
	-->
	{#if openChange}
		<PendingChangeBar
			card={openChange}
			busy={actionBusy}
			onPreview={handleCardPreview}
			onApprove={handleCardApprove}
			onDiscard={handleCardDiscard}
			onUndo={handleCardUndo}
		/>
	{:else if approvalToast}
		<!--
			Lane B9 — the brief, self-dismissing stand-in for the bar right
			after a successful Aprobar (see `showApprovalToast`/
			`dismissApprovalToast` above): never blocks the composer, never
			stacks with a real pending change, gone on its own timeout or the
			next message sent. Deshacer here calls the exact same endpoint as
			the bar's own Deshacer did — this is still the only place a click
			(never the model) undoes anything.
		-->
		<div class="approval-toast" role="status">
			<span class="toast-text">✓ Publicado</span>
			<button type="button" class="toast-undo" onclick={handleCardUndo} disabled={actionBusy}>
				{actionBusy ? 'Deshaciendo…' : 'Deshacer'}
			</button>
		</div>
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

{#if previewOpen && openChange}
	<PreviewOverlay
		card={openChange}
		busy={actionBusy}
		onApprove={handleCardApprove}
		onDiscard={handleCardDiscard}
		onUndo={handleCardUndo}
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

	/* Lane B9 — the brief, self-dismissing confirmation that replaces the
	   persistent bar right after Aprobar. Deliberately small and quiet
	   (unlike the bar it replaces) — it's a courtesy notice, not something
	   that needs the owner's attention the way an open change does. */
	.approval-toast {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.5rem 0.9rem;
		border-top: 1px solid color-mix(in srgb, var(--color-ink) 15%, transparent);
		background: color-mix(in srgb, var(--color-lime) 18%, var(--color-cream-dark, #e8e2d2));
		font-size: 0.82rem;
	}
	.toast-text {
		font-weight: 700;
	}
	.toast-undo {
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent);
		border-radius: 0.6em;
		padding: 0.35em 0.8em;
		min-height: 44px;
		cursor: pointer;
		color: var(--color-ink);
	}
	.toast-undo:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
