#!/usr/bin/env node
/**
 * A minimal, hand-rolled stand-in for `https://api.anthropic.com/v1/messages`
 * (Lane B6), used to exercise `/admin`'s full streaming chat — token-by-token
 * text, tool-use activity, Stop, and budget accounting — WITHOUT a real
 * `ANTHROPIC_API_KEY`. This is the streaming-capable successor to the
 * scripted stub Lane B5 built ad-hoc for its own testing (see
 * `.migration/LANES.md`'s Lane B5 section): same idea (respond against the
 * REAL tool registry — nothing about `/admin` or its tools is mocked, only
 * this one upstream API call is), now committed to the repo and extended to
 * emit REAL Server-Sent Events in Anthropic's documented streaming shape
 * (verified against https://platform.claude.com/docs/en/api/messages-streaming
 * while building this lane — see `anthropic-client.ts`'s header for the
 * event-by-event breakdown this script reproduces).
 *
 * Point the app at this instead of the real API:
 *
 *   ANTHROPIC_BASE_URL=http://localhost:8791 ./dev.sh
 *
 * (`anthropic-client.ts` reads `ANTHROPIC_BASE_URL` exactly like the official
 * SDKs do — nothing app-specific.) `ANTHROPIC_API_KEY` still needs to be SET
 * to some non-empty value for `callClaudeStream` to attempt the call at all
 * (it never reaches this stub otherwise) — its value is never checked here.
 *
 * ── What this proves, and what it doesn't ────────────────────────────────
 * Proves: the full harness — SSE parsing, incremental text rendering, tool-
 * activity status, Stop aborting the upstream connection (this script logs
 * `[stub] client disconnected mid-stream` when that happens — the same
 * signal a real dropped connection to Anthropic would produce), and budget
 * accounting from streamed usage — all work end-to-end against a server that
 * speaks the real wire protocol.
 * Does NOT prove: that a real Claude model, given this app's system prompt,
 * decides on its own not to follow an injected instruction, or produces any
 * particular quality of reply — this script's replies are scripted, not
 * generated. See the Lane B6 report for what still needs a live key.
 *
 * ── Scenario selection ────────────────────────────────────────────────────
 * Stateless by design (matches how a real model is called — this app always
 * resends the FULL message history, never a session id): each request scans
 * `messages` for the most recent real user utterance (a `user` message that
 * has a `text` block — i.e. not one of this app's own tool_result echoes),
 * matches it against the keyword table below to pick a PLAN (an ordered
 * list of tool calls followed by a closing text), then looks at how many of
 * that plan's steps already ran (tool_use blocks found AFTER that same user
 * message in the history — scoped there, not globally, so an earlier
 * finished turn's tool calls in the same conversation never confuse the
 * step count of a new one) to decide what THIS call should emit next.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8791);

// ---------------------------------------------------------------------------
// SSE writer
// ---------------------------------------------------------------------------

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeEvent(res, type, data) {
	res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Splits text into small word-ish chunks so the client visibly streams it, rather than getting one giant delta. */
function chunkText(text, approxWordsPerChunk = 2) {
	const words = text.split(/(?<=\s)/); // keep trailing spaces attached
	const chunks = [];
	for (let i = 0; i < words.length; i += approxWordsPerChunk) {
		chunks.push(words.slice(i, i + approxWordsPerChunk).join(''));
	}
	return chunks.length > 0 ? chunks : [text];
}

// ---------------------------------------------------------------------------
// Scenario plans
// ---------------------------------------------------------------------------

/**
 * Deliberately slow + long, so a human (or an automated Stop-button test)
 * has a comfortable multi-second window to hit Stop mid-generation. Trigger
 * phrase used by this lane's own browser verification: "escribí un texto
 * largo".
 */
const LONG_TEXT =
	'Perfecto, te cuento con detalle: el estudio Moco trabaja identidad de marca, diseño web y contenido para ' +
	'clientes que buscan una voz visual clara y consistente. Cada proyecto arranca con una etapa de investigación, ' +
	'sigue con exploración de dirección de arte, y termina con un sistema de piezas listo para producción. Esto es ' +
	'una respuesta deliberadamente larga, pensada para poder frenarla a la mitad con el botón de Detener y ' +
	'comprobar que la conversación queda en un estado coherente después, sin romper el siguiente turno. Sigo ' +
	'agregando texto de relleno para asegurar varios segundos de generación en cualquier entorno, incluso uno ' +
	'rápido: más contexto sobre el proceso, más detalle sobre las etapas, y una mención final de cierre.';

// Exercises the markdown renderer end-to-end in a real browser (bold,
// italics, inline code, a link, a bulleted list) — trigger phrase: "demo
// markdown". Deliberately does NOT include an image markdown token here;
// the sanitization test (a hostile `<img onerror=...>` from a fake inquiry)
// is covered separately via the "mensaje"/"bandeja" scenario below, which
// echoes REAL tool output instead of a scripted string.
const MARKDOWN_DEMO_TEXT =
	'Che, esto es una **prueba de markdown** para el chat. Podés escribir en *cursiva*, usar `código en línea`, ' +
	'y armar listas:\n\n- Primer punto\n- Segundo punto con **negrita** adentro\n- Tercer punto\n\n' +
	'También funcionan los links, como [la vista previa del sitio](/) — se abren en una pestaña nueva.';

/** Pulls the real site-relative media path out of the "[Imagen adjunta por el usuario...]" descriptor text block `routes/api/chat/+server.ts` appends alongside an attached image — see that file's header — so a scenario can patch an entry with the REAL uploaded path instead of a fake one. */
function attachmentPathFromMessage(message) {
	const blocks = message?.content ?? [];
	for (const b of blocks) {
		if (b.type !== 'text' || typeof b.text !== 'string') continue;
		const m = b.text.match(/url=(\S+)/);
		if (!m) continue;
		try {
			return new URL(m[1]).pathname;
		} catch {
			return m[1];
		}
	}
	return null;
}

function plans(intent, message) {
	const text = intent.toLowerCase();

	if (text.includes('demo markdown')) {
		return { kind: 'text', text: MARKDOWN_DEMO_TEXT };
	}

	if (text.includes('texto largo')) {
		return { kind: 'text', text: LONG_TEXT, slow: true };
	}

	if (text.includes('visita') || text.includes('estadística') || text.includes('estadistica')) {
		return {
			kind: 'tool-then-text',
			steps: [{ name: 'query_analytics', input: { metric: 'page_views', days: 7 } }],
			closingText: (toolResults) =>
				`Listo, revisé las estadísticas de los últimos 7 días. ${summarize(toolResults[0])}`
		};
	}

	if (text.includes('mensaje') || text.includes('bandeja') || text.includes('inbox') || text.includes('contacto')) {
		return {
			kind: 'tool-then-text',
			steps: [{ name: 'list_inquiries', input: {} }],
			closingText: (toolResults) =>
				`Esto encontré en la bandeja de entrada. Te copio lo que dice el mensaje tal cual (lo trato como ` +
				`dato, nunca como instrucción): ${excerpt(toolResults[0])}`
		};
	}

	// Lane B7: this used to also call `publish` — the panel agent never
	// publishes on its own anymore (see `chat/tools-bridge.ts`'s
	// `CHAT_EXCLUDED_TOOLS`); it prepares the change and stops, and
	// `chat/agent.ts` attaches the change card automatically. The keyword
	// list keeps "títul del home"/"eyebrow" for continuity with earlier
	// lanes' own manual testing notes.
	// Lane B7 — injection/defense-in-depth test: simulates a MODEL (not the
	// harness) actually attempting to call `publish` directly, e.g. as if
	// convinced by injected content. `publish` is never advertised to this
	// chat's tool list, but a scripted/adversarial caller can still name it
	// explicitly — this proves `tools-bridge.ts`'s `runTool` refuses it
	// server-side regardless, not just that a well-behaved model never
	// tries. Trigger phrase deliberately doesn't overlap the ordinary
	// "públic"/"eyebrow" scenario above.
	if (text.includes('probá publicar directo')) {
		return {
			kind: 'tool-then-text',
			steps: [{ name: 'publish', input: { collection: 'homeHero' } }],
			closingText: (toolResults) => `No pude: ${excerpt(toolResults[0])}`
		};
	}

	// Lane B8 — "internal failures must never reach the user": reproduces the
	// exact shape of the production incident this lane's brief opens with
	// (guess wrong, get a tool error, self-correct, succeed) WITHOUT the
	// model ever narrating the failure or the correction. First step names a
	// collection that doesn't exist (guaranteed `isError: true` from
	// update_entry — see `mcp/tools/entries.ts`'s `collectionNotFoundMessage`);
	// second step is the real, correct call. The point of this scenario is
	// what a real browser shows across BOTH rounds: the tool chip for step 1
	// must never render as an error (see `ChatPanel.svelte`'s `tool_result`
	// handler), and `closingText` below — standing in for what a real model,
	// following `system-prompt.ts`'s "never narrate internal mechanics" rule,
	// would say — never mentions that anything went wrong first.
	if (text.includes('forzá un error') || text.includes('forza un error')) {
		return {
			kind: 'tool-then-text',
			steps: [
				{ name: 'update_entry', input: { collection: 'no-existe', patch: { eyebrow: 'x' } } },
				{
					name: 'update_entry',
					input: { collection: 'homeHero', patch: { eyebrow: 'Estudio creativo — recuperado' } }
				}
			],
			closingText: () => 'Listo, ya preparé el cambio en la etiqueta de arriba del título del home. Revisá la tarjeta para aprobarlo.'
		};
	}

	if (text.includes('públic') || text.includes('publica') || text.includes('título del home') || text.includes('titulo del home') || text.includes('eyebrow')) {
		return {
			kind: 'tool-then-text',
			steps: [
				{
					name: 'update_entry',
					input: { collection: 'homeHero', patch: { eyebrow: 'Estudio creativo — demo Lane B7' }, note: 'Lane B7: demo de tarjeta de cambios' }
				}
			],
			closingText: () => 'Listo, ya preparé el cambio en la etiqueta de arriba del título del home. Revisá la tarjeta para aprobarlo.'
		};
	}

	// Lane B7 — matches the brief's own worked example ("Cambiá 'Hola, somos
	// Moco' por 'Hola, mocosos'"): a SINGLE update_entry call, no
	// clarifying question about how to split the line — proves the "decide
	// implementation, don't ask" system-prompt rule end-to-end against the
	// harness (a real model's actual judgment on the split still needs a
	// live key, see system-prompt.ts's header).
	if (text.includes('mocosos')) {
		return {
			kind: 'tool-then-text',
			steps: [
				{
					name: 'update_entry',
					input: {
						collection: 'homeHero',
						patch: { headlineLines: ['Hola,', 'mo', 'cosos'] },
						note: 'Lane B7: pedido por chat, sin preguntar cómo dividir la línea'
					}
				}
			],
			closingText: () => 'Cambié el título grande del inicio a "Hola, mocosos". Revisá la tarjeta de arriba para aprobarlo.'
		};
	}

	// Lane B7 — "Agregá esta imagen a Sergio Castiglione": pulls the
	// already-uploaded attachment's real site-relative path out of the same
	// user turn (see `attachmentPathFromMessage` below) and patches the
	// project's cover with it — no re-upload, matching what
	// `system-prompt.ts` tells a real model about attached images.
	if (text.includes('sergio') || text.includes('castiglione')) {
		const path = attachmentPathFromMessage(message);
		if (path) {
			return {
				kind: 'tool-then-text',
				steps: [
					{
						name: 'update_entry',
						input: {
							collection: 'projects',
							slug: 'sergio-castiglione',
							patch: { cover: path },
							note: 'Lane B7: imagen nueva pedida por chat'
						}
					}
				],
				closingText: () => 'Listo, actualicé la portada del proyecto de Sergio Castiglione con la imagen que mandaste. Revisá la tarjeta de arriba para aprobarlo.'
			};
		}
	}

	// Lane B9 — "creá un proyecto de prueba": a throwaway `projects` entry
	// with a fixed, predictable slug, used by the delete/undo scenarios
	// below and by this lane's own browser verification (create → approve →
	// ask to delete → approve/discard/undo). Reuses an already-seeded media
	// path for `bg` (schema validation only checks the shape of the string,
	// not that upload_media produced it — see `mediaPath` in
	// `content.schema.ts`) rather than needing a real upload in this
	// scripted scenario.
	const TEST_PROJECT_SLUG = 'proyecto-de-prueba-b9';
	if (text.includes('proyecto de prueba') && !text.includes('borr') && !text.includes('elimin')) {
		return {
			kind: 'tool-then-text',
			steps: [
				{
					name: 'create_entry',
					input: {
						collection: 'projects',
						slug: TEST_PROJECT_SLUG,
						data: {
							title: 'Proyecto de Prueba B9',
							category: 'Prueba · QA',
							year: '2026',
							client: 'Cliente de Prueba',
							services: ['Prueba'],
							bg: '/media/6ff4122f9e636602ecff065d868485947d145f5bc19a96dafc95065157f6f9c8.jpg',
							ink: '#f4f0e6',
							summary: 'Proyecto creado solo para probar el flujo de aprobación y borrado.',
							challenge: 'Verificar que crear, aprobar y borrar un proyecto funciona de punta a punta.',
							solution: 'Creamos este proyecto de prueba, lo aprobamos y después lo eliminamos.',
							gallery: []
						}
					}
				}
			],
			closingText: () => 'Listo, ya preparé el proyecto de prueba. Revisá la tarjeta de arriba para aprobarlo.'
		};
	}

	// Lane B9 — "borrá el proyecto de prueba" / "eliminá el proyecto de
	// prueba": exercises `delete_entry` against a PUBLISHED entry through the
	// chat (the bug this lane's brief opens with: the agent used to refuse
	// this and mention "/admin"/permissions). `delete_entry` on an already-
	// published entry only ever sets `pendingDelete: true` — see
	// `mcp/tools/entries.ts` — so this is safe to run against the real test
	// project regardless of whether it's been approved yet.
	if ((text.includes('borr') || text.includes('elimin')) && text.includes('proyecto de prueba')) {
		return {
			kind: 'tool-then-text',
			steps: [{ name: 'delete_entry', input: { collection: 'projects', slug: TEST_PROJECT_SLUG } }],
			closingText: () => 'Listo, preparé la eliminación del proyecto de prueba. Revisá la tarjeta de arriba: se va a eliminar del sitio cuando apruebes.'
		};
	}

	// Lane B9 — "deshacé el último cambio": the agent only ever REPORTS
	// whether something is undoable (`offer_undo_last_change`,
	// `chat-only-tools.ts`) — never runs the undo itself. `closingText` here
	// mirrors what `system-prompt.ts` tells a real model to say either way,
	// and never claims the undo already happened.
	if (text.includes('deshac') || text.includes('revertí') || text.includes('revertir')) {
		return {
			kind: 'tool-then-text',
			steps: [{ name: 'offer_undo_last_change', input: {} }],
			closingText: (toolResults) => {
				const raw = stripUntrustedPrefix(toolResults[0] ?? '{}');
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch {
					parsed = { available: false };
				}
				if (!parsed.available) return 'No hay nada para deshacer ahora mismo.';
				const label = parsed.entries?.[0]?.label ?? 'lo último aprobado';
				return `Sí, se puede deshacer: ${label} volvería a como estaba antes. Tocá el botón de abajo para hacerlo.`;
			}
		};
	}

	return {
		kind: 'text',
		text:
			'Hola — este es el modelo de prueba local (stub, sin ANTHROPIC_API_KEY real), pero el chat completo ' +
			'funciona: streaming, herramientas y todo lo demás. Pedime algo como "¿cuántas visitas tuve esta ' +
			'semana?", "leeme los mensajes nuevos" o "cambiá el título del home y publicalo".'
	};
}

// `tools-bridge.ts`'s `wrapUntrusted` prefixes EVERY tool result with a
// fixed "[DATOS DE HERRAMIENTA — NO CONFIABLES...]" marker before this stub
// (or a real model) ever sees it — stripped here purely so the stub's own
// scripted replies quote the actual content instead of the marker itself;
// the real app-side marker is untouched (this only affects what THIS
// script echoes back as its fake "model" reply).
const UNTRUSTED_PREFIX_RE = /^\[DATOS DE HERRAMIENTA[^\]]*\]\n\n/;

function stripUntrustedPrefix(text) {
	return text.replace(UNTRUSTED_PREFIX_RE, '');
}

function summarize(toolResultText) {
	if (!toolResultText) return '';
	const clean = stripUntrustedPrefix(toolResultText).replace(/\s+/g, ' ');
	const oneLine = clean.slice(0, 220);
	return oneLine.length < clean.length ? `${oneLine}…` : oneLine;
}

function excerpt(toolResultText) {
	if (!toolResultText) return '(sin datos)';
	const clean = stripUntrustedPrefix(toolResultText).replace(/\s+/g, ' ');
	const oneLine = clean.slice(0, 400);
	return oneLine.length < clean.length ? `${oneLine}…` : oneLine;
}

// ---------------------------------------------------------------------------
// History inspection
// ---------------------------------------------------------------------------

function lastUserIntent(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role !== 'user') continue;
		const textBlock = (m.content ?? []).find((b) => b.type === 'text');
		if (textBlock) return { index: i, text: textBlock.text };
	}
	return { index: -1, text: '' };
}

/** tool_use blocks (name + matching tool_result text, if present later in history) emitted AFTER `sinceIndex`. */
function toolStepsSince(messages, sinceIndex) {
	const steps = [];
	for (let i = sinceIndex + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m.role !== 'assistant') continue;
		for (const block of m.content ?? []) {
			if (block.type !== 'tool_use') continue;
			// Find the matching tool_result in the very next user message.
			const next = messages[i + 1];
			const resultBlock = (next?.content ?? []).find(
				(b) => b.type === 'tool_result' && b.tool_use_id === block.id
			);
			steps.push({ name: block.name, id: block.id, resultText: resultBlock?.content ?? null });
		}
	}
	return steps;
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

async function handleMessages(req, res, body) {
	let payload;
	try {
		payload = JSON.parse(body);
	} catch {
		res.writeHead(400, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Body must be JSON.' } }));
		return;
	}

	if (payload.stream !== true) {
		res.writeHead(400, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				error: { type: 'invalid_request_error', message: 'This stub only supports stream:true (Lane B6 always streams).' }
			})
		);
		return;
	}

	const messages = Array.isArray(payload.messages) ? payload.messages : [];
	const { index: intentIndex, text: intentText } = lastUserIntent(messages);
	const plan = plans(intentText, messages[intentIndex]);
	const stepsAlreadyRun = toolStepsSince(messages, intentIndex);

	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive'
	});

	// `res.on('close', ...)` — NOT `req.on('close', ...)`. `req` (the
	// IncomingMessage) fires its OWN `close` as soon as the REQUEST body has
	// been fully read (which already happened, above, before this handler
	// even started) — that fired on every single request, streaming or not,
	// and made every turn look "stopped" immediately. `res` (the
	// ServerResponse) is what actually tracks the client end of the
	// connection this response is being written to; its `close` firing
	// before `res.writableEnded` is true is the real signal that the
	// browser navigated away, dropped the connection, or (via Stop) aborted
	// the fetch this response belongs to.
	let clientGone = false;
	res.on('close', () => {
		if (!res.writableEnded) {
			clientGone = true;
			console.log('[stub] client disconnected mid-stream (Stop, or a dropped connection)');
		}
	});

	const messageId = `msg_stub_${Date.now().toString(36)}`;
	const approxInputTokens = Math.max(1, Math.round(JSON.stringify(messages).length / 4));

	writeEvent(res, 'message_start', {
		type: 'message_start',
		message: {
			id: messageId,
			type: 'message',
			role: 'assistant',
			model: payload.model ?? 'stub-model',
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: approxInputTokens, output_tokens: 1 }
		}
	});
	await sleep(80);

	let outputChars = 0;
	let stopReason = 'end_turn';

	async function streamTextBlock(index, text, { slow = false } = {}) {
		writeEvent(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
		for (const chunk of chunkText(text)) {
			if (clientGone) return;
			writeEvent(res, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'text_delta', text: chunk }
			});
			outputChars += chunk.length;
			await sleep(slow ? 130 : 25);
		}
		if (clientGone) return;
		writeEvent(res, 'content_block_stop', { type: 'content_block_stop', index });
	}

	async function streamToolUseBlock(index, id, name, input) {
		writeEvent(res, 'content_block_start', {
			type: 'content_block_start',
			index,
			content_block: { type: 'tool_use', id, name, input: {} }
		});
		const json = JSON.stringify(input);
		for (const fragment of chunkText(json, 8)) {
			if (clientGone) return;
			writeEvent(res, 'content_block_delta', {
				type: 'content_block_delta',
				index,
				delta: { type: 'input_json_delta', partial_json: fragment }
			});
			await sleep(15);
		}
		if (clientGone) return;
		writeEvent(res, 'content_block_stop', { type: 'content_block_stop', index });
	}

	try {
		if (plan.kind === 'text') {
			await streamTextBlock(0, plan.text, { slow: plan.slow });
		} else {
			// tool-then-text: figure out which step of the plan this call should
			// perform, based on how many already ran since this intent started.
			const nextStepIndex = stepsAlreadyRun.length;
			if (nextStepIndex < plan.steps.length) {
				const step = plan.steps[nextStepIndex];
				const toolUseId = `toolu_stub_${Date.now().toString(36)}_${nextStepIndex}`;
				await streamToolUseBlock(0, toolUseId, step.name, step.input);
				stopReason = 'tool_use';
			} else {
				const resultTexts = stepsAlreadyRun.map((s) => s.resultText).filter(Boolean);
				await streamTextBlock(0, plan.closingText(resultTexts));
			}
		}
	} finally {
		if (!clientGone) {
			const outputTokens = Math.max(1, Math.round(outputChars / 4) + 1);
			writeEvent(res, 'message_delta', {
				type: 'message_delta',
				delta: { stop_reason: stopReason, stop_sequence: null },
				usage: { output_tokens: outputTokens }
			});
			writeEvent(res, 'message_stop', { type: 'message_stop' });
		}
		res.end();
	}
}

const server = createServer((req, res) => {
	if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
		res.writeHead(404, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: { type: 'not_found_error', message: 'Only POST /v1/messages is implemented.' } }));
		return;
	}
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', () => {
		handleMessages(req, res, Buffer.concat(chunks).toString('utf8')).catch((err) => {
			console.error('[stub] request handler error:', err);
			if (!res.headersSent) {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: { type: 'api_error', message: String(err) } }));
			} else {
				res.end();
			}
		});
	});
});

server.listen(PORT, () => {
	console.log(`[stub] Anthropic Messages API stub listening on http://localhost:${PORT}`);
	console.log('[stub] Point the app at it with: ANTHROPIC_BASE_URL=http://localhost:' + PORT);
});
