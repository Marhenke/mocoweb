/**
 * Spanish (Argentina) time/day formatting for the chat thread (Lane B6) —
 * timestamps on every message, day separators ("Hoy", "Ayer", a date) per
 * the brief. `es-AR` matches the rest of this site's voseo copy.
 */

export function formatTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Hoy" / "Ayer" / a full date — the label for a day separator between messages from different calendar days. */
export function dayLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const now = new Date();
	const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
	if (diffDays === 0) return 'Hoy';
	if (diffDays === 1) return 'Ayer';
	return d.toLocaleDateString('es-AR', {
		day: 'numeric',
		month: 'long',
		year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
	});
}

/** Calendar-day key (local time) — used to decide when to insert a new day separator between two consecutive messages. */
export function dayKey(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
