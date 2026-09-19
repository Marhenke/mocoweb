// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		/**
		 * Shape returned by `handleError` (`src/hooks.server.ts`) and read by
		 * `src/routes/+error.svelte`. `message` is always safe to show a
		 * visitor as-is (no stack traces, no internals — see `handleError`'s
		 * doc comment); `errorId` is present only for an unexpected (5xx)
		 * error and is what an operator matches against server logs.
		 */
		interface Error {
			message: string;
			errorId?: string;
		}
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
