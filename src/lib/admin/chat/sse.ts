/**
 * Browser-side Server-Sent Events reader for `/api/chat`'s streaming POST
 * (Lane B6). Not `EventSource`: that API can only do a plain GET with no
 * custom headers, and this endpoint needs a `Bearer` auth header (no cookie
 * exists anywhere in this app — see `oauth-client.ts`'s header) plus a JSON
 * body — so this is `fetch` with a manual line-by-line SSE parse instead,
 * same shape as the server's own hand-rolled parser in
 * `chat/anthropic-client.ts`'s `callClaudeStream` (this module is that
 * function's browser-side mirror).
 *
 * `signal` is what makes the Stop button real: aborting it tears down this
 * `fetch`, which (per `routes/api/chat/+server.ts`'s own header comment) the
 * server detects via its response stream's `cancel()` and turns into an
 * aborted upstream Anthropic call — not just a UI change pretending to stop.
 */

export interface SseEvent {
	event: string;
	data: unknown;
}

/** True for the `DOMException`/`Error` both `fetch` and a stream reader throw when `signal` fires — callers use this to tell "the Stop button did this" apart from a real network failure. */
export function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

export async function* streamChat(params: {
	token: string;
	body: unknown;
	signal: AbortSignal;
}): AsyncGenerator<SseEvent, void, unknown> {
	const res = await fetch('/api/chat', {
		method: 'POST',
		signal: params.signal,
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${params.token}`
		},
		body: JSON.stringify(params.body)
	});

	if (!res.ok || !res.body) {
		// Not a stream at all — either an auth failure (401/403, before the
		// stream ever opens: `requireAuth` runs first in the route) or an
		// upload failure (400/502, also before the stream opens). Both are
		// still plain JSON at this point, per `+server.ts`.
		let description = res.statusText;
		try {
			const body = (await res.json()) as { error_description?: string };
			if (body.error_description) description = body.error_description;
		} catch {
			// Body wasn't JSON — keep statusText.
		}
		const err = new Error(description) as Error & { status: number };
		err.status = res.status;
		throw err;
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let boundary: number;
			while ((boundary = buffer.indexOf('\n\n')) !== -1) {
				const record = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				let eventName = 'message';
				let dataLine: string | null = null;
				for (const line of record.split('\n')) {
					if (line.startsWith('event:')) eventName = line.slice(6).trim();
					else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
				}
				if (dataLine === null) continue;
				try {
					yield { event: eventName, data: JSON.parse(dataLine) };
				} catch {
					// Malformed frame — skip rather than crash the whole turn.
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
