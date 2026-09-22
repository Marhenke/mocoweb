<script lang="ts">
	/**
	 * One chat bubble (Lane B6) — user or assistant, with inline tool-activity
	 * chips, inline images, sanitized markdown for assistant text (see
	 * `markdown.ts`'s header for why `{@html}` here is safe), a timestamp, and
	 * a copy action on assistant replies. `tools` is the shared, reactive
	 * status map from `ChatPanel.svelte` — looked up by id so a tool that
	 * finishes AFTER this bubble's own content already rendered (see
	 * `agent.ts`'s emit order: `tool_start` → `assistant_message` →
	 * `tool_result`) still updates live in place.
	 */
	import { renderMarkdown } from './markdown';
	import { formatTime } from './format';
	import type { ChatBubble, ToolActivity } from './types';

	interface Props {
		bubble: ChatBubble;
		tools: Record<string, ToolActivity>;
		onRetry?: (bubble: ChatBubble) => void;
	}
	let { bubble, tools, onRetry }: Props = $props();

	let toolList = $derived(bubble.toolIds.map((id) => tools[id]).filter((t): t is ToolActivity => !!t));
	let html = $derived(bubble.role === 'assistant' && bubble.text ? renderMarkdown(bubble.text) : '');

	let copied = $state(false);
	async function copyText(): Promise<void> {
		try {
			await navigator.clipboard.writeText(bubble.text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Clipboard API can be unavailable (permissions, non-secure context)
			// — silently no-op rather than throwing into the UI over a
			// non-essential convenience action.
		}
	}

	// Lane B8 — deliberately never renders an alarming icon for a tool call
	// that errored: the chip only ever shows "in progress" or "done" (see
	// `ChatPanel.svelte`'s `tool_result`/`rowsToBubbles` handling, which never
	// sets `status: 'error'` anymore). `'error'` is kept in `ToolStatus`
	// (`types.ts`) only so the type isn't a lie about what the server can send
	// — this function still handles it defensively, but folded into the same
	// checkmark as a normal success.
	function statusIcon(status: ToolActivity['status']): string {
		if (status === 'running') return '⏳';
		return '✓';
	}
</script>

<div class="row {bubble.role}">
	<div
		class="bubble {bubble.role}"
		class:budget={bubble.budgetBlocked}
		class:stopped={bubble.stopped}
		class:failed={bubble.failed}
	>
		{#each toolList as tool (tool.id)}
			<div class="tool-chip status-{tool.status}">
				<span class="tool-icon" aria-hidden="true">{statusIcon(tool.status)}</span>
				<span>{tool.label}</span>
			</div>
		{/each}

		{#each bubble.images as img (img.url)}
			<img class="bubble-img" src={img.url} alt={img.alt} loading="lazy" />
		{/each}

		{#if bubble.role === 'assistant' && bubble.text}
			<div class="bubble-text md">{@html html}</div>
		{:else if bubble.text}
			<p class="bubble-text plain">{bubble.text}</p>
		{/if}

		{#if bubble.streaming}
			<span class="cursor" aria-hidden="true"></span>
		{/if}

		{#if bubble.stopped}
			<div class="stopped-tag">Generación detenida</div>
		{/if}

		<div class="meta-row">
			<span class="timestamp">{formatTime(bubble.createdAt)}</span>
			{#if bubble.role === 'assistant' && bubble.text && !bubble.streaming}
				<button type="button" class="copy-btn" onclick={copyText} aria-label="Copiar mensaje">
					{copied ? 'Copiado ✓' : 'Copiar'}
				</button>
			{/if}
			{#if bubble.failed}
				<button type="button" class="retry-btn" onclick={() => onRetry?.(bubble)}>Reintentar</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.row {
		display: flex;
	}
	.row.assistant {
		justify-content: flex-start;
	}
	.row.user {
		justify-content: flex-end;
	}

	.bubble {
		max-width: min(38rem, 88%);
		border-radius: 1rem;
		padding: 0.65rem 0.9rem;
		font-size: 0.95rem;
		line-height: 1.5;
	}
	.bubble.assistant {
		background: var(--color-cream-dark, #fff);
		border-bottom-left-radius: 0.3rem;
	}
	.bubble.user {
		background: var(--color-lime);
		color: var(--color-ink);
		border-bottom-right-radius: 0.3rem;
	}
	.bubble.budget {
		background: color-mix(in srgb, orange 15%, white);
		border: 1px solid color-mix(in srgb, orange 40%, transparent);
	}
	.bubble.stopped {
		border: 1px dashed color-mix(in srgb, var(--color-ink) 30%, transparent);
	}
	.bubble.failed {
		border: 1px solid color-mix(in srgb, crimson 50%, transparent);
	}

	.bubble-text.plain {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.bubble-text.md {
		word-break: break-word;
	}
	.bubble-text.md :global(p) {
		margin: 0 0 0.6em;
	}
	.bubble-text.md :global(p:last-child) {
		margin-bottom: 0;
	}
	.bubble-text.md :global(ul),
	.bubble-text.md :global(ol) {
		margin: 0 0 0.6em;
		padding-left: 1.25em;
	}
	.bubble-text.md :global(li) {
		margin-bottom: 0.2em;
	}
	.bubble-text.md :global(code) {
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
		border-radius: 0.25em;
		padding: 0.1em 0.35em;
		font-size: 0.85em;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
	}
	.bubble-text.md :global(pre) {
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
		border-radius: 0.5em;
		padding: 0.6em 0.75em;
		overflow-x: auto;
		margin: 0 0 0.6em;
	}
	.bubble-text.md :global(pre code) {
		background: none;
		padding: 0;
	}
	.bubble-text.md :global(a) {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
	}
	.bubble-text.md :global(.chat-md-img) {
		max-width: 100%;
		border-radius: 0.6em;
		display: block;
		margin: 0.3em 0;
	}
	.bubble-text.md :global(.chat-md-heading) {
		font-weight: 700;
	}

	.bubble-img {
		/* A real photo already has plenty of intrinsic pixels to shrink to fit
		   the bubble via max-width/max-height below — but a tiny source image
		   (e.g. a small icon, or this lane's own test fixture) has no intrinsic
		   size to grow FROM without an explicit width, so it would otherwise
		   render at its native pixel size (a couple of px) and look broken.
		   `width: 100%` with `height: auto` makes every attachment fill the
		   bubble's content width consistently regardless of its own pixel
		   dimensions, while max-height still caps an unusually tall image. */
		width: 100%;
		height: auto;
		max-width: 100%;
		max-height: 16rem;
		border-radius: 0.6em;
		display: block;
		margin-bottom: 0.5em;
		object-fit: cover;
	}

	.cursor {
		display: inline-block;
		width: 0.5em;
		height: 1em;
		vertical-align: text-bottom;
		background: currentColor;
		opacity: 0.6;
		animation: blink 1s step-start infinite;
		margin-left: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.cursor {
			animation: none;
			opacity: 0.35;
		}
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.tool-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35em;
		font-size: 0.78rem;
		color: var(--color-muted, #666);
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		border-radius: 999px;
		padding: 0.2em 0.65em;
		margin: 0 0.3em 0.35em 0;
	}
	.tool-icon {
		font-size: 0.85em;
	}

	.stopped-tag {
		font-size: 0.75rem;
		color: var(--color-muted, #666);
		margin-top: 0.35em;
		font-style: italic;
	}

	.meta-row {
		display: flex;
		align-items: center;
		gap: 0.6em;
		margin-top: 0.35em;
	}
	.timestamp {
		font-size: 0.7rem;
		opacity: 0.55;
	}
	.copy-btn,
	.retry-btn {
		font-size: 0.7rem;
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
		color: inherit;
		opacity: 0.7;
		min-height: 1.5rem;
	}
	.copy-btn:hover,
	.retry-btn:hover {
		opacity: 1;
	}
	.retry-btn {
		color: crimson;
		opacity: 1;
	}
</style>
