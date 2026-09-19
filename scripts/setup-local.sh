#!/bin/bash
# scripts/setup-local.sh
#
# The ONE documented command to get a working local mocoweb from a clean
# checkout, media included: `npm run setup:local`.
#
# Why this needs to exist (Lane B3): the local dev DB had drifted from
# production. `npm run db:seed` seeds from scripts/source-content.ts, which
# still holds the ORIGINAL pre-migration paths (`/projects/racebox/portada.jpg`)
# -- that content predates Lane A5's media migration and was never updated,
# because updating it is exactly scripts/migrate-media.ts's job, run once,
# separately. The problem: migrate-media.ts reads source bytes from
# `static/` on disk, and its own commit (0c521f9) deleted every file it
# migrated out of `static/` once uploaded (see .migration/LANES.md defect
# #21) -- so on a fresh checkout there is nothing left on disk for it to
# read. Re-running `db:seed` (e.g. because a lane needed a clean database)
# silently re-introduces the stale paths with no error, and the missing
# media migration step after it is easy to forget -- exactly what happened
# here. `scripts/migrate-media-from-tag.ts` (this script's last step) closes
# that gap by sourcing the same bytes from the frozen `pre-cms` git tag
# instead of disk, so it works identically on a checkout that has never had
# `static/`'s media in it at all.
#
# Idempotent: every step here (docker compose up, drizzle migrate, the
# seed's upserts, migrate-media-from-tag's content-addressed dedupe) is safe
# to run again on an already-set-up machine.
#
# Usage: npm run setup:local   (or: bash scripts/setup-local.sh)

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || exit 1

echo "==> [1/6] Checking .env..."
if [ ! -f .env ]; then
	cp .env.example .env
	OWNER_KEY_VALUE=$(node scripts/generate-owner-key.ts)
	# BSD sed (macOS) needs the empty '' after -i; this repo's own dev machine
	# is macOS, and the pattern is anchored to the exact "OWNER_KEY=" line
	# .env.example ships, so it doesn't risk touching anything else.
	sed -i '' "s/^OWNER_KEY=$/OWNER_KEY=${OWNER_KEY_VALUE}/" .env
	echo "    Created .env from .env.example with a freshly generated OWNER_KEY."
else
	echo "    .env already exists, leaving it as-is."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is not set in .env. Check .env against .env.example."
	exit 1
fi

echo "==> [2/6] Starting Postgres + SeaweedFS (docker compose)..."
if ! npm run db:up; then
	echo "docker compose failed to start. Is Docker/OrbStack running? Try: open -a OrbStack"
	exit 1
fi

echo "==> [3/6] Waiting for Postgres to accept connections..."
DB_HOST=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)")
DB_PORT=$(node -e "console.log(new URL(process.env.DATABASE_URL).port || 5432)")
READY=0
for _ in $(seq 1 30); do
	if command -v pg_isready >/dev/null 2>&1; then
		pg_isready -d "$DATABASE_URL" >/dev/null 2>&1 && READY=1 && break
	elif (exec 3<>"/dev/tcp/${DB_HOST}/${DB_PORT}") 2>/dev/null; then
		READY=1
		break
	fi
	sleep 1
done
if [ "$READY" -ne 1 ]; then
	echo "Postgres never became reachable at ${DB_HOST}:${DB_PORT}."
	exit 1
fi

echo "==> [4/6] Applying database migrations..."
if ! node scripts/migrate.ts; then
	echo "MIGRATION FAILED"
	exit 1
fi

echo "==> [5/6] Seeding content (collections + entries)..."
if ! node scripts/seed.ts; then
	echo "SEED FAILED"
	exit 1
fi

echo "==> [6/6] Migrating media into the bucket (sourced from the frozen pre-cms tag)..."
if ! node scripts/migrate-media-from-tag.ts; then
	echo "MEDIA MIGRATION FAILED"
	exit 1
fi

echo ""
echo "===================================="
echo "Local setup complete."
echo "  npm run dev        -- start the dev server"
echo "  .migration/verify.sh       -- HTML + data-endpoint gate"
echo "  .migration/browser-nav.sh  -- real-browser click-through gate"
echo "  .migration/resilience.sh   -- dependency-failure gate"
echo "===================================="
