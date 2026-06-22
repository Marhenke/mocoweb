<script lang="ts">
	let { name }: { name: 'instagram' | 'tiktok' | 'youtube' | 'spotify' } = $props();
</script>

{#if name === 'instagram'}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<rect x="2" y="2" width="20" height="20" rx="5.5" />
		<circle cx="12" cy="12" r="4.2" />
		<circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
	</svg>
{:else if name === 'tiktok'}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M16.7 2h-3v13.3a2.4 2.4 0 1 1-2.4-2.4c.2 0 .5 0 .7.1V9.9a5.6 5.6 0 1 0 4.7 5.5V8.7a7 7 0 0 0 4 1.3V7a4 4 0 0 1-4-4z"
		/>
	</svg>
{:else if name === 'youtube'}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M23 7.5a3 3 0 0 0-2.1-2.1C19 4.9 12 4.9 12 4.9s-7 0-8.9.5A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z"
		/>
	</svg>
{:else if name === 'spotify'}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.6 14.4a.62.62 0 0 1-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.82-.87 7.1-.5 9.72 1.1.3.18.39.58.21.87zm1.23-2.74a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.56 11.23 1.33.37.22.49.71.26 1.07zm.11-2.85C14.83 8.96 9.6 8.79 6.53 9.72a.94.94 0 1 1-.54-1.8c3.53-1.07 9.3-.86 12.96 1.31a.94.94 0 0 1-.96 1.62z"
		/>
	</svg>
{/if}
