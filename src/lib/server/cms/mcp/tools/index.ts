import { getSiteMapTool } from './site-map';
import { describeCollectionTool } from './describe-collection';
import { entryTools } from './entries';
import { mediaTools } from './media';
import { publishTools } from './publish';
import { inboxTools } from './inbox';
import { analyticsTools } from './analytics';
import type { ToolDefinition } from '../types';

export const allTools: ToolDefinition[] = [
	getSiteMapTool,
	describeCollectionTool,
	...entryTools,
	...mediaTools,
	...publishTools,
	...inboxTools,
	...analyticsTools
];

const byName = new Map(allTools.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
	return byName.get(name);
}
