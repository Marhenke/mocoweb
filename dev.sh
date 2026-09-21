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
exec npm run dev -- --port 5180
