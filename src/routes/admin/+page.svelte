<script lang="ts">
	/**
	 * The admin panel (Lane B5, streaming chat since Lane B6). Two screens:
	 * a login form (owner key only — the panel is the site's fixed internal
	 * OAuth client, see `$lib/admin/internal-client-id.ts`) run through this
	 * site's own OAuth authorization-code + PKCE flow
	 * (`$lib/admin/oauth-client.ts`), and, once authorized, `ChatPanel.svelte`
	 * (`$lib/admin/chat/`), which owns the actual conversation. No cookie is
	 * ever involved; the access token lives only in this component's
	 * in-memory `tokens` state (see `oauth-client.ts`'s header for why).
	 *
	 * This file's OWN job, after Lane B6's refactor, is narrowly: the
	 * login/session lifecycle, and handing `ChatPanel` two capabilities it
	 * needs but must never implement itself — `getAccessToken` (a fresh,
	 * refreshed-if-needed bearer token for the streaming POST) and
	 * `authedFetch` (the same, wrapped around `fetch`, for the plain
	 * JSON GET/DELETE calls) — plus a way to say "the session's gone, show
	 * the login form again" (`onSessionExpired`).
	 */
	import { onMount } from 'svelte';
	import {
		loginWithOwnerKey,
		tryRefresh,
		clearSession,
		hasStoredRefreshToken,
		type TokenSet
	} from '$lib/admin/oauth-client';
	import ChatPanel from '$lib/admin/chat/ChatPanel.svelte';

	let tokens = $state<TokenSet | null>(null);
	let bootLoading = $state(true);

	let ownerKeyInput = $state('');
	let loginError = $state('');
	let loggingIn = $state(false);

	onMount(async () => {
		if (hasStoredRefreshToken()) {
			try {
				const refreshed = await tryRefresh();
				if (refreshed) tokens = refreshed;
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
		} catch (err) {
			loginError = err instanceof Error ? err.message : 'Error desconocido.';
		} finally {
			loggingIn = false;
		}
	}

	function logout(): void {
		clearSession();
		tokens = null;
	}

	function onSessionExpired(): void {
		tokens = null;
	}

	/** A fresh access token, refreshing first if it's within 30s of expiring — the single source of truth `ChatPanel` calls before its streaming POST. */
	async function getAccessToken(): Promise<string | null> {
		if (!tokens) return null;
		if (Date.now() > tokens.expiresAt - 30_000) {
			const refreshed = await tryRefresh();
			if (!refreshed) {
				tokens = null;
				return null;
			}
			tokens = refreshed;
		}
		return tokens.accessToken;
	}

	/** Plain JSON fetch with the same bearer-token/refresh-on-401 handling — used by `ChatPanel` for GET (load history) and DELETE (clear conversation). */
	async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
		const token = await getAccessToken();
		if (!token) return new Response(null, { status: 401 });
		const withAuth = (t: string) => ({
			...init,
			headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}` }
		});
		let res = await fetch(path, withAuth(token));
		if (res.status === 401) {
			const refreshedToken = await getAccessToken();
			if (!refreshedToken) return res;
			res = await fetch(path, withAuth(refreshedToken));
		}
		return res;
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
		<div class="chat-frame">
			<ChatPanel {getAccessToken} {authedFetch} {onSessionExpired} onLogout={logout} />
		</div>
	{/if}
</div>

<style>
	.admin-shell {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--color-cream);
		color: var(--color-ink);
		font-family: var(--font-sans);
		overflow: hidden;
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
		font-size: 16px;
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
		min-height: 44px;
	}
	.login-card button[type='submit']:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.chat-frame {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	@media (max-width: 30rem) {
		.login-card {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
