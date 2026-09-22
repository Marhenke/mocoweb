/**
 * The admin chat's conversation loop (Lane B5, streaming since Lane B6) —
 * the server-side counterpart to a normal MCP client's
 * `initialize → tools/list → tools/call` loop, except the "client" here is
 * this process itself: every tool call runs in-process through
 * `tools-bridge.ts`, which calls straight into the same
 * `getTool`/handler/scope-check path `/api/mcp` uses. Nothing here talks to
 * `/api/mcp` over HTTP — there is exactly one tool implementation, called
 * two ways (a real MCP request, or this loop).
 *
 * Every message (the user's, each assistant round, each tool-result round)
 * is persisted via `chat/store.ts` AS IT HAPPENS, not batched at the end —
 * so a request that dies mid-loop (a crash, a timeout, a Stop) leaves a
 * truthful partial transcript instead of losing the turn silently.
 *
 * `runChatTurnStream` (below) is the only turn-runner this app calls —
 * there is no non-streaming variant to keep in sync: a prior version of
 * this file had one (a single blocking `callClaude` call per round trip),
 * removed once `/api/chat`'s POST switched to SSE for every request, so
 * there would be exactly one tool-calling loop to reason about rather than
 * two that could quietly drift apart.
 */

import {
	callClaudeStream,
	AnthropicApiError,
	MissingApiKeyError,
	isProviderLimitError,
	isAbortError,
	type AnthropicContentBlock,
	type AnthropicMessageParam
} from './anthropic-client';
import { toAnthropicTools, runTool, toolActivityLabel } from './tools-bridge';
import { buildSystemPrompt } from './system-prompt';
import { computeCostUsd } from './pricing';
import { checkBudget, budgetExceededMessage, providerLimitExceededMessage } from './budget';
import { appendMessage, listMessages, setChangeCard, toMessageParam, type ChatMessageRow } from './store';
import { addPendingEntries, getPendingChange, relocateCard } from './pending-changes';
import { buildChangeCard, type PendingEntryRef } from './change-card';
import type { ToolContext } from '../mcp/types';

/**
 * Lane B7 — pulls a `{collection, slug}` ref out of a successful
 * create_entry/update_entry/delete_entry result, so the entry it touched
 * can be added to the conversation's pending change set (see
 * `pending-changes.ts`). Returns null for anything that isn't one of those
 * three tools, that errored, or — for delete_entry specifically — that
 * deleted a NEVER-published entry outright (there is nothing left to
 * preview/approve/publish for a row that no longer exists; see
 * `entries.ts`'s delete_entry doc comment for the two different shapes it
 * can return). Reads `structuredContent` (the object `textResult` attaches
 * for any non-string result — see `mcp/types.ts`), not the human `content`
 * text, which `tools-bridge.ts`'s `wrapUntrusted` prefixes with the
 * untrusted-data marker.
 */
function extractTouchedRef(name: string, structuredContent: unknown): PendingEntryRef | null {
	if (name !== 'create_entry' && name !== 'update_entry' && name !== 'delete_entry') return null;
	if (!structuredContent || typeof structuredContent !== 'object') return null;
	const obj = structuredContent as Record<string, unknown>;
	const entryLike =
		obj.entry && typeof obj.entry === 'object' ? (obj.entry as Record<string, unknown>) : obj;
	const collection = entryLike.collection;
	const slug = entryLike.slug;
	if (typeof collection !== 'string') return null;
	if (typeof slug !== 'string' && slug !== undefined && slug !== null) return null;
	return { collection, slug: typeof slug === 'string' ? slug : null };
}

/**
 * Builds/updates the ONE change card for whatever this turn (and any prior
 * still-unapproved turn) has touched, and attaches it to `targetRow` —
 * called right before every point `runChatTurnStream` returns with a real
 * persisted final row (normal completion, Stop, the max-iterations notice).
 * A no-op (returns null) when nothing is pending, so a turn that didn't
 * touch content never grows an empty card. See `change-card.ts` /
 * `pending-changes.ts` for what this actually builds and stores.
 */
async function attachChangeCard(params: {
	conversationId: string;
	origin: string;
	touchedThisTurn: PendingEntryRef[];
	targetRow: ChatMessageRow;
}): Promise<{ row: ChatMessageRow; previousCardMessageId: string | null } | null> {
	const before = await getPendingChange(params.conversationId);
	const merged = await addPendingEntries(params.conversationId, params.touchedThisTurn);
	if (merged.length === 0) return null;
	const card = await buildChangeCard(params.origin, merged);
	const previousCardMessageId =
		before?.cardMessageId && before.cardMessageId !== params.targetRow.id ? before.cardMessageId : null;
	await relocateCard(params.conversationId, merged, params.targetRow.id);
	const updated = await setChangeCard(params.targetRow.id, card);
	if (!updated) return null;
	return { row: updated, previousCardMessageId };
}

// Hard ceiling on model round-trips within a single user turn. This is a
// runaway-loop guard, independent of the monthly dollar budget (which is
// also re-checked every iteration below): even inside budget, a tool-calling
// loop that never converges must not run forever against one request.
const MAX_TOOL_ITERATIONS = 8;

interface TextBlock extends AnthropicContentBlock {
	type: 'text';
	text: string;
}
interface ToolUseBlock extends AnthropicContentBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
}

function isTextBlock(block: AnthropicContentBlock): block is TextBlock {
	return block.type === 'text' && typeof block.text === 'string';
}
function isToolUseBlock(block: AnthropicContentBlock): block is ToolUseBlock {
	return block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';
}

function extractText(content: AnthropicContentBlock[]): string {
	return content.filter(isTextBlock).map((b) => b.text).join('\n\n').trim();
}

export interface RunTurnResult {
	assistantText: string;
	/** Every row appended this turn (user message, each assistant/tool round), oldest first — for the client to render without a second fetch. */
	newRows: ChatMessageRow[];
	budgetBlocked: boolean;
}


// ── Streaming (Lane B6) ──────────────────────────────────────────────────

/**
 * Events emitted DURING one call to `runChatTurnStream`, in the order they
 * happen — `routes/api/chat/+server.ts` forwards each one to the browser as
 * an SSE frame roughly 1:1 (see that file for the wire format). Row-bearing
 * events carry a real, already-persisted `ChatMessageRow` — nothing here is
 * speculative or un-saved by the time the browser sees it, so a page reload
 * mid-stream can never show less than what the event stream already
 * promised.
 */
export type AgentStreamEvent =
	| { kind: 'user_message'; row: ChatMessageRow }
	| { kind: 'text_delta'; text: string }
	| { kind: 'tool_start'; id: string; name: string; label: string }
	| { kind: 'tool_result'; id: string; name: string; isError: boolean }
	| { kind: 'assistant_message'; row: ChatMessageRow }
	| { kind: 'stopped'; row: ChatMessageRow }
	| { kind: 'change_card'; row: ChatMessageRow; previousCardMessageId: string | null };

interface StreamedBlock {
	type: string;
	/** Accumulated text, for a `text` block. */
	text: string;
	/** Accumulated raw JSON fragments, for a `tool_use` block's `input`. */
	partialJson: string;
	/** Only set for `tool_use` blocks (known from `content_block_start`). */
	id?: string;
	name?: string;
	complete: boolean;
}

/**
 * Turns the fully-received blocks of one streamed model response into the
 * exact `content` array shape `agent.ts`'s non-streaming path already
 * produces (and that `store.ts`/the Anthropic API itself expect) — a
 * `tool_use` block's `input` is parsed from its accumulated JSON fragments
 * exactly once, here, never mid-stream (Anthropic's own docs are explicit
 * that `input_json_delta` fragments are not valid JSON on their own).
 */
function finalizeBlocks(blocks: Map<number, StreamedBlock>): AnthropicContentBlock[] {
	const out: AnthropicContentBlock[] = [];
	for (const index of [...blocks.keys()].sort((a, b) => a - b)) {
		const block = blocks.get(index)!;
		if (block.type === 'text') {
			out.push({ type: 'text', text: block.text });
		} else if (block.type === 'tool_use') {
			let input: Record<string, unknown> = {};
			if (block.partialJson.trim().length > 0) {
				try {
					input = JSON.parse(block.partialJson) as Record<string, unknown>;
				} catch {
					// Truncated/invalid JSON (should only happen if the stream was
					// cut off — callers only reach finalizeBlocks for a block that
					// completed normally). Falls back to {} so the tool call still
					// runs (and reports its own validation error) instead of
					// crashing the whole turn.
					input = {};
				}
			}
			out.push({ type: 'tool_use', id: block.id, name: block.name, input });
		}
		// Other block types (thinking/signature/etc.) are never requested by
		// this app (no `thinking` param is sent), so none are expected here;
		// if one ever appeared it would simply be dropped, same as this
		// engine already ignores unknown block types elsewhere.
	}
	return out;
}

/** Every `text`-type block's accumulated text so far, joined — used both for the final `assistantText` and for building a coherent partial row on stop/error. */
function textOnly(blocks: Map<number, StreamedBlock>): string {
	return [...blocks.keys()]
		.sort((a, b) => a - b)
		.map((i) => blocks.get(i)!)
		.filter((b) => b.type === 'text')
		.map((b) => b.text)
		.join('\n\n')
		.trim();
}

/**
 * Rough fallback token estimate (~4 chars/token, English/Spanish prose) —
 * used ONLY when the stream was torn down (Stop, or a mid-stream error)
 * before Anthropic's own `message_delta.usage.output_tokens` arrived, so
 * `budget.ts`'s monthly guard still counts real generated text instead of
 * silently recording $0 for it. Deliberately rounds UP (`Math.ceil`): the
 * budget guard's whole guarantee is that spend is never under-counted (see
 * `pricing.ts`'s header for the same principle applied to an unknown
 * model), and stopping generation early must not become a way to make a
 * turn look free.
 */
function estimateOutputTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

async function persistInterrupted(params: {
	conversationId: string;
	blocks: Map<number, StreamedBlock>;
	inputTokens: number;
	model: string;
}): Promise<ChatMessageRow> {
	const text = textOnly(params.blocks);
	const outputTokens = estimateOutputTokens(text);
	const costUsd = computeCostUsd(params.model, params.inputTokens, outputTokens);
	// Deliberately drops every tool_use block (complete or not) — see this
	// function's callers and the `stopped` column's doc comment in
	// db/schema.ts: an assistant row with an unpaired tool_use would make the
	// NEXT call to the Anthropic API with this history invalid (400: every
	// tool_use needs a following tool_result). Text is always safe to keep
	// as-is, even mid-sentence.
	return appendMessage({
		conversationId: params.conversationId,
		role: 'assistant',
		content: [{ type: 'text', text }],
		inputTokens: params.inputTokens,
		outputTokens,
		costUsd,
		stopped: true
	});
}

export async function runChatTurnStream(params: {
	conversationId: string;
	userContent: AnthropicContentBlock[];
	ctx: ToolContext;
	signal: AbortSignal;
	onEvent: (event: AgentStreamEvent) => void;
}): Promise<RunTurnResult> {
	const newRows: ChatMessageRow[] = [];
	const emit = params.onEvent;
	// Lane B7 — every entry touched by a successful create_entry/
	// update_entry/delete_entry call THIS turn (can be more than one round
	// of tool calls) — merged into the conversation's pending change set
	// and turned into a change card right before this function returns. See
	// `attachChangeCard` above and its call sites below.
	const touchedThisTurn: PendingEntryRef[] = [];
	async function finalizeCard(targetRow: ChatMessageRow): Promise<void> {
		const result = await attachChangeCard({
			conversationId: params.conversationId,
			origin: params.ctx.origin,
			touchedThisTurn,
			targetRow
		});
		if (result) emit({ kind: 'change_card', row: result.row, previousCardMessageId: result.previousCardMessageId });
	}

	const initialBudget = await checkBudget();
	const userRow = await appendMessage({
		conversationId: params.conversationId,
		role: 'user',
		content: params.userContent
	});
	newRows.push(userRow);
	emit({ kind: 'user_message', row: userRow });
	if (initialBudget.exceeded) {
		const text = budgetExceededMessage(initialBudget);
		const row = await appendMessage({
			conversationId: params.conversationId,
			role: 'assistant',
			content: [{ type: 'text', text }],
			budgetBlocked: true
		});
		newRows.push(row);
		emit({ kind: 'assistant_message', row });
		return { assistantText: text, newRows, budgetBlocked: true };
	}

	const history = await listMessages(params.conversationId);
	const messages: AnthropicMessageParam[] = history.map(toMessageParam);
	const system = buildSystemPrompt({ clientName: params.ctx.clientName, scope: params.ctx.scope });
	const tools = toAnthropicTools();

	for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
		if (params.signal.aborted) {
			// Stopped between rounds (e.g. right after a tool result, before the
			// next model call) — nothing in-flight to salvage, just say so.
			const text = 'Generación detenida.';
			const row = await appendMessage({
				conversationId: params.conversationId,
				role: 'assistant',
				content: [{ type: 'text', text }],
				stopped: true
			});
			newRows.push(row);
			emit({ kind: 'stopped', row });
			await finalizeCard(row);
			return { assistantText: text, newRows, budgetBlocked: false };
		}

		const midBudget = await checkBudget();
		if (midBudget.exceeded) {
			const text = budgetExceededMessage(midBudget);
			const row = await appendMessage({
				conversationId: params.conversationId,
				role: 'assistant',
				content: [{ type: 'text', text }],
				budgetBlocked: true
			});
			newRows.push(row);
			emit({ kind: 'assistant_message', row });
			return { assistantText: text, newRows, budgetBlocked: true };
		}

		const blocks = new Map<number, StreamedBlock>();
		let model = '';
		let inputTokens = 0;
		let outputTokens: number | null = null;
		let stopReason: string | null = null;

		try {
			for await (const event of callClaudeStream({ system, messages, tools }, params.signal)) {
				switch (event.type) {
					case 'message_start':
						model = event.message.model;
						inputTokens = event.message.usage.input_tokens;
						break;
					case 'content_block_start': {
						const cb = event.content_block as { type: string; id?: string; name?: string; text?: string };
						blocks.set(event.index, {
							type: cb.type,
							text: cb.text ?? '',
							partialJson: '',
							id: cb.id,
							name: cb.name,
							complete: false
						});
						if (cb.type === 'tool_use' && cb.id && cb.name) {
							emit({ kind: 'tool_start', id: cb.id, name: cb.name, label: toolActivityLabel(cb.name) });
						}
						break;
					}
					case 'content_block_delta': {
						const block = blocks.get(event.index);
						if (!block) break;
						if (event.delta.type === 'text_delta' && 'text' in event.delta) {
							const deltaText = (event.delta as { text: string }).text;
							block.text += deltaText;
							emit({ kind: 'text_delta', text: deltaText });
						} else if (event.delta.type === 'input_json_delta' && 'partial_json' in event.delta) {
							block.partialJson += (event.delta as { partial_json: string }).partial_json;
						}
						break;
					}
					case 'content_block_stop': {
						const block = blocks.get(event.index);
						if (block) block.complete = true;
						break;
					}
					case 'message_delta':
						stopReason = event.delta.stop_reason;
						outputTokens = event.usage.output_tokens;
						break;
					default:
						break;
				}
			}
		} catch (err) {
			if (isAbortError(err) || params.signal.aborted) {
				const row = await persistInterrupted({
					conversationId: params.conversationId,
					blocks,
					inputTokens,
					model: model || 'unknown'
				});
				newRows.push(row);
				emit({ kind: 'stopped', row });
				await finalizeCard(row);
				return { assistantText: textOnly(blocks), newRows, budgetBlocked: false };
			}
			if (err instanceof MissingApiKeyError) throw err;
			if (err instanceof AnthropicApiError && isProviderLimitError(err)) {
				const text = providerLimitExceededMessage();
				const row = await appendMessage({
					conversationId: params.conversationId,
					role: 'assistant',
					content: [{ type: 'text', text }],
					budgetBlocked: true
				});
				newRows.push(row);
				emit({ kind: 'assistant_message', row });
				return { assistantText: text, newRows, budgetBlocked: true };
			}
			// Any other API failure mid-stream (e.g. an `overloaded_error` SSE
			// event) — if some text had already reached the browser, persist it
			// (same coherence rule as a user Stop: never lose what was already
			// shown) rather than silently discarding it, then let the failure
			// propagate so +server.ts's existing catch-all still shows the
			// friendly "hubo un problema" banner for THIS turn.
			if (textOnly(blocks).length > 0) {
				const row = await persistInterrupted({
					conversationId: params.conversationId,
					blocks,
					inputTokens,
					model: model || 'unknown'
				});
				newRows.push(row);
			}
			throw err;
		}

		const content = finalizeBlocks(blocks);
		const finalOutputTokens = outputTokens ?? estimateOutputTokens(textOnly(blocks));
		const costUsd = computeCostUsd(model || 'unknown', inputTokens, finalOutputTokens);
		const assistantRow = await appendMessage({
			conversationId: params.conversationId,
			role: 'assistant',
			content,
			inputTokens,
			outputTokens: finalOutputTokens,
			costUsd
		});
		newRows.push(assistantRow);
		emit({ kind: 'assistant_message', row: assistantRow });
		messages.push({ role: 'assistant', content });

		if (stopReason !== 'tool_use') {
			await finalizeCard(assistantRow);
			return { assistantText: extractText(content), newRows, budgetBlocked: false };
		}

		const toolUses = content.filter(isToolUseBlock);
		const toolResultBlocks: AnthropicContentBlock[] = [];
		for (const toolUse of toolUses) {
			const outcome = await runTool(toolUse.id, toolUse.name, toolUse.input, params.ctx);
			emit({ kind: 'tool_result', id: outcome.toolUseId, name: outcome.name, isError: outcome.result.isError ?? false });
			const text = outcome.result.content.map((c) => c.text).join('\n');
			toolResultBlocks.push({
				type: 'tool_result',
				tool_use_id: outcome.toolUseId,
				content: text,
				is_error: outcome.result.isError ?? false
			});
			// Lane B7 — track what this call touched for the change card, see
			// `extractTouchedRef` above. Only ever reads `structuredContent`
			// (never the untrusted-wrapped text), and only for a call that
			// actually succeeded.
			if (!outcome.result.isError) {
				const ref = extractTouchedRef(outcome.name, outcome.result.structuredContent);
				if (ref) touchedThisTurn.push(ref);
			}
		}
		const toolResultRow = await appendMessage({
			conversationId: params.conversationId,
			role: 'user',
			content: toolResultBlocks
		});
		newRows.push(toolResultRow);
		messages.push({ role: 'user', content: toolResultBlocks });
	}

	const notice =
		'Encadené varios pasos seguidos y preferí frenar acá para no seguir de largo — contame si querés que continúe con el siguiente paso.';
	const noticeRow = await appendMessage({
		conversationId: params.conversationId,
		role: 'assistant',
		content: [{ type: 'text', text: notice }]
	});
	newRows.push(noticeRow);
	emit({ kind: 'assistant_message', row: noticeRow });
	await finalizeCard(noticeRow);
	return { assistantText: notice, newRows, budgetBlocked: false };
}
