import type { Scope } from '../auth/scope';

export interface ToolContext {
	clientId: string;
	clientName: string | null;
	scope: Scope;
}

export interface ToolTextContent {
	type: 'text';
	text: string;
}

/** Shape of a `tools/call` result, per MCP's CallToolResult. */
export interface ToolResult {
	content: ToolTextContent[];
	isError?: boolean;
	/** Machine-readable mirror of `content[0].text`, for clients that read it directly. */
	structuredContent?: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	/** Minimum scope required to call this tool ('write' implies 'read'). */
	scope: Scope;
	/** JSON Schema for the tool's input, per MCP's Tool.inputSchema. */
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function textResult(value: unknown, isError = false): ToolResult {
	const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	return {
		content: [{ type: 'text', text }],
		isError,
		...(typeof value === 'string' ? {} : { structuredContent: value })
	};
}
