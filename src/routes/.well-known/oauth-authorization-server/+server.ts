/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata. See the protected
 * resource metadata route (`../oauth-protected-resource`) for how the two
 * fit together — this app is both.
 */

import { json } from '@sveltejs/kit';
import { authorizationServerMetadata } from '$lib/server/cms/auth/metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	return json(authorizationServerMetadata(url.origin));
};
