/**
 * Monthly spend guard for the admin chat (Lane B5). `CHAT_MONTHLY_BUDGET_USD`
 * (Railway env var) is compared against real spend computed from stored
 * token usage × current pricing (`pricing.ts`) — never a hand-maintained
 * counter that could drift from what Anthropic actually billed.
 *
 * ── Default when unset ───────────────────────────────────────────────────
 * The brief asks for "a safe default, justified" if the env var is unset.
 * Sizing: a small single-client studio site, moderate daily owner usage —
 * say 20 chat turns/day, each turn needing on average 3 model round-trips
 * (the tool-calling loop: read some content, write a change, confirm) with
 * ~3,000 input tokens (system prompt + tool schemas + conversation history)
 * and ~500 output tokens per round-trip:
 *
 *   20 turns × 3 calls × (3000×$2.00/1e6 + 500×$10.00/1e6)
 *   = 60 calls × ($0.006 + $0.005) = 60 × $0.011 ≈ $0.66/day ≈ $20/month
 *
 * $25 leaves headroom above that estimate for a busier day without being
 * large enough to hide a genuinely runaway loop. This is a guess sized for
 * ONE small site, not a number to copy into a busier deployment without
 * re-checking it against real `chat_messages` usage after a month live.
 */

import { and, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { chatMessages } from '../db/schema';

export const DEFAULT_MONTHLY_BUDGET_USD = 25;

export function getMonthlyBudgetUsd(): number {
	const raw = process.env.CHAT_MONTHLY_BUDGET_USD;
	if (!raw) return DEFAULT_MONTHLY_BUDGET_USD;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MONTHLY_BUDGET_USD;
	return parsed;
}

/** Start of the current calendar month, UTC. */
function startOfCurrentMonthUtc(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** Real spend this calendar month (UTC), summed from every priced assistant call. */
export async function monthlySpendUsd(): Promise<number> {
	const rows = await db
		.select({ total: sql<string>`coalesce(sum(${chatMessages.costUsd}), 0)` })
		.from(chatMessages)
		.where(and(gte(chatMessages.createdAt, startOfCurrentMonthUtc()), isNotNull(chatMessages.costUsd)));
	return Number(rows[0]?.total ?? 0);
}

export interface BudgetStatus {
	budgetUsd: number;
	spentUsd: number;
	exceeded: boolean;
}

export async function checkBudget(): Promise<BudgetStatus> {
	const budgetUsd = getMonthlyBudgetUsd();
	const spentUsd = await monthlySpendUsd();
	return { budgetUsd, spentUsd, exceeded: spentUsd >= budgetUsd };
}

/**
 * The exact Spanish copy shown in-chat once the month's budget is used up.
 * Friendly and specific about WHAT stopped (only the chat's own model calls
 * — the brief is explicit that everything else on the site keeps working),
 * never technical (no dollar-cost internals a non-technical client wouldn't
 * parse usefully, beyond the two numbers that explain it).
 */
export function budgetExceededMessage(status: BudgetStatus): string {
	return (
		`Este mes ya se usó el presupuesto disponible para el chat del panel ($${status.spentUsd.toFixed(2)} ` +
		`de $${status.budgetUsd.toFixed(2)}), así que no puedo hacer más consultas a Claude hasta el mes que viene. ` +
		'El resto del sitio (la web pública, y cualquier otro agente conectado por MCP) sigue funcionando con ' +
		'normalidad — esto solo pausa este chat. Si necesitás seguir hoy, pedile a quien administra el sitio que ' +
		'suba CHAT_MONTHLY_BUDGET_USD en Railway.'
	);
}

/**
 * Shown when ANTHROPIC ITSELF refused the call (a rate limit, or the
 * Anthropic workspace's own monthly spend limit — see `anthropic-client.ts`'s
 * `isProviderLimitError`), as opposed to this app's own `CHAT_MONTHLY_BUDGET_USD`
 * guard. Deliberately similar wording/tone to `budgetExceededMessage` (same
 * "this chat is paused, the rest of the site is fine" shape) so a
 * non-technical reader doesn't need to understand the difference between
 * "our soft cap" and "Anthropic's hard cap" to know what to do next — but it
 * never mentions a dollar figure, since this app doesn't know Anthropic's
 * workspace limit or how much of it is used.
 */
export function providerLimitExceededMessage(): string {
	return (
		'Anthropic (el proveedor del modelo que uso) rechazó esta consulta por un límite de uso o de gasto de la ' +
		'cuenta del sitio — no es un error del sitio en sí. El resto del sitio sigue funcionando con normalidad; ' +
		'esto solo pausa este chat. Esperá un momento y probá de nuevo; si sigue pasando, quien administra el sitio ' +
		'debería revisar el límite de gasto del workspace en la cuenta de Anthropic.'
	);
}
