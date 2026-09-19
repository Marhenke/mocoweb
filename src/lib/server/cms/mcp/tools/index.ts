import { getSiteMapTool } from './site-map';
import { describeCollectionTool } from './describe-collection';
import { entryTools } from './entries';
import { mediaTools } from './media';
import type { ToolDefinition } from '../types';

export const allTools: ToolDefinition[] = [
	getSiteMapTool,
	describeCollectionTool,
	...entryTools,
	...mediaTools
];

const byName = new Map(allTools.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
	return byName.get(name);
}
