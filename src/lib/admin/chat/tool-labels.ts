/**
 * Client-side mirror of `chat/tools-bridge.ts`'s `TOOL_ACTIVITY_LABELS`
 * (Lane B6) — used only as a fallback when rebuilding bubbles from loaded
 * HISTORY (`ChatPanel.svelte`'s `rowsToBubbles`), where no live `tool_start`
 * SSE event (which already carries the server's own label) exists to read
 * from. Kept intentionally small and duplicated rather than shared over the
 * wire on every history load — if the two drift, the only symptom is a
 * slightly less specific label on an OLD tool call after a reload, never a
 * broken one (`toolActivityLabelFallback` always returns something
 * readable).
 */
const LABELS: Record<string, string> = {
	get_site_map: 'Revisando la estructura del sitio',
	describe_collection: 'Revisando cómo está armada esta sección',
	list_entries: 'Leyendo el contenido',
	get_entry: 'Leyendo el contenido',
	create_entry: 'Creando contenido nuevo',
	update_entry: 'Editando el contenido',
	delete_entry: 'Borrando contenido',
	reorder_entries: 'Reordenando el contenido',
	upload_media: 'Subiendo la imagen',
	list_media: 'Revisando la biblioteca de medios',
	publish: 'Publicando los cambios en el sitio',
	unpublish: 'Despublicando',
	list_revisions: 'Revisando el historial de cambios',
	rollback: 'Restaurando una versión anterior',
	preview_url: 'Generando el link de vista previa',
	query_analytics: 'Revisando las estadísticas de visitas',
	list_inquiries: 'Leyendo los mensajes de contacto',
	get_inquiry: 'Leyendo el mensaje de contacto',
	mark_inquiry_read: 'Marcando el mensaje como leído'
};

export function toolActivityLabelFallback(name: string): string {
	return LABELS[name] ?? `Usó la herramienta "${name}"`;
}
