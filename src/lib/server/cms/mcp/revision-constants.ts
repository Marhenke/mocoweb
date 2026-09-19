/**
 * Standalone (zero-import) module so both the app (Vite, extensionless
 * relative imports) and `scripts/seed.ts` (plain `node`, which needs
 * explicit `.ts` extensions — see that file's header comment) can import
 * this one constant without either having to import the other's
 * import-style-incompatible modules.
 */

/** `client_id` used on the one revision per entry that represents its seeded (pre-agent) state — never a real OAuth client id (those are `client_<hex>`, see `auth/tokens.ts`), so it can never collide with one. */
export const SEED_REVISION_CLIENT_ID = 'system:seed';
