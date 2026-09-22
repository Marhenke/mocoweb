/**
 * Shared attachment validation (Lane B7) — used by `Composer.svelte` (file
 * picker, paste) AND `ChatPanel.svelte` (page-wide drop, see its header for
 * why drop handling moved out of the composer). One copy so a file dropped
 * on the message area is held to the exact same rules as one picked or
 * pasted, instead of two rule sets quietly drifting apart.
 *
 * The 8MB/file client-side cap is a UX safety margin, not the real limit —
 * the real one is the server's `BODY_SIZE_LIMIT` (see `.env.example`), sized
 * generously above what a few of these would produce base64-encoded.
 */

export const MAX_ATTACHMENT_FILE_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_ATTACHMENT_TYPES = /^image\/|^video\/(mp4|webm|quicktime)/;

export function validateAttachmentFiles(files: File[]): { ok: File[]; message: string } {
	const ok: File[] = [];
	const problems: string[] = [];
	for (const file of files) {
		if (!ACCEPTED_ATTACHMENT_TYPES.test(file.type)) {
			problems.push(`"${file.name}": tipo de archivo no admitido (solo imágenes o video).`);
			continue;
		}
		if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
			problems.push(`"${file.name}": pesa demasiado (máximo ${MAX_ATTACHMENT_FILE_BYTES / 1024 / 1024}MB).`);
			continue;
		}
		ok.push(file);
	}
	return { ok, message: ok.length > 0 && problems.length === 0 ? '' : problems.join(' ') };
}
