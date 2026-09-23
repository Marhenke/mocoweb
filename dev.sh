#!/bin/sh
export PATH="/Users/marlenehenke/.nvm/versions/node/v24.17.0/bin:$PATH"
# `vite dev` does NOT load a root .env into process.env on its own (it only
# auto-exposes VITE_*-prefixed vars to import.meta.env) -- this app reads
# DATABASE_URL/BUCKET/OWNER_KEY/etc. straight from process.env (see
# db/client.ts, media/client.ts, auth/keys.ts), same as the built
# adapter-node app in production (Railway injects those directly). Without
# this, every DB/media/auth-touching route 500s in dev with "DATABASE_URL is
# not set" even though .env exists right next to this script.
if [ -f .env ]; then
	set -a
	# shellcheck disable=SC1091
	. ./.env
	set +a
fi
# `cache/regenerate.ts`'s publish-time self-fetch (the "publish must validate
# by rendering" check) calls back into THIS SAME process over loopback using
# `process.env.PORT` (falling back to '3000' if unset) — the exact mechanism
# `adapter-node` production builds already satisfy, because Railway sets
# `PORT` and adapter-node binds to it directly. `vite dev --port 5180` below
# does NOT set `process.env.PORT` just because of that CLI flag (Vite only
# reads it, never writes it back to the environment), so without this line
# every `publish`/`unpublish`/undo in dev self-fetches `127.0.0.1:3000`
# instead of the real `5180` this process is bound to — nothing is listening
# there, the self-fetch fails, and EVERY publish in dev gets refused with
# "rendering failed" and rolled back, even though the write itself was fine.
# Found while testing Lane B9 (Aprobar failing 100% of the time in dev).
export PORT=5180
exec npm run dev -- --port "$PORT"
