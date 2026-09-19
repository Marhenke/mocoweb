/**
 * Pure classification helpers for first-party analytics (Lane B4): is this
 * request a bot, what kind of device is it likely from, and what referrer
 * bucket does it belong to. Deliberately heuristic, not a compliance-grade
 * bot list — the brief's actual requirement is "the owner doesn't get
 * excited about traffic that doesn't exist," not "detect every bot ever
 * written." Where a request is ambiguous (no User-Agent at all, e.g.),
 * this errs toward EXCLUDING it from counts rather than including it —
 * real browsers essentially always send a UA, so the false-negative cost
 * (a genuine visit not counted) is far smaller than the false-positive cost
 * (phantom traffic the owner starts making decisions from).
 */

/**
 * Matches the user agent substrings of search/social/AI crawlers and
 * generic HTTP clients/scripts that show up hitting a small public site in
 * practice. Case-insensitive.
 */
const BOT_UA_PATTERN =
	/bot|spider|crawl|slurp|facebookexternalhit|whatsapp|telegram|discordbot|slack|preview|headless|phantomjs|puppeteer|playwright|selenium|curl|wget|python-requests|python-urllib|go-http-client|java\/|libwww|http[.-]?client|axios|node-fetch|scrapy|monitor|pingdom|uptimerobot|gptbot|claude-?web|claudebot|anthropic|ccbot|perplexity|bytespider|semrush|ahrefs|mj12bot|dotbot|petalbot|applebot/i;

export function isBotRequest(userAgent: string | null): boolean {
	if (!userAgent || userAgent.trim().length === 0) return true; // see file header: ambiguous → excluded
	return BOT_UA_PATTERN.test(userAgent);
}

export type DeviceBucket = 'mobile' | 'tablet' | 'desktop' | 'other';

export function classifyDevice(userAgent: string | null): DeviceBucket {
	if (!userAgent) return 'other';
	if (/ipad|tablet(?!.*mobile)/i.test(userAgent)) return 'tablet';
	if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return 'mobile';
	if (/mozilla|chrome|safari|firefox|edg\//i.test(userAgent)) return 'desktop';
	return 'other';
}

/**
 * Normalizes a `Referer` header down to a coarse host bucket — never the
 * full referring URL (which can itself carry identifying query params,
 * e.g. an email campaign's tracking parameters). `requestOrigin` lets a
 * same-site referrer (an in-app navigation SvelteKit still sent a Referer
 * for) collapse to "internal" rather than counting as "traffic from
 * mocoestudio.com".
 */
export function classifyReferrer(referer: string | null, requestOrigin: string): string {
	if (!referer) return 'direct';
	try {
		const url = new URL(referer);
		const requestHost = new URL(requestOrigin).hostname;
		const host = url.hostname.replace(/^www\./, '').toLowerCase();
		if (host === requestHost.replace(/^www\./, '').toLowerCase()) return 'internal';
		return host || 'direct';
	} catch {
		return 'direct';
	}
}
