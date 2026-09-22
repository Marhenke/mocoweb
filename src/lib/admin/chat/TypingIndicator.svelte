<script lang="ts">
	/** Shown from the moment a message is sent until the first token or tool activity arrives (Lane B6). */
</script>

<div class="row assistant">
	<div class="bubble" aria-label="Escribiendo…" role="status">
		<span class="dot"></span>
		<span class="dot"></span>
		<span class="dot"></span>
	</div>
</div>

<style>
	.row {
		display: flex;
		justify-content: flex-start;
	}
	.bubble {
		background: var(--color-cream-dark, #fff);
		border-radius: 1rem;
		border-bottom-left-radius: 0.3rem;
		padding: 0.75rem 1rem;
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--color-muted, #999);
		opacity: 0.6;
		animation: bounce 1.2s infinite ease-in-out;
	}
	.dot:nth-child(2) {
		animation-delay: 0.15s;
	}
	.dot:nth-child(3) {
		animation-delay: 0.3s;
	}
	@keyframes bounce {
		0%,
		80%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		40% {
			transform: translateY(-0.3rem);
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
