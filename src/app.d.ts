// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/**
			 * True when this request carried a valid Lane A8 preview token
			 * (`?__preview=<token>`, see `src/hooks.server.ts` and
			 * `src/lib/server/cms/auth/preview-token.ts`). Route `load`
			 * functions read this and pass `{ draft: true }` to
			 * `src/lib/server/cms/content.ts` getters so the page renders
			 * DRAFT content instead of what's actually live.
			 */
			preview: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
