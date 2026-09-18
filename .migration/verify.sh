#!/bin/bash
# .migration/verify.sh
#
# Rebuilds the site, serves it on PORT, captures the same 10 routes used for
# the pre-cms baseline, normalizes away known build-to-build / render-to-render
# noise, and diffs against .migration/baseline/. Prints a PASS/FAIL summary.
#
# Usage: .migration/verify.sh   (run from anywhere; paths are resolved below)

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
		wait "$SERVER_PID" 2>/dev/null
	fi
}
trap cleanup EXIT INT TERM

# route|filename pairs (same 10 routes captured in the pre-cms baseline)
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

echo "==> Building..."
cd "$REPO_ROOT" || exit 1
if ! npm run build; then
	echo "BUILD FAILED"
	exit 1
fi

echo "==> Starting server on port $PORT..."
PORT=$PORT node build >"$SCRIPT_DIR/.server.log" 2>&1 &
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
normalize() {
	sed -E \
		-e 's#([./]*_app/immutable/[A-Za-z0-9._/-]+)#/_app/immutable/__NORMALIZED__#g' \
		-e 's/__sveltekit_[A-Za-z0-9]+/__sveltekit___NORMALIZED__/g' \
		-e 's/translate\(-?[0-9]+\.[0-9]+px, ?-?[0-9]+\.[0-9]+px\)/translate(__NORMALIZED__)/g' \
		"$1"
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
	echo "PASS: all 10 routes match the pre-cms baseline (0 differences)."
	EXIT_CODE=0
else
	echo "FAIL: differences found in:$DIFF_ROUTES"
	echo ""
	echo "Run e.g.:"
	for r in $DIFF_ROUTES; do
		f=$(echo "$ROUTES" | awk -F'|' -v rt="${r%%(*}" '$1==rt{print $2}')
		[ -n "$f" ] && echo "  diff .migration/.normalized/baseline/$f .migration/.normalized/current/$f"
	done
	EXIT_CODE=1
fi
echo "===================================="

rm -f "$SCRIPT_DIR/.failed_routes"
exit $EXIT_CODE
