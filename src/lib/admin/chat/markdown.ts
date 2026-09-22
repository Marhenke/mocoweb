/**
 * A small, hand-rolled, SAFE markdown-ish renderer for agent replies (Lane
 * B6) — bold, italics, inline code, fenced code blocks, links, images, and
 * lists. NOT a general markdown library, and deliberately so: this app's
 * `/admin` chat can render text that ultimately originates from an
 * anonymous site visitor (a contact-form inquiry, quoted back by the model —
 * see `tools-bridge.ts`'s `wrapUntrusted`), and `/admin` holds a bearer
 * token in memory — an XSS here is a real token leak (see
 * `hooks.server.ts`'s strict CSP for the other half of that defense). No
 * `{@html}` of raw model/tool text ever happens anywhere in this app;
 * `renderMarkdown` is the ONLY thing allowed to produce the HTML string that
 * `MessageBubble.svelte` passes to `{@html}`, and its contract is: every
 * character of input text that isn't part of ONE OF THE FEW SYNTAX FORMS
 * THIS FILE ITSELF RECOGNIZES is HTML-escaped before it reaches the output
 * string. There is no code path that copies a `<`/`>` from the input
 * through to the output unescaped — this module never parses arbitrary
 * HTML, so there is nothing here for a `<script>` or `<img onerror=...>` in
 * the input to hook into. Verified in this lane's own browser testing with
 * exactly that payload (`<img src=x onerror=alert(1)>`) inside a fake
 * inquiry, read back by the (stub) model.
 *
 * Deliberately NOT a dependency (no `marked`/`markdown-it` + `dompurify`
 * pair) — same "the actual surface needed here is small, hand-rolling it is
 * less code and less supply-chain risk than a library" precedent as
 * `anthropic-client.ts`'s hand-rolled SSE parser and `auth/jwt.ts`'s
 * hand-rolled HS256.
 */

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Same escaping as `escapeHtml` — used for values going into an HTML
 * attribute (`href`/`src`/`alt`), kept as a separate name so call sites read
 * as "this is going in an attribute", not because the escaping differs.
 */
const escapeAttr = escapeHtml;

/**
 * Only `http:`/`https:` URLs, or a same-origin-relative path (e.g.
 * `/media/<key>`, what this app's own tools return), are allowed through as
 * a real `href`/`src` — `javascript:`, `data:`, and anything else `new URL`
 * can't parse are rejected outright, which is what stops a markdown link
 * itself from being an XSS vector even though its LABEL text is already
 * safe via `escapeHtml`. Returns the ORIGINAL string (not the resolved
 * absolute URL) so a relative `/media/...` path stays relative — resolution
 * here is only ever used to validate the scheme, matching how the browser
 * would resolve it anyway when it's actually used as an attribute.
 */
function safeUrl(raw: string): string | null {
	try {
		const resolved = new URL(raw, 'https://admin.invalid/');
		if (resolved.protocol === 'http:' || resolved.protocol === 'https:') return raw;
		return null;
	} catch {
		return null;
	}
}

// Order matters: images before plain links (both start with `[`, images
// have a leading `!`), bold (`**`) before italics (`*`) so `**x**` never
// gets read as two adjacent italics, code spans last so backticked text
// never has its OWN contents re-interpreted by an earlier alternative
// (JS regex alternation tries earlier branches first at each position, but
// this still keeps the intent legible).
const INLINE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`|\*([^*\n]+)\*/g;

function renderInline(text: string): string {
	let out = '';
	let lastIndex = 0;
	INLINE_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = INLINE_RE.exec(text))) {
		out += escapeHtml(text.slice(lastIndex, m.index));
		if (m[1] !== undefined) {
			// image: ![alt](url)
			const safe = safeUrl(m[2]);
			out = safe
				? out + `<img src="${escapeAttr(safe)}" alt="${escapeAttr(m[1])}" loading="lazy" class="chat-md-img">`
				: out + escapeHtml(m[0]);
		} else if (m[3] !== undefined) {
			// link: [label](url)
			const safe = safeUrl(m[4]);
			out = safe
				? out + `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m[3])}</a>`
				: out + escapeHtml(m[0]);
		} else if (m[5] !== undefined) {
			out += `<strong>${escapeHtml(m[5])}</strong>`;
		} else if (m[6] !== undefined) {
			out += `<code>${escapeHtml(m[6])}</code>`;
		} else if (m[7] !== undefined) {
			out += `<em>${escapeHtml(m[7])}</em>`;
		}
		lastIndex = m.index + m[0].length;
	}
	out += escapeHtml(text.slice(lastIndex));
	return out;
}

const UL_LINE_RE = /^(-|\*)\s+/;
const OL_LINE_RE = /^\d+\.\s+/;
const HEADING_RE = /^#{1,3}\s+/;
const FENCE_RE = /^```/;

export function renderMarkdown(raw: string): string {
	if (!raw) return '';
	const lines = raw.replace(/\r\n/g, '\n').split('\n');
	let html = '';
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '') {
			i++;
			continue;
		}
		if (FENCE_RE.test(line.trim())) {
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !FENCE_RE.test(lines[i].trim())) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // skip the closing fence, if any
			html += `<pre class="chat-md-pre"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
			continue;
		}
		if (UL_LINE_RE.test(line)) {
			const items: string[] = [];
			while (i < lines.length && UL_LINE_RE.test(lines[i])) {
				items.push(renderInline(lines[i].replace(UL_LINE_RE, '')));
				i++;
			}
			html += `<ul class="chat-md-list">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;
			continue;
		}
		if (OL_LINE_RE.test(line)) {
			const items: string[] = [];
			while (i < lines.length && OL_LINE_RE.test(lines[i])) {
				items.push(renderInline(lines[i].replace(OL_LINE_RE, '')));
				i++;
			}
			html += `<ol class="chat-md-list">${items.map((t) => `<li>${t}</li>`).join('')}</ol>`;
			continue;
		}
		if (HEADING_RE.test(line)) {
			html += `<p class="chat-md-heading">${renderInline(line.replace(HEADING_RE, ''))}</p>`;
			i++;
			continue;
		}
		const paraLines: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== '' &&
			!UL_LINE_RE.test(lines[i]) &&
			!OL_LINE_RE.test(lines[i]) &&
			!FENCE_RE.test(lines[i].trim())
		) {
			paraLines.push(lines[i]);
			i++;
		}
		html += `<p>${paraLines.map(renderInline).join('<br>')}</p>`;
	}
	return html;
}
