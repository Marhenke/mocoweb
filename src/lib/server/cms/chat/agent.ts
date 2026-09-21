/**
 * The admin chat's conversation loop (Lane B5) — the server-side
 * counterpart to a normal MCP client's `initialize → tools/list →
 * tools/call` loop, except the "client" here is this process itself: every
 * tool call runs in-process through `tools-bridge.ts`, which calls straight
 * into the same `getTool`/handler/scope-check path `/api/mcp` uses. Nothing
 * here talks to `/api/mcp` over HTTP — there is exactly one tool
 * implementation, called two ways (a real MCP request, or this loop).
 *
 * Every message (the user's, each assistant round, each tool-result round)
 * is persisted via `chat/store.ts` AS IT HAPPENS, not batched at the end —
 * so a request that dies mid-loop (a crash, a timeout) leaves a truthful
 * partial transcript instead of losing the turn silently.
 */

import {
	callClaude,
	AnthropicApiError,
	isProviderLimitError,
	type AnthropicContentBlock,
	type AnthropicMessageParam
} from './anthropic-client';
import { toAnthropicTools, runTool } from './tools-bridge';
import { buildSystemPrompt } from './system-prompt';
import { computeCostUsd } from './pricing';
import { checkBudget, budgetExceededMessage, providerLimitExceededMessage } from './budget';
import { appendMessage, listMessages, toMessageParam, type ChatMessageRow } from './store';
import type { ToolContext } from '../mcp/types';

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

async function appendBudgetBlockedReply(
	conversationId: string,
	newRows: ChatMessageRow[],
	text: string
): Promise<RunTurnResult> {
	const row = await appendMessage({
		conversationId,
		role: 'assistant',
		content: [{ type: 'text', text }],
		budgetBlocked: true
	});
	newRows.push(row);
	return { assistantText: text, newRows, budgetBlocked: true };
}

export async function runChatTurn(params: {
	conversationId: string;
	userContent: AnthropicContentBlock[];
	ctx: ToolContext;
}): Promise<RunTurnResult> {
	const newRows: ChatMessageRow[] = [];

	// Checked BEFORE persisting anything model-bound: if the month's budget
	// is already gone, the user's message is still saved (so the transcript
	// isn't silently missing what they asked), but no model call happens.
	const initialBudget = await checkBudget();
	const userRow = await appendMessage({
		conversationId: params.conversationId,
		role: 'user',
		content: params.userContent
	});
	newRows.push(userRow);
	if (initialBudget.exceeded) {
		return appendBudgetBlockedReply(params.conversationId, newRows, budgetExceededMessage(initialBudget));
	}

	const history = await listMessages(params.conversationId);
	const messages: AnthropicMessageParam[] = history.map(toMessageParam);
	const system = buildSystemPrompt({ clientName: params.ctx.clientName, scope: params.ctx.scope });
	const tools = toAnthropicTools();

	for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
		// Re-checked every round trip, not just once at the top: a multi-step
		// tool loop (read, then write, then publish) can cross the monthly
		// line mid-turn, and each of those is a real billed API call.
		const midBudget = await checkBudget();
		if (midBudget.exceeded) {
			return appendBudgetBlockedReply(params.conversationId, newRows, budgetExceededMessage(midBudget));
		}

		let response;
		try {
			response = await callClaude({ system, messages, tools });
		} catch (err) {
			// Anthropic's own rejection (rate limit, or the workspace's monthly
			// spend limit — a hard cap enforced on Anthropic's side, separate
			// from and in addition to this app's own CHAT_MONTHLY_BUDGET_USD
			// soft cap above) gets the same friendly treatment as running out
			// of local budget: never a raw API error surfaced in the chat.
			if (err instanceof AnthropicApiError && isProviderLimitError(err)) {
				return appendBudgetBlockedReply(params.conversationId, newRows, providerLimitExceededMessage());
			}
			throw err;
		}
		const costUsd = computeCostUsd(response.model, response.usage.input_tokens, response.usage.output_tokens);
		const assistantRow = await appendMessage({
			conversationId: params.conversationId,
			role: 'assistant',
			content: response.content,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			costUsd
		});
		newRows.push(assistantRow);
		messages.push({ role: 'assistant', content: response.content });

		if (response.stop_reason !== 'tool_use') {
			return { assistantText: extractText(response.content), newRows, budgetBlocked: false };
		}

		const toolUses = response.content.filter(isToolUseBlock);
		const toolResultBlocks: AnthropicContentBlock[] = [];
		for (const toolUse of toolUses) {
			const outcome = await runTool(toolUse.id, toolUse.name, toolUse.input, params.ctx);
			const text = outcome.result.content.map((c) => c.text).join('\n');
			toolResultBlocks.push({
				type: 'tool_result',
				tool_use_id: outcome.toolUseId,
				content: text,
				is_error: outcome.result.isError ?? false
			});
		}
		const toolResultRow = await appendMessage({
			conversationId: params.conversationId,
			role: 'user',
			content: toolResultBlocks
		});
		newRows.push(toolResultRow);
		messages.push({ role: 'user', content: toolResultBlocks });
	}

	// Hit MAX_TOOL_ITERATIONS without the model reaching a non-tool_use stop
	// — stop here rather than loop forever, and say so instead of just going
	// quiet. No further model call is made (that would defeat the point of
	// the ceiling), so this costs nothing extra.
	const notice =
		'Encadené varios pasos seguidos y preferí frenar acá para no seguir de largo — contame si querés que continúe con el siguiente paso.';
	const noticeRow = await appendMessage({
		conversationId: params.conversationId,
		role: 'assistant',
		content: [{ type: 'text', text: notice }]
	});
	newRows.push(noticeRow);
	return { assistantText: notice, newRows, budgetBlocked: false };
}
