#!/bin/bash
# .migration/verify.sh
#
# Rebuilds the site, serves it on PORT, captures the same 10 routes used for
# the reference baseline, normalizes away known build-to-build / render-to-render
# noise, and diffs against .migration/baseline/. Prints a PASS/FAIL summary.
#
# Usage: .migration/verify.sh   (run from anywhere; paths are resolved below)
#
# Baseline history (Lane B1 re-baseline):
#   .migration/baseline/          -- CURRENT reference, what this script reads.
#   .migration/baseline-pre-cms/  -- the ORIGINAL pre-CMS-migration baseline
#     (tag `pre-cms`), preserved verbatim as a historical reference per the
#     Lane B1 brief. It proved the CMS migration (Lanes A1-A9) lost nothing.
#     It is no longer read by this script -- do not point BASELINE_DIR back
#     at it, and do not delete it.
#   Lane B1 (agent discovery: llms.txt, sitemap.xml, JSON-LD, <link rel>)
#   legitimately changed the rendered HTML of all 10 routes (a new <link
#   rel="mcp-server"> and JSON-LD <script> tag on every page), so the
#   pre-cms baseline stopped being the right comparison target -- see
#   LANES.md for the full list of Lane B1 diffs this re-baseline absorbed.

set -u
set -o pipefail

PORT=5190
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE_DIR="$SCRIPT_DIR/baseline"
CURRENT_DIR="$SCRIPT_DIR/current"
NORM_DIR="$SCRIPT_DIR/.normalized"

SERVER_PID=""
EXIT_CODE=0

cleanup() {
	if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null
		# adapter-node's server has been observed (in sandboxed/containerized
		# shells) to not exit on a plain SIGTERM, which left this script's
		# `wait` blocked forever even though the PASS/FAIL result above had
		# already been printed. Give it a couple seconds, then escalate to
		# SIGKILL so the script actually exits instead of hanging on cleanup.
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

# route|filename pairs (same 10 routes captured in the reference baseline)
ROUTES='
/|home.html
/trabajos|trabajos.html
/trabajos/sergio-castiglione|proyecto-sergio-castiglione.html
/trabajos/racebox|proyecto-racebox.html
/trabajos/ref|proyecto-ref.html
/trabajos/barbara-plesky|proyecto-barbara-plesky.html
/trabajos/outobox|proyecto-outobox.html
/trabajos/ref-summit|proyecto-ref-summit.html
/estudio|estudio.html
/contacto|contacto.html
'

# adapter-node's built app (`node build`) reads DATABASE_URL from
# process.env directly -- it does NOT load .env like dev/scripts do (see
# .migration/LANES.md gotcha #6). Export it here so the server started below
# actually has a connection string, and fail loudly up front if Postgres
# itself isn't reachable rather than letting the build/server fail in a
# confusing way later.
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

if ! command -v pg_isready >/dev/null 2>&1; then
	# pg_isready isn't guaranteed to be installed; fall back to a raw TCP probe.
	DB_HOST=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)" 2>/dev/null)
	DB_PORT=$(node -e "console.log(new URL(process.env.DATABASE_URL).port || 5432)" 2>/dev/null)
	if ! (exec 3<>"/dev/tcp/${DB_HOST}/${DB_PORT}") 2>/dev/null; then
		echo "Postgres is not reachable at ${DB_HOST}:${DB_PORT} (from DATABASE_URL)."
		echo "Is Docker/OrbStack running? Try: open -a OrbStack, then npm run db:up"
		exit 1
	fi
elif ! pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
	echo "Postgres is not reachable at DATABASE_URL."
	echo "Is Docker/OrbStack running? Try: open -a OrbStack, then npm run db:up"
	exit 1
fi

echo "==> Building..."
cd "$REPO_ROOT" || exit 1
if ! npm run build; then
	echo "BUILD FAILED"
	exit 1
fi

echo "==> Starting server on port $PORT..."
PORT=$PORT DATABASE_URL="$DATABASE_URL" node build >"$SCRIPT_DIR/.server.log" 2>&1 &
SERVER_PID=$!

# Wait for the server to actually serve (up to ~20s)
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
	cat "$SCRIPT_DIR/.server.log"
	exit 1
fi

echo "==> Capturing routes into $CURRENT_DIR..."
rm -rf "$CURRENT_DIR"
mkdir -p "$CURRENT_DIR"

while IFS='|' read -r route file; do
	[ -z "$route" ] && continue
	code=$(curl -s -o "$CURRENT_DIR/$file" -w '%{http_code}' "http://localhost:$PORT${route}")
	if [ "$code" != "200" ]; then
		echo "  !! $route -> HTTP $code"
		echo "$route" >>"$SCRIPT_DIR/.failed_routes"
	fi
done <<EOF
$ROUTES
EOF

# ---------------------------------------------------------------------------
# Data-endpoint check (Lane B3).
#
# The production outage this lane responds to: SvelteKit normalizes a
# client-side navigation request for `/estudio/__data.json` into
# `url.pathname === '/estudio'` with `event.isDataRequest === true` BEFORE
# `hooks.server.ts` ever runs. Every check above (and every check this
# script has ever had) only ever asks for the page route itself with a
# plain GET -- exactly what a hard page load sends, and exactly what the
# cache bug above answered correctly throughout the incident. It never asks
# for the ONE OTHER request shape a real visitor's browser actually makes:
# every click after the first, which SvelteKit's client router serves by
# fetching that same route's JSON data endpoint instead of re-fetching HTML.
# `curl`-against-HTML-routes is "the convenient tool" the postmortem calls
# out by name; this is "the one a real user's router uses".
#
# The URL shape below (`<pathname>/__data.json`, or bare `/__data.json` for
# the root) was verified against this repo's installed SvelteKit version
# (2.63) by starting `node build` locally and inspecting the actual request
# a browser's client router sends on an in-app navigation -- not assumed
# from a brief or from memory of some other version.
#
# A response that is anything other than HTTP 200 with an `application/json`
# Content-Type and a body that actually parses as JSON is exactly what the
# page cache served for every route during the outage (200, `text/html`,
# the page's own rendered document) -- so this check alone would have
# caught it, cheaply, without a browser.
echo "==> Checking client-navigation data endpoints (Content-Type: application/json)..."
DATA_TMP="$SCRIPT_DIR/.data_endpoint_body"
DATA_HEADERS="$SCRIPT_DIR/.data_endpoint_headers"
DATA_ENDPOINT_FAIL=0
DATA_ENDPOINT_FAIL_ROUTES=""

while IFS='|' read -r route file; do
	[ -z "$route" ] && continue

	if [ "$route" = "/" ]; then
		data_url="http://localhost:$PORT/__data.json"
	else
		data_url="http://localhost:$PORT${route}/__data.json"
	fi

	http_code=$(curl -s -o "$DATA_TMP" -D "$DATA_HEADERS" -w '%{http_code}' "$data_url")

	if [ "$http_code" != "200" ]; then
		echo "  !! $data_url -> HTTP $http_code (expected 200)"
		DATA_ENDPOINT_FAIL=1
		DATA_ENDPOINT_FAIL_ROUTES="$DATA_ENDPOINT_FAIL_ROUTES $route"
		continue
	fi

	content_type=$(grep -i '^content-type:' "$DATA_HEADERS" | tail -1 | cut -d' ' -f2- | tr -d '\r\n')
	case "$content_type" in
		application/json*) : ;;
		*)
			echo "  !! $data_url -> Content-Type '$content_type' (expected application/json*)"
			DATA_ENDPOINT_FAIL=1
			DATA_ENDPOINT_FAIL_ROUTES="$DATA_ENDPOINT_FAIL_ROUTES $route"
			continue
			;;
	esac

	if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$DATA_TMP" 2>/dev/null; then
		echo "  !! $data_url -> body did not parse as JSON"
		DATA_ENDPOINT_FAIL=1
		DATA_ENDPOINT_FAIL_ROUTES="$DATA_ENDPOINT_FAIL_ROUTES $route"
	fi
done <<EOF
$ROUTES
EOF

rm -f "$DATA_TMP" "$DATA_HEADERS"

if [ "$DATA_ENDPOINT_FAIL" -eq 0 ]; then
	echo "  OK: all data endpoints returned 200 application/json, parseable."
else
	echo "  FAIL: data endpoint(s) broken for:$DATA_ENDPOINT_FAIL_ROUTES"
fi

MEDIA_MAP="$SCRIPT_DIR/media-map.json"
echo "==> Generating media URL map (pre-cms tag + baseline captures)..."
if ! node "$SCRIPT_DIR/generate-media-map.mjs" >"$MEDIA_MAP"; then
	echo "Failed to generate the media URL map -- see .migration/generate-media-map.mjs's output above."
	exit 1
fi

echo "==> Normalizing and diffing..."
rm -rf "$NORM_DIR"
mkdir -p "$NORM_DIR/baseline" "$NORM_DIR/current"

# Normalize volatile, non-semantic values that change on every build/render
# even when the rendered content is identical:
#   1. Content-hashed SvelteKit asset paths: /_app/immutable/**
#   2. The per-build SvelteKit runtime global: __sveltekit_<random>
#   3. The BouncingBand hero blob's randomized inline transform (home page
#      seeds its initial position with Math.random() at SSR time, so it
#      differs on every single render, not just every build). Only the
#      specific volatile shape is matched -- a floating-point pixel pair,
#      e.g. translate(177.75231205415182px, 28.604744448149983px) -- so a
#      deliberate, non-randomized translate() (translate(-50%, -50%),
#      translate(4px, 0), etc.) is left untouched and still diffable.
#   4. The serialized server-load payload SvelteKit embeds in the
#      `kit.start(app, element, {...})` hydration bootstrap. Lane A4 moved
#      every content-bearing route from a hardcoded import to a
#      `+page.server.ts` load (required: DB access must be server-only, and
#      only a *server* load's result gets serialized for hydration -- a
#      universal `+page.ts` load, like this repo used before, never
#      appears here at all). That payload duplicates content already
#      checked via the visible HTML below it on the same page, is never
#      rendered to a visitor, and legitimately differs from the frozen
#      pre-cms baseline forever now (baseline has no server load on these
#      routes, so its payload is permanently `[null,null]`) -- so this is
#      architectural, not a workaround for lost content. The rule replaces
#      only the payload's *contents* (`data: [ ... ],`) with a fixed
#      placeholder; it does not delete the `data:` key or touch its
#      `node_ids:`/`form:`/`error:` neighbors, so the gate still fails if
#      the payload disappears entirely, gains/loses a key, or the
#      surrounding bootstrap shape otherwise changes.
#   5. Whitespace runs (spaces/tabs/newlines) collapsed to a single space,
#      file-wide. Some hardcoded prose in the pre-cms source (e.g. the
#      /estudio hero paragraphs) happened to line-wrap across two lines of
#      the .svelte file, so its SSR text node contained a literal
#      newline+tabs mid-sentence; that same prose now comes from one
#      normalized DB string with a plain single space in its place. Browsers
#      collapse whitespace runs identically either way, so "a b" and
#      "a\n\t\tb" are visually indistinguishable -- but a genuinely missing
#      space ("ab" vs "a b") is a single space, never a run, so it still
#      shows up as a difference after this rule.
#   6. /media/<key> URLs (Lane A5 moved every image/video referenced by
#      content out of static/ and into a bucket, served through that route)
#      are TRANSLATED back to the original static/ path they came from --
#      never blanked to a placeholder. A placeholder would make the gate
#      blind to a swapped image: two different /media/<keyA> and
#      /media/<keyB> would both collapse to the same placeholder and the
#      diff would pass regardless of which file actually got served. Because
#      the key is content-addressed (sha256 of the real bytes), translating
#      it back is the stronger move: a correctly migrated file's key maps to
#      exactly the path the pre-cms baseline had (byte-exact match
#      preserved), while a swapped-in file hashes to a different key that
#      maps to a different path (or nothing), so it still shows up as a real
#      diff. The mapping itself is never hand-maintained -- see
#      generate-media-map.mjs, run fresh below on every invocation -- and a
#      key with no mapping entry is left as literal "/media/<key>" text by
#      translate-media.mjs rather than guessed at, which still fails the
#      comparison instead of silently passing.
normalize() {
	sed -E \
		-e 's#([./]*_app/immutable/[A-Za-z0-9._/-]+)#/_app/immutable/__NORMALIZED__#g' \
		-e 's/__sveltekit_[A-Za-z0-9]+/__sveltekit___NORMALIZED__/g' \
		-e 's/translate\(-?[0-9]+\.[0-9]+px, ?-?[0-9]+\.[0-9]+px\)/translate(__NORMALIZED__)/g' \
		-e 's/(data: )\[.*\],$/\1[__NORMALIZED_PAYLOAD__],/' \
		"$1" \
		| node "$SCRIPT_DIR/translate-media.mjs" "$MEDIA_MAP" \
		| tr -s '[:space:]' ' '
}

ANY_DIFF=0
DIFF_ROUTES=""

while IFS='|' read -r route file; do
	[ -z "$route" ] && continue

	if [ ! -f "$BASELINE_DIR/$file" ]; then
		echo "  !! missing baseline file: $file"
		ANY_DIFF=1
		DIFF_ROUTES="$DIFF_ROUTES $route(no-baseline)"
		continue
	fi
	if [ ! -f "$CURRENT_DIR/$file" ]; then
		echo "  !! missing current capture: $file"
		ANY_DIFF=1
		DIFF_ROUTES="$DIFF_ROUTES $route(no-capture)"
		continue
	fi

	normalize "$BASELINE_DIR/$file" >"$NORM_DIR/baseline/$file"
	normalize "$CURRENT_DIR/$file" >"$NORM_DIR/current/$file"

	if ! diff -q "$NORM_DIR/baseline/$file" "$NORM_DIR/current/$file" >/dev/null; then
		ANY_DIFF=1
		DIFF_ROUTES="$DIFF_ROUTES $route"
	fi
done <<EOF
$ROUTES
EOF

echo ""
echo "===================================="
if [ "$ANY_DIFF" -eq 0 ]; then
	echo "PASS (HTML): all 10 routes match the reference baseline (0 differences)."
else
	echo "FAIL (HTML): differences found in:$DIFF_ROUTES"
	echo ""
	echo "Run e.g.:"
	for r in $DIFF_ROUTES; do
		f=$(echo "$ROUTES" | awk -F'|' -v rt="${r%%(*}" '$1==rt{print $2}')
		[ -n "$f" ] && echo "  diff .migration/.normalized/baseline/$f .migration/.normalized/current/$f"
	done
fi
if [ "$DATA_ENDPOINT_FAIL" -eq 0 ]; then
	echo "PASS (data endpoints): all __data.json endpoints are application/json and parse."
else
	echo "FAIL (data endpoints):$DATA_ENDPOINT_FAIL_ROUTES -- see 'Checking client-navigation data endpoints' above."
fi
if [ "$ANY_DIFF" -eq 0 ] && [ "$DATA_ENDPOINT_FAIL" -eq 0 ]; then
	EXIT_CODE=0
else
	EXIT_CODE=1
fi
echo "===================================="

rm -f "$SCRIPT_DIR/.failed_routes"
exit $EXIT_CODE
