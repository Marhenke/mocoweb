/**
 * The admin panel's fixed, first-party OAuth `client_id` (Lane B5 follow-up).
 *
 * Deliberately NOT under `$lib/server/` — this exact string is shared by
 * both sides of the flow: the browser (`oauth-client.ts`, which sends it as
 * `client_id` on every /authorize and /token call) and the server
 * (`auth/internal-client.ts`, which is what actually decides trust). That
 * split is safe because a `client_id` is a public identifier, never a
 * secret (see `routes/register/+server.ts`'s header) — sharing the STRING
 * grants nothing by itself.
 *
 * What actually makes the panel's full-access grant unspoofable is that
 * this id can never be produced by `POST /register` (Dynamic Client
 * Registration always mints a fresh random id — see `tokens.ts`'s
 * `registerClient`, which never accepts a caller-supplied id) — so no
 * external registration, however it names itself or whatever redirect_uri
 * it chooses, can ever collide with this constant. The server-side check
 * in `auth/internal-client.ts` additionally pins the exact redirect_uri
 * this id is allowed to use, so even a hypothetical future bug that let a
 * DCR call choose its own id still couldn't complete the flow without
 * controlling the site's own `/admin` redirect target.
 */
export const INTERNAL_PANEL_CLIENT_ID = 'client_internal_admin_panel';
