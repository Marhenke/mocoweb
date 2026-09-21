/**
 * Renders the /authorize HTML page: exactly one field (the owner key), plus
 * a scope choice — except for the internal admin panel's own flow
 * (`params.internalFullAccess`, Lane B5 follow-up), which hides the scope
 * choice entirely and shows a short note instead, because that grant is
 * forced server-side regardless of what this page renders or what a form
 * submission claims (see `auth/internal-client.ts` and
 * `routes/authorize/+server.ts` — the actual enforcement is NOT here).
 *
 * ── Design tokens (Lane B5 follow-up) ────────────────────────────────────
 * This file is server-rendered standalone HTML with no access to the
 * SvelteKit app's Tailwind build, so it cannot literally `@import` this
 * site's `src/routes/layout.css` — the SITE TOKENS block below instead
 * re-declares the SAME custom-property names with the SAME current values
 * (Moco's cream/ink/lime palette, Bricolage Grotesque + Inter), read by the
 * rest of this file's inline styles exactly like `layout.css` is read by
 * the rest of the app. This keeps the file portable the way the rest of
 * `src/lib/server/cms/` is documented to be (see `db/schema.ts`'s header):
 * copying this engine to a new client site means updating this ONE block
 * (and the Google Fonts `<link>` below it) to that site's own tokens,
 * nothing else in this file.
 */

import { SCOPE_DESCRIPTIONS, contentPartOf, hasInboxPart } from './scope';

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

// SITE TOKENS — copy from the client site's src/routes/layout.css `@theme`
// block when reusing this engine elsewhere. Values below match Moco's.
const SITE_TOKENS_CSS = `
	:root {
		--color-cream: #f4f0e6;
		--color-cream-dark: #e8e2d2;
		--color-ink: #16140f;
		--color-ink-soft: #3a362d;
		--color-muted: #6f6a5d;
		--color-lime: #c8f135;
		--color-lime-dark: #aad419;
		--font-display: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
		--font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
		color-scheme: light;
	}
`;
const SITE_FONTS_LINK =
	'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
	'<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">';

export interface AuthorizePageParams {
	clientName: string | null;
	clientId: string;
	responseType: string;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
	codeChallengeMethod: string;
	/** The requested/previous scope SET (e.g. "write" or "write inbox"), not a single Scope. */
	defaultScope: string;
	errorMessage?: string;
	/** True only for the internal admin panel's own flow — see this file's header. */
	internalFullAccess?: boolean;
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
	const identity = params.clientName ? escapeHtml(params.clientName) : escapeHtml(params.clientId);
	const hidden = (name: string, value: string) =>
		`<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
	const defaultContent = contentPartOf(params.defaultScope);
	const defaultInbox = hasInboxPart(params.defaultScope);

	const scopeFieldsets = params.internalFullAccess
		? `<div class="full-access-note">Este panel tiene acceso completo al contenido del sitio (leer, escribir y publicar) y a los mensajes del formulario de contacto — sos vos, en tu propio sitio.</div>
			${hidden('granted_scope', 'publish')}${hidden('granted_scope_inbox', 'inbox')}`
		: `<fieldset>
				<legend>Nivel de acceso al contenido</legend>
				<label class="option">
					<input type="radio" name="granted_scope" value="publish" ${defaultContent === 'publish' ? 'checked' : ''}>
					${escapeHtml(SCOPE_DESCRIPTIONS.publish)}
				</label>
				<label class="option">
					<input type="radio" name="granted_scope" value="write" ${defaultContent === 'write' ? 'checked' : ''}>
					${escapeHtml(SCOPE_DESCRIPTIONS.write)}
				</label>
				<label class="option">
					<input type="radio" name="granted_scope" value="read" ${defaultContent === 'read' ? 'checked' : ''}>
					${escapeHtml(SCOPE_DESCRIPTIONS.read)}
				</label>
			</fieldset>

			<fieldset>
				<legend>Acceso a la bandeja de entrada (permiso aparte)</legend>
				<label class="option">
					<input type="checkbox" name="granted_scope_inbox" value="inbox" ${defaultInbox ? 'checked' : ''}>
					${escapeHtml(SCOPE_DESCRIPTIONS.inbox)}
				</label>
			</fieldset>`;

	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar acceso</title>
${SITE_FONTS_LINK}
<style>
${SITE_TOKENS_CSS}
	* { box-sizing: border-box; }
	body {
		font-family: var(--font-sans);
		background: var(--color-cream);
		color: var(--color-ink);
		max-width: 26rem;
		margin: 0 auto;
		padding: 3rem 1.25rem;
		line-height: 1.5;
	}
	h1 { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; margin: 0 0 1.5rem; }
	.app-name { font-weight: 700; }
	.card { background: white; border-radius: 1rem; padding: 1.5rem 1.5rem 1.75rem; box-shadow: 0 1px 3px color-mix(in srgb, var(--color-ink) 10%, transparent); }
	fieldset { border: 1px solid color-mix(in srgb, var(--color-ink) 18%, transparent); border-radius: 0.75rem; padding: 0.85rem 1rem; margin: 1rem 0 0; }
	legend { padding: 0 0.4rem; font-size: 0.8rem; color: var(--color-muted); }
	.full-access-note {
		font-size: 0.85rem; color: var(--color-ink-soft);
		background: color-mix(in srgb, var(--color-lime) 25%, white);
		border: 1px solid color-mix(in srgb, var(--color-lime-dark) 60%, transparent);
		border-radius: 0.75rem; padding: 0.75rem 0.9rem; margin-top: 1rem;
	}
	label.option { display: block; margin: 0.45rem 0; font-weight: normal; font-size: 0.88rem; }
	label.key-label { display: block; font-weight: 600; margin-bottom: 0.4rem; font-size: 0.9rem; }
	input[type="password"] {
		width: 100%; padding: 0.7rem 0.8rem; font-size: 1rem; font-family: inherit;
		border-radius: 0.6rem; border: 1px solid color-mix(in srgb, var(--color-ink) 25%, transparent);
	}
	button {
		margin-top: 1.4rem; width: 100%; padding: 0.8rem; font-size: 1rem; font-weight: 600; font-family: inherit;
		border-radius: 0.6rem; border: none; cursor: pointer;
		background: var(--color-lime); color: var(--color-ink);
	}
	button:hover { background: var(--color-lime-dark); }
	.error {
		background: color-mix(in srgb, crimson 10%, transparent);
		border: 1px solid crimson; border-radius: 0.6rem; padding: 0.65rem 0.85rem;
		margin-bottom: 1rem; font-size: 0.88rem;
	}
	.hint { font-size: 0.78rem; color: var(--color-muted); margin-top: 1.5rem; text-align: center; }
</style>
</head>
<body>
	<h1><span class="app-name">${identity}</span> está pidiendo acceso</h1>
	<div class="card">
	${params.errorMessage ? `<div class="error">${escapeHtml(params.errorMessage)}</div>` : ''}
	<form method="POST">
		${hidden('response_type', params.responseType)}
		${hidden('client_id', params.clientId)}
		${hidden('redirect_uri', params.redirectUri)}
		${hidden('state', params.state ?? '')}
		${hidden('code_challenge', params.codeChallenge)}
		${hidden('code_challenge_method', params.codeChallengeMethod)}

		<label class="key-label" for="owner_key">Clave del sitio</label>
		<input type="password" id="owner_key" name="owner_key" autocomplete="off" autofocus required>

		${scopeFieldsets}

		<button type="submit">Autorizar</button>
	</form>
	</div>
	<p class="hint">Sin cuenta, sin recuperación de contraseña: esta es la clave única de quien administra este sitio. Tres intentos incorrectos y vas a tener que esperar unos minutos.</p>
</body>
</html>`;
}

export function renderAuthorizeErrorPage(title: string, description: string): string {
	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${SITE_FONTS_LINK}
<style>
${SITE_TOKENS_CSS}
	body { font-family: var(--font-sans); background: var(--color-cream); color: var(--color-ink); max-width: 26rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; }
	h1 { font-family: var(--font-display); font-size: 1.3rem; }
</style>
</head>
<body>
	<h1>${escapeHtml(title)}</h1>
	<p>${escapeHtml(description)}</p>
</body>
</html>`;
}
