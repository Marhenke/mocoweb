<script lang="ts">
	import './layout.css';
	import Nav from '$lib/components/Nav.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/favicon-96x96.png?v=20260624" sizes="96x96" />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20260624" />
	<link rel="shortcut icon" href="/favicon.ico?v=20260624" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20260624" />
	<meta name="apple-mobile-web-app-title" content="Moco Estudio" />
	<link rel="manifest" href="/site.webmanifest?v=20260624" />
</svelte:head>

<Nav />
<main>
	{@render children()}
</main>
<Footer />
