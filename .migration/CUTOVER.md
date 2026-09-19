# Cutover plan — mocoweb CMS migration (Lane A9)

**Status when this was written: NOT executed.** Everything below describes what
a human operator should do, in order, after reviewing this document — no step
here has been run against the live site. The Railway `mocoweb` project now
has the new Postgres database and the new Bucket provisioned and fully
populated (see the A9 report), and the `mocoweb` app service has the eight
new environment variables set (`DATABASE_URL`, `BUCKET`, `ENDPOINT`,
`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`, `ORIGIN`, `OWNER_KEY`), but
the service is **still running the old, pre-CMS code** — the variables were
set with `--skip-deploys` specifically so nothing about the live site changed
yet. Going live is a separate, later decision.

## 0. Preconditions to check before starting

- [ ] `.migration/verify.sh` passes against `cms-migration` locally (or against
      whatever commit is about to be deployed) — this is the gate that proves
      no visible regression versus the frozen `pre-cms` baseline.
- [ ] The Railway Postgres and Bucket are already populated (they are, as of
      this writing — see the A9 report for the verification results). If any
      significant time has passed, re-run the checks in step 6 below before
      cutting over, in case someone has since exercised the MCP tools against
      that database in a way that matters.
- [ ] Someone has actually read this document, end to end, including the
      irreversibility notes.

## 1. Order of operations, and why

The core constraint: **the new code cannot serve a single page correctly
until the database and bucket already contain the content** — there is no
lazy fallback that builds content on first request. A `+page.server.ts` that
queries Postgres for a collection that doesn't exist yet returns nothing, and
media URLs (`/media/<key>`) 404 until the object is actually in the bucket.
Deploying code before data is the one sequencing mistake that takes the
running site down instead of just failing to improve it — a visitor mid-load
would get a working old page one second and a broken new one the next.

That ordering constraint is already satisfied: **data first, deploy second**,
which is why this lane provisioned and populated the database and bucket
*before* touching the app service's source at all. So the remaining order is:

1. **Freeze writes.** Confirm no one is actively editing content through the
   MCP tools against the *local* dev database in a way that should carry over
   — this migration's seed came from `scripts/source-content.ts`, the
   original hardcoded content, not from any local draft edits made while
   exercising A7/A8's tools. If real content changes happened only through
   local MCP testing and were meant to ship, they are not in the Railway
   database and must be re-applied there (via the MCP tools, against
   production, after cutover) — they do not need to block cutover itself.

2. **Point the app service at the new code.** This is the one truly
   irreversible-feeling step from the outside (see rollback, below, for why
   it's actually not): update the `mocoweb` service's connected branch /
   trigger a deploy of the `cms-migration` code (merged to whatever branch
   the service deploys from — currently `main`). Because `DATABASE_URL`,
   `BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION`,
   `ORIGIN`, and `OWNER_KEY` are already set on the service, the new code has
   everything it needs the moment it starts — no second deploy required to
   "finish configuring" it.

3. **Watch the deploy.** `node build` starts a fresh adapter-node process;
   Railway's `ON_FAILURE` restart policy (10 retries) covers a crash-on-boot,
   but that only helps if the *previous* deploy is still healthy to fall back
   to — Railway does not automatically roll back a bad deploy on its own.
   Watch `railway logs` during and immediately after this deploy.

4. **Verify immediately** (step 2 below) before announcing anything is done.

## 2. Health checks immediately after cutover

Run these against `https://mocoestudio.com`, in this order:

1. **Home page loads and renders real content.** `curl -s -o /dev/null -w
   '%{http_code}\n' https://mocoestudio.com/` should be `200`. Spot-check the
   text against what's in the database, not just "a page came back" — a
   500 that SvelteKit renders as a styled error page can still return 200
   from a naive check.
2. **A project detail page with media loads**, e.g.
   `https://mocoestudio.com/trabajos/racebox`, and at least one image/video
   on it actually resolves (not a broken `/media/...` link — check the
   network tab or `curl -I` a couple of the `/media/<key>` URLs referenced in
   that page's HTML for `200`).
3. **OAuth discovery is well-formed**, since ORIGIN correctness only shows up
   here: `curl -s https://mocoestudio.com/.well-known/oauth-authorization-server`
   and confirm every URL in the JSON starts with `https://mocoestudio.com`,
   not `http://` and not some other host. This is exactly the class of bug
   A6 documented — it fails silently (the JSON still parses, the URLs are
   just wrong) unless someone checks the string values.
4. **Run `.migration/verify.sh` against production**, not localhost, if a
   variant that targets a remote base URL is prepared beforehand — the
   version in this repo currently only drives a locally-started `node build`.
   Adapting it to hit `https://mocoestudio.com` instead of spawning a local
   server is worth doing before cutover, not during an incident.
5. **Confirm the previously-live routes still 200**, at minimum the 10 routes
   `.migration/baseline/` covers.

If any of 1–3 fails, do not wait for a full investigation before rolling
back — see below.

## 3. Rollback

**This is genuinely simple and safe, which is the main thing this migration
had going for it from the start:** the *old* code and the *old* running
process are not being modified or deleted by this cutover. Rolling back is:

- **Re-deploy the previous, pre-migration commit/image to the `mocoweb`
  service** (Railway keeps deployment history; redeploying an older
  successful deployment is a supported, ordinary action, not a special
  recovery procedure). The old code never reads any of the eight new
  environment variables, so their presence after rollback is inert, exactly
  as it is right now before cutover.
- This is **not** destructive: the new Postgres database and bucket are
  untouched by a rollback. Nothing about rolling back the app service loses
  data — the CMS content stays exactly where it is, ready for the next
  cutover attempt once the underlying issue is fixed.
- The one thing rollback does **not** undo: any edits made through the MCP
  tools against production *after* cutover and *before* the rollback (e.g. an
  agent published a change during the window the new code was live). Those
  changes live in the new Postgres database, not in the old code path, so
  the old code simply won't reflect them. If that matters, check
  `list_revisions` / the `revisions` table for anything written in that
  window before deciding whether to re-apply it once cutover is retried.
- **Nothing in this migration deletes or drops the old data path** — there
  is no old data path; the pre-CMS site never had a database. So there is
  no "restore the old database" step, because there was never one.

## 4. What the owner must do afterward

- **Where `OWNER_KEY` lives now:** only in the `mocoweb` Railway service's
  environment variables (set by this lane, value generated by
  `scripts/generate-owner-key.ts` — a CSPRNG output, never hand-typed). It is
  not committed anywhere, not in `.env` (that file holds the *local dev*
  key, a different value from a different `generate-owner-key.ts` run), and
  not printed in this document on purpose.
- **How it's handed to the client (the MCP-connecting agent, e.g. Claude
  Desktop or Codex):** read it once from the Railway dashboard's Variables
  tab for the `mocoweb` service (or `railway variables --service mocoweb
  --kv`, which prints raw values — treat that output as a secret, not
  something to paste into a shared doc or chat log) and paste it into
  whatever credential field that MCP client uses to authenticate against
  `https://mocoestudio.com`. It is the *only* credential in the system —
  there are no separate user accounts.
- **How to rotate it if leaked:** generate a new one
  (`node scripts/generate-owner-key.ts`) and set it as the `OWNER_KEY`
  variable on the `mocoweb` service. Every JWT signing key and refresh-token
  hash key is derived from `OWNER_KEY` via HKDF, so the moment the running
  process picks up the new value (which — unlike the `--skip-deploys` used
  during this lane's setup — **will** restart the live service, since at
  that point it's the production app actually reading the variable), every
  previously issued access and refresh token stops working instantly. No
  separate revocation step, no waiting for expiry. This is a real, brief
  (single-instance, `numReplicas: 1`) restart of the live site — expect a
  short blip while the new process boots, the same as any other deploy.

## 5. Known post-cutover behavior (not a bug)

- **The page cache is empty at cutover and fills only on publish, never
  lazily** (`src/lib/server/cms/cache/store.ts`, `hooks.server.ts`). Every
  route serves straight from Postgres (a live SvelteKit render) until the
  first `publish` call for that collection populates the cache. This is
  correct behavior, not a sign anything is broken — expect normal, uncached
  response times immediately after cutover, improving only after an agent
  publishes something. If instant caching of the current content is
  desired, the owner (or the next agent session) can trigger one no-op
  `publish` per collection right after cutover specifically to warm the
  cache — that's an intentional action to consider taking, not an automatic
  side effect of deploying.

## 6. What this document does not cover

Deciding *when* to cut over, and getting sign-off from whoever owns
`mocoestudio.com`, are both outside this document's scope on purpose — this
lane's brief is explicit that the go-live decision is separate and belongs to
the site's owner.
