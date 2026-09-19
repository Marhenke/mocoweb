/**
 * Renders the /authorize HTML page: exactly one field (the owner key), plus
 * a scope choice. No username, no password, no account recovery — see the
 * design brief in .migration/LANES.md's Lane A6 entry. Generic/engine-level
 * (no Moco branding), so it can be copied to another project along with the
 * rest of src/lib/server/cms/.
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
}

export function renderAuthorizePage(params: AuthorizePageParams): string {
	const identity = params.clientName ? escapeHtml(params.clientName) : escapeHtml(params.clientId);
	const hidden = (name: string, value: string) =>
		`<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
	const defaultContent = contentPartOf(params.defaultScope);
	const defaultInbox = hasInboxPart(params.defaultScope);

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize access</title>
<style>
	:root { color-scheme: light dark; }
	body {
		font-family: system-ui, -apple-system, sans-serif;
		max-width: 28rem;
		margin: 4rem auto;
		padding: 0 1.5rem;
		line-height: 1.5;
	}
	h1 { font-size: 1.25rem; }
	.app-name { font-weight: 600; }
	fieldset { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 1rem 0; }
	legend { padding: 0 0.4rem; font-size: 0.85rem; opacity: 0.75; }
	label.option { display: block; margin: 0.4rem 0; font-weight: normal; }
	label.key-label { display: block; font-weight: 600; margin-bottom: 0.4rem; }
	input[type="password"] {
		width: 100%; padding: 0.6rem 0.7rem; font-size: 1rem;
		border-radius: 0.4rem; border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		box-sizing: border-box;
	}
	button {
		margin-top: 1.25rem; width: 100%; padding: 0.7rem; font-size: 1rem; font-weight: 600;
		border-radius: 0.4rem; border: none; cursor: pointer;
		background: #16a34a; color: white;
	}
	.error {
		background: color-mix(in srgb, crimson 12%, transparent);
		border: 1px solid crimson; border-radius: 0.4rem; padding: 0.6rem 0.8rem;
		margin-bottom: 1rem; font-size: 0.9rem;
	}
	.hint { font-size: 0.8rem; opacity: 0.7; margin-top: 1.5rem; }
</style>
</head>
<body>
	<h1><span class="app-name">${identity}</span> is requesting access</h1>
	${params.errorMessage ? `<div class="error">${escapeHtml(params.errorMessage)}</div>` : ''}
	<form method="POST">
		${hidden('response_type', params.responseType)}
		${hidden('client_id', params.clientId)}
		${hidden('redirect_uri', params.redirectUri)}
		${hidden('state', params.state ?? '')}
		${hidden('code_challenge', params.codeChallenge)}
		${hidden('code_challenge_method', params.codeChallengeMethod)}

		<label class="key-label" for="owner_key">Owner key</label>
		<input type="password" id="owner_key" name="owner_key" autocomplete="off" autofocus required>

		<fieldset>
			<legend>Content access level</legend>
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
			<legend>Inbox access (separate grant)</legend>
			<label class="option">
				<input type="checkbox" name="granted_scope_inbox" value="inbox" ${defaultInbox ? 'checked' : ''}>
				${escapeHtml(SCOPE_DESCRIPTIONS.inbox)}
			</label>
		</fieldset>

		<button type="submit">Authorize</button>
	</form>
	<p class="hint">No account, no password reset. This key is the one set for this site's owner. Wrong key three times too many and you'll be asked to wait a few minutes.</p>
</body>
</html>`;
}

export function renderAuthorizeErrorPage(title: string, description: string): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1.5rem;">
	<h1>${escapeHtml(title)}</h1>
	<p>${escapeHtml(description)}</p>
</body>
</html>`;
}
