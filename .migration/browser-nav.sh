#!/bin/bash
# .migration/browser-nav.sh
#
# Companion to verify.sh (which now also checks that every route's
# __data.json endpoint is application/json) and resilience.sh. This is the
# THIRD leg: not "does the server answer correctly", but "can a person
# actually click around the site". The production outage this lane responds
# to (SvelteKit's page cache answering a client-navigation `__data.json`
# request with HTML) passed every `curl`-based check that existed at the
# time -- verify.sh's 10-route diff, all six of resilience.sh's checks, 150
# manual `curl` probes during the deploy -- because none of them ever made
# the ONE request shape a real visitor's browser makes on every click after
# the first. This script does: it drives a real, already-installed Chrome
# and clicks through the site the way a visitor would.
#
# Browser choice: `playwright-core` (not the full `playwright` package, and
# not `puppeteer`). `playwright-core` ships zero browser binaries -- it is a
# ~13MB npm package, not a "download a browser" package. Launched with
# `channel: 'chrome'`, it drives the Google Chrome ALREADY installed on the
# machine instead of downloading its own ~300MB bundled Chromium. That
# matters concretely here: this eventually runs on a non-technical
# designer's laptop as a pre-deploy gate, not just in CI, and a 300MB
# download on every fresh checkout (or every time a lockfile forces a
# reinstall) is a real cost for someone who isn't going to know why `npm
# install` suddenly takes five minutes. Google Chrome is a safe assumption
# for that laptop (it is Moco's own daily browser); a machine without it
# gets a clear, actionable error from browser-nav.mjs, not a silent skip.
# The trade-off: this is coupled to Chrome being installed, unlike a fully
# self-contained Playwright/Puppeteer install. For this project's actual
# constraint (dependency weight over hermetic CI reproducibility) that's
# the right trade.
#
# A lighter-than-a-real-browser approach (jsdom, or hand-simulating a
# `fetch` to __data.json) was deliberately rejected for THIS check -- that
# is exactly what the __data.json check in verify.sh already does, cheaply.
# The bug this script exists to catch is specifically in the CLIENT
# ROUTER'S handling of the response (SvelteKit's own `goto`/hydration code,
# running in a real DOM, real event dispatch, real History API) -- no
# simulated-DOM library runs that code path faithfully enough to trust a
# PASS from it. See browser-nav.mjs's header for the full split of what
# each of the two new checks is actually responsible for.
#
# Usage: .migration/browser-nav.sh

set -u
set -o pipefail

PORT=5193
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SERVER_PID=""

cleanup() {
	if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null
		for _ in $(seq 1 20); do
			kill -0 "$SERVER_PID" 2>/dev/null || break
			sleep 0.1
		done
		if kill -0 "$SERVER_PID" 2>/dev/null; then
			kill -9 "$SERVER_PID" 2>/dev/null
		fi
		wait "$SERVER_PID" 2>/dev/null
	fi
}
trap cleanup EXIT INT TERM

if [ -f "$REPO_ROOT/.env" ]; then
	set -a
	# shellcheck disable=SC1091
	source "$REPO_ROOT/.env"
	set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
	echo "DATABASE_URL is not set (checked environment and $REPO_ROOT/.env)."
	echo "Copy .env.example to .env and adjust it, or export DATABASE_URL yourself."
	exit 1
fi

if [ ! -d "$REPO_ROOT/node_modules/playwright-core" ]; then
	echo "playwright-core is not installed. Run: npm install"
	exit 1
fi

echo "==> Building..."
cd "$REPO_ROOT" || exit 1
if ! npm run build; then
	echo "BUILD FAILED"
	exit 1
fi

echo "==> Starting server on port $PORT..."
PORT=$PORT DATABASE_URL="$DATABASE_URL" node build >"$SCRIPT_DIR/.browser-nav-server.log" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 40); do
	if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/" 2>/dev/null | grep -q '^200$'; then
		READY=1
		break
	fi
	sleep 0.5
done

if [ "$READY" -ne 1 ]; then
	echo "SERVER FAILED TO START on port $PORT"
	echo "--- server log ---"
	cat "$SCRIPT_DIR/.browser-nav-server.log"
	exit 1
fi

echo "==> Clicking through the site in a real browser..."
node "$SCRIPT_DIR/browser-nav.mjs" "http://localhost:$PORT"
RESULT=$?

exit $RESULT
