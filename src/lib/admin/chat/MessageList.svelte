<script lang="ts">
	/**
	 * The scrollable thread (Lane B6): day separators, bubbles, a typing
	 * indicator, auto-follow-while-at-bottom scrolling with a "new messages ↓"
	 * jump button when the owner has scrolled up, and a visually-hidden
	 * `aria-live="polite"` region for screen readers.
	 *
	 * ── Why the live region only updates at safe points ──────────────────────
	 * The brief: "screen readers get new agent messages ... without
	 * re-reading the whole thread on every token." Two rules follow, both
	 * enforced by the PARENT (`ChatPanel.svelte`) choosing WHEN to change
	 * `liveAnnouncement`, not by anything in this component: (1) it is only
	 * ever the newest assistant text, never the whole thread — screen readers
	 * announce a live region's FULL new content on each change, so putting
	 * the whole conversation there would re-read everything every time; (2)
	 * it is updated at a low, deliberately throttled rate while streaming
	 * (not on every `text_delta`) and once more on completion — spamming a
	 * polite region many times a second is functionally unusable with a
	 * screen reader, even though `polite` (rather than `assertive`) already
	 * means it waits for a pause before speaking.
	 */
	import MessageBubble from './MessageBubble.svelte';
	import TypingIndicator from './TypingIndicator.svelte';
	import { dayLabel, dayKey } from './format';
	import type { ChatBubble, ToolActivity } from './types';

	interface Props {
		bubbles: ChatBubble[];
		tools: Record<string, ToolActivity>;
		showTyping: boolean;
		liveAnnouncement: string;
		updateTick: number;
		onRetry: (bubble: ChatBubble) => void;
		/** Lane B9 — click-to-undo offered inline on a reply (see `ChatPanel.svelte`'s `handleInlineUndo`), threaded down to `MessageBubble.svelte`. */
		onInlineUndo: (toolId: string) => void;
		undoBusy: boolean;
	}
	let { bubbles, tools, showTyping, liveAnnouncement, updateTick, onRetry, onInlineUndo, undoBusy }: Props = $props();

	let scrollEl: HTMLDivElement | undefined = $state();
	let bottomAnchor: HTMLDivElement | undefined = $state();
	let atBottom = $state(true);
	let hasScrolledOnce = false;

	function isNearBottom(): boolean {
		if (!scrollEl) return true;
		const slack = 80;
		return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < slack;
	}

	function handleScroll(): void {
		atBottom = isNearBottom();
	}

	function scrollToBottom(smooth = true): void {
		bottomAnchor?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'end' });
		atBottom = true;
	}

	// Auto-follow while at the bottom; never yank the owner down if they
	// scrolled up to re-read something earlier in the thread.
	$effect(() => {
		// Referenced so this effect re-runs on every relevant change —
		// `bubbles.length`, the last bubble's own text length (streaming), and
		// `updateTick` (bumped by the parent on tool status changes, which
		// don't change any text length).
		const lastLen = bubbles.length > 0 ? bubbles[bubbles.length - 1].text.length : 0;
		void bubbles.length;
		void lastLen;
		void updateTick;
		if (!hasScrolledOnce) {
			// First render / history load: land at the bottom without animating.
			hasScrolledOnce = true;
			queueMicrotask(() => scrollToBottom(false));
			return;
		}
		if (atBottom) {
			queueMicrotask(() => scrollToBottom(true));
		}
	});

	function bubbleDay(index: number): string | null {
		const b = bubbles[index];
		if (index === 0) return dayLabel(b.createdAt);
		const prev = bubbles[index - 1];
		if (dayKey(prev.createdAt) !== dayKey(b.createdAt)) return dayLabel(b.createdAt);
		return null;
	}
</script>

<div class="scroll-area" bind:this={scrollEl} onscroll={handleScroll}>
	<div class="column">
		{#each bubbles as bubble, index (bubble.id)}
			{@const day = bubbleDay(index)}
			{#if day}
				<div class="day-separator" role="separator"><span>{day}</span></div>
			{/if}
			<MessageBubble {bubble} {tools} {onRetry} {onInlineUndo} {undoBusy} />
		{/each}
		{#if showTyping}
			<TypingIndicator />
		{/if}
		<div bind:this={bottomAnchor}></div>
	</div>
</div>

{#if !atBottom}
	<button type="button" class="jump-button" onclick={() => scrollToBottom(true)}>
		Mensajes nuevos ↓
	</button>
{/if}

<div class="sr-only" aria-live="polite" aria-atomic="true">{liveAnnouncement}</div>

<style>
	.scroll-area {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}
	.column {
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.day-separator {
		display: flex;
		justify-content: center;
		margin: 0.5rem 0;
	}
	.day-separator span {
		font-size: 0.72rem;
		color: var(--color-muted, #666);
		background: color-mix(in srgb, var(--color-ink) 6%, transparent);
		border-radius: 999px;
		padding: 0.25rem 0.75rem;
	}

	.jump-button {
		position: absolute;
		bottom: 5.5rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--color-ink);
		color: var(--color-cream);
		border: none;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font-size: 0.8rem;
		cursor: pointer;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--color-ink) 25%, transparent);
		min-height: 44px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
