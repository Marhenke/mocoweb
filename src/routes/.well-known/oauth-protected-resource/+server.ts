/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata.
 *
 * This is how an MCP client discovers, after getting a 401 from the
 * protected resource, which Authorization Server to talk to. In this
 * engine the resource server and the authorization server are the same
 * app (see src/lib/server/cms/auth/README semantics in require-auth.ts) —
 * `authorization_servers` just points back at this origin.
 */

import { json } from '@sveltejs/kit';
import { protectedResourceMetadata } from '$lib/server/cms/auth/metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	return json(protectedResourceMetadata(url.origin));
};
