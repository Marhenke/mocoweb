/**
 * Model selection + pricing table for the admin chat (Lane B5).
 *
 * ── Model is an env var, never hardcoded ─────────────────────────────────
 * `CHAT_MODEL` (Railway env var) picks the model, so the owner can run
 * every client site on a cheap default and bump individual sites to a
 * stronger model with no code change or redeploy of this file. Default:
 * Claude Haiku 4.5 (`claude-haiku-4-5`) — NOT a date-suffixed id like
 * `claude-haiku-4-5-20251001`. Verified against Anthropic's current model
 * list while building this lane: current model ids have no date suffix
 * (that convention was retired); the exact string is `claude-haiku-4-5`. An
 * env var set to an old date-suffixed id, or to a model this table doesn't
 * know about, still works for billing purposes — see `priceFor` below.
 *
 * ── Pricing table, not a single constant ─────────────────────────────────
 * Every model this chat might realistically be pointed at gets its own
 * verified per-token rate (checked against Anthropic's current pricing
 * while building this lane, first-party API rates). If `CHAT_MODEL` names a
 * model NOT in this table (a brand-new release, or a typo), spend is priced
 * at the MOST EXPENSIVE known rate rather than guessed low or treated as
 * free — `budget.ts`'s whole guarantee is that spend is never
 * under-counted, and silently charging $0 (or some arbitrary low default)
 * for an unrecognized model would violate that. A warning is logged once
 * per unrecognized model id so this gets noticed and the table gets a real
 * entry, not left silently over-billing forever.
 */

export const DEFAULT_CHAT_MODEL = 'claude-haiku-4-5';

export function getChatModel(): string {
	const raw = process.env.CHAT_MODEL?.trim();
	return raw && raw.length > 0 ? raw : DEFAULT_CHAT_MODEL;
}

interface ModelPrice {
	inputPerMtok: number;
	outputPerMtok: number;
}

/** $/MTok, input then output. First-party Anthropic API rates. */
const KNOWN_MODEL_PRICES: Record<string, ModelPrice> = {
	'claude-haiku-4-5': { inputPerMtok: 1.0, outputPerMtok: 5.0 },
	'claude-sonnet-5': { inputPerMtok: 2.0, outputPerMtok: 10.0 },
	'claude-sonnet-4-6': { inputPerMtok: 3.0, outputPerMtok: 15.0 },
	'claude-opus-5': { inputPerMtok: 5.0, outputPerMtok: 25.0 },
	'claude-opus-4-8': { inputPerMtok: 5.0, outputPerMtok: 25.0 },
	'claude-opus-4-7': { inputPerMtok: 5.0, outputPerMtok: 25.0 },
	'claude-opus-4-6': { inputPerMtok: 5.0, outputPerMtok: 25.0 },
	'claude-fable-5': { inputPerMtok: 10.0, outputPerMtok: 50.0 },
	'claude-fable-5-1': { inputPerMtok: 10.0, outputPerMtok: 50.0 },
	'claude-mythos-5-1': { inputPerMtok: 10.0, outputPerMtok: 50.0 }
};

const MOST_EXPENSIVE_KNOWN_PRICE: ModelPrice = Object.values(KNOWN_MODEL_PRICES).reduce((max, p) =>
	p.outputPerMtok > max.outputPerMtok ? p : max
);

// Logged at most once per unrecognized model id per process, so a chatty
// conversation doesn't spam the logs for the same already-known gap.
const warnedModels = new Set<string>();

function priceFor(model: string): ModelPrice {
	const known = KNOWN_MODEL_PRICES[model];
	if (known) return known;
	if (!warnedModels.has(model)) {
		warnedModels.add(model);
		console.warn(
			JSON.stringify({
				at: 'chat/pricing:priceFor',
				message:
					`Unrecognized CHAT_MODEL "${model}" — no verified price on file. Billing this model's spend at ` +
					`the most expensive known rate ($${MOST_EXPENSIVE_KNOWN_PRICE.inputPerMtok}/$${MOST_EXPENSIVE_KNOWN_PRICE.outputPerMtok} ` +
					'per MTok in/out) so the monthly budget guard never under-counts real spend. Add a verified entry ' +
					'for this model to KNOWN_MODEL_PRICES in src/lib/server/cms/chat/pricing.ts.'
			})
		);
	}
	return MOST_EXPENSIVE_KNOWN_PRICE;
}

/** Cost in USD for one API call's token usage, priced for the model that actually served it. */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
	const price = priceFor(model);
	return (inputTokens / 1_000_000) * price.inputPerMtok + (outputTokens / 1_000_000) * price.outputPerMtok;
}
