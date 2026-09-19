/**
 * Validation for a contact-form submission (Lane B4). This is the first
 * anonymous write path into the system, so every field is bounded — no
 * unbounded text makes it anywhere near Postgres or an outbound email.
 */

import { z } from 'zod';

export const contactSubmissionSchema = z.object({
	name: z.string().trim().min(1, 'Falta el nombre.').max(120, 'El nombre es demasiado largo.'),
	email: z
		.string()
		.trim()
		.min(1, 'Falta el email.')
		.max(254, 'El email es demasiado largo.')
		.email('El email no es válido.'),
	message: z
		.string()
		.trim()
		.min(1, 'Falta el mensaje.')
		.max(5000, 'El mensaje es demasiado largo (máximo 5000 caracteres).')
});

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;

/**
 * The honeypot field's name, shared between the form (`+page.svelte`) and
 * this validation so they can't silently drift. A real visitor never sees
 * or fills this field (see the form's CSS/aria-hidden); anything filled in
 * here is a bot that fills every field it can find.
 */
export const HONEYPOT_FIELD = 'website';

export function isHoneypotTriggered(raw: unknown): boolean {
	return typeof raw === 'object' && raw !== null && Boolean((raw as Record<string, unknown>)[HONEYPOT_FIELD]);
}
