import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter(),

			// SvelteKit's default CSRF guard (production-only) rejects any
			// POST with a form content-type whose Origin header doesn't match
			// this app's own origin. That's the right default for an app with
			// cookie-based sessions, but this app has none: every request
			// (site pages, /media, and the CMS OAuth engine's /authorize,
			// /token, /register) carries its own explicit credential or none
			// at all, never an ambient one a forged cross-site form could
			// piggyback on. The OAuth endpoints in particular are *meant* to
			// be called by arbitrary non-browser MCP clients from any origin
			// (that's the point of Dynamic Client Registration) with
			// application/x-www-form-urlencoded bodies and typically no
			// Origin header at all -- the exact shape this guard exists to
			// block. See src/lib/server/cms/auth/.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
