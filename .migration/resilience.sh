#!/bin/bash
# .migration/resilience.sh
#
# Companion to verify.sh. verify.sh proves the rendered site is correct;
# this proves the site SURVIVES its dependencies failing — the actual gap
# that let a raw 500 reach production (two deploys landed back to back, and
# during the container startup window a request hit a process that had
# bound its port but couldn't reach Postgres yet).
#
# Six checks, matching the Lane B2 brief exactly:
#   1. Postgres down: every route still serves 200 with real content, then
#      the DB-backed MCP surface (client registration) fails clearly.
#   2. Object storage down: every route still serves 200 (via the live
#      Postgres render fallback).
#   3. Both down: visitors get the site's OWN styled error page -- never a
#      raw stack trace or the default unstyled SvelteKit fallback.
#   4. Cold start: start the app with Postgres already down and hammer it
#      with concurrent requests from the first millisecond -- zero 500s.
#   5. Bad publish: content that can't render is refused; the previously
#      published version keeps serving and the DB write is rolled back.
#   6. Health endpoint: reports not-ready before the app can serve, ready
#      after.
#
# Every check restores Postgres/storage/the server process afterward. Run
# from anywhere; paths are resolved below. Requires the same local
# environment as verify.sh: `npm run db:up` (Postgres + SeaweedFS via
# docker-compose.dev.yml) and a filled-in .env.
#
# Usage: .migration/resilience.sh

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="docker compose -f $REPO_ROOT/docker-compose.dev.yml"

# Fixed ports for each phase (defined up top, not inline, so `cleanup` can
# always kill any leftover listener on all three regardless of which phase
# the script was in when it exited).
MAIN_PORT=5195
COLD_PORT=5196
HEALTH_PORT=5197

SERVER_PID=""
TOTAL_FAILURES=0
CURRENT_CHECK=""

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

check_start() {
	CURRENT_CHECK="$1"
	echo ""
	echo "=== CHECK: $1 ==="
}

pass() { echo "  PASS  $1"; }
fail() {
	echo "  FAIL  $1"
	TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
}

# ---------------------------------------------------------------------------
# Cleanup -- always restore Postgres, storage, and kill any server we
# started, no matter how this script exits.
# ---------------------------------------------------------------------------

cleanup() {
	stop_server
	# Belt-and-suspenders: a hung/leaked process on any of the three ports
	# this script ever binds must never survive past this script's own exit,
	# no matter which phase it was in when it exited.
	kill_port "$MAIN_PORT" 2>/dev/null
	kill_port "$COLD_PORT" 2>/dev/null
	kill_port "$HEALTH_PORT" 2>/dev/null
	echo ""
	echo "==> Cleanup: making sure Postgres and storage are both up..."
	$COMPOSE start postgres >/dev/null 2>&1
	$COMPOSE start seaweedfs >/dev/null 2>&1
	wait_for_postgres 30 >/dev/null
	wait_for_storage 120 >/dev/null
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

if [ -f "$REPO_ROOT/.env" ]; then
	set -a
	# shellcheck disable=SC1091
	source "$REPO_ROOT/.env"
	set +a
fi

if [ -z "${DATABASE_URL:-}" ] || [ -z "${OWNER_KEY:-}" ] || [ -z "${ENDPOINT:-}" ]; then
	echo "DATABASE_URL / OWNER_KEY / ENDPOINT must be set (checked environment and $REPO_ROOT/.env)."
	exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

postgres_reachable() {
	# pg_isready isn't guaranteed to be installed (it isn't on this machine)
	# -- fall back to a raw TCP probe, same approach verify.sh uses.
	if command -v pg_isready >/dev/null 2>&1; then
		pg_isready -d "$DATABASE_URL" >/dev/null 2>&1
		return $?
	fi
	local host port
	host=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)" 2>/dev/null)
	port=$(node -e "console.log(new URL(process.env.DATABASE_URL).port || 5432)" 2>/dev/null)
	(exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}

wait_for_postgres() {
	local timeout="$1" waited=0
	while [ "$waited" -lt "$timeout" ]; do
		if postgres_reachable; then return 0; fi
		sleep 0.5
		waited=$((waited + 1))
	done
	return 1
}

wait_for_storage() {
	local timeout="$1" waited=0
	while [ "$waited" -lt "$timeout" ]; do
		if curl -s -o /dev/null --max-time 2 "$ENDPOINT/"; then return 0; fi
		sleep 0.5
		waited=$((waited + 1))
	done
	return 1
}

# HTTP status for a URL, "000" if the connection itself failed (refused/reset).
http_status() {
	curl -s -o /dev/null --max-time 15 -w '%{http_code}' "$1" 2>/dev/null || echo "000"
}

http_body() {
	curl -s --max-time 15 "$1" 2>/dev/null
}

# Kills anything already listening on $1 -- guards against a leaked process
# from an earlier/interrupted run answering requests instead of the fresh
# one this script is about to start, which would make every check below
# meaningless (testing against the wrong process).
kill_port() {
	local port="$1"
	local pids
	pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null)
	if [ -n "$pids" ]; then
		echo "  (killing stray process(es) already on port $port: $pids)"
		kill -9 $pids 2>/dev/null
		sleep 0.3
	fi
}

# Starts `node build` on the given port, logging to .migration/.resilience-server.log.
start_server() {
	local port="$1"
	kill_port "$port"
	PORT=$port DATABASE_URL="$DATABASE_URL" BUCKET="$BUCKET" ENDPOINT="$ENDPOINT" \
		ACCESS_KEY_ID="$ACCESS_KEY_ID" SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" REGION="$REGION" \
		OWNER_KEY="$OWNER_KEY" ORIGIN="http://127.0.0.1:$port" \
		node "$REPO_ROOT/build" >"$SCRIPT_DIR/.resilience-server.log" 2>&1 &
	SERVER_PID=$!
}

stop_server() {
	if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
		kill "$SERVER_PID" 2>/dev/null
		for _ in $(seq 1 20); do
			kill -0 "$SERVER_PID" 2>/dev/null || break
			sleep 0.1
		done
		kill -0 "$SERVER_PID" 2>/dev/null && kill -9 "$SERVER_PID" 2>/dev/null
		wait "$SERVER_PID" 2>/dev/null
	fi
	SERVER_PID=""
}

wait_for_app() {
	local port="$1" timeout="$2" waited=0
	while [ "$waited" -lt "$timeout" ]; do
		local code
		code=$(http_status "http://127.0.0.1:$port/")
		if [ "$code" = "200" ]; then return 0; fi
		sleep 0.3
		waited=$((waited + 1))
	done
	return 1
}

ROUTES='
/|home
/trabajos|trabajos
/trabajos/sergio-castiglione|proyecto-sergio-castiglione
/trabajos/racebox|proyecto-racebox
/trabajos/ref|proyecto-ref
/trabajos/barbara-plesky|proyecto-barbara-plesky
/trabajos/outobox|proyecto-outobox
/trabajos/ref-summit|proyecto-ref-summit
/estudio|estudio
/contacto|contacto
'

# Requests every route above against $1 (base URL) and fails if any is not
# 200, or is suspiciously small (an empty/near-empty 200 would still "pass"
# a naive status check but isn't "real content").
assert_all_routes_serve() {
	local base="$1" any_bad=0
	while IFS='|' read -r route name; do
		[ -z "$route" ] && continue
		local out="$SCRIPT_DIR/.resilience-tmp-$name.html"
		local code
		code=$(curl -s -o "$out" --max-time 15 -w '%{http_code}' "$base$route")
		local size
		size=$(wc -c <"$out" 2>/dev/null | tr -d ' ')
		if [ "$code" != "200" ]; then
			fail "$route -> HTTP $code (expected 200)"
			any_bad=1
		elif [ -z "$size" ] || [ "$size" -lt 1000 ] || ! grep -qi "moco" "$out"; then
			fail "$route -> HTTP 200 but body looks wrong (size=${size:-0} bytes)"
			any_bad=1
		fi
		rm -f "$out"
	done <<EOF
$ROUTES
EOF
	return $any_bad
}

health_status() {
	# Prints "<http_code> <status_field>", e.g. "200 ok" or "503 not_ready".
	local out
	out=$(curl -s --max-time 20 -w '\n%{http_code}' "http://127.0.0.1:$1/api/health")
	local code body status
	code=$(echo "$out" | tail -1)
	body=$(echo "$out" | sed '$d')
	status=$(echo "$body" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).status)}catch{console.log('parse-error')}})" 2>/dev/null)
	echo "$code $status"
}

echo "Resilience gate for mocoweb -- breaking things on purpose."
echo "REPO_ROOT=$REPO_ROOT"

# ---------------------------------------------------------------------------
# Precondition: both dependencies up, and a fresh build.
# ---------------------------------------------------------------------------

check_start "preflight"
if ! wait_for_postgres 5; then
	echo "Postgres is not reachable. Try: npm run db:up"
	exit 1
fi
if ! wait_for_storage 5; then
	echo "Storage is not reachable. Try: npm run db:up"
	exit 1
fi
pass "Postgres and storage are both up"

echo "==> Building..."
cd "$REPO_ROOT" || exit 1
if ! npm run build >"$SCRIPT_DIR/.resilience-build.log" 2>&1; then
	echo "BUILD FAILED -- see $SCRIPT_DIR/.resilience-build.log"
	exit 1
fi
pass "build succeeded"

start_server "$MAIN_PORT"
if ! wait_for_app "$MAIN_PORT" 30; then
	echo "Server failed to start -- see $SCRIPT_DIR/.resilience-server.log"
	cat "$SCRIPT_DIR/.resilience-server.log"
	exit 1
fi
pass "server started on port $MAIN_PORT"
read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
if [ "$H_CODE" = "200" ] && [ "$H_STATUS" = "ok" ]; then
	pass "/api/health reports ok with both dependencies up"
else
	fail "/api/health reported $H_CODE/$H_STATUS with both dependencies up (expected 200/ok)"
fi

# ---------------------------------------------------------------------------
# CHECK 1 -- Postgres down
# ---------------------------------------------------------------------------

check_start "1. Postgres down -- routes still serve, MCP fails clearly"
$COMPOSE stop postgres >/dev/null 2>&1
sleep 1

if assert_all_routes_serve "http://127.0.0.1:$MAIN_PORT"; then
	pass "all 10 routes returned 200 with real content while Postgres was down"
fi
# (a failing route already recorded its own specific failure above)

read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
if [ "$H_CODE" = "200" ] && [ "$H_STATUS" = "degraded" ]; then
	pass "/api/health reports 200/degraded (serving from cache, DB unreachable)"
else
	fail "/api/health reported $H_CODE/$H_STATUS with Postgres down (expected 200/degraded)"
fi

REG_CODE=$(curl -s -o /tmp/resilience-register-down.json --max-time 15 -w '%{http_code}' \
	-X POST "http://127.0.0.1:$MAIN_PORT/register" \
	-H 'Content-Type: application/json' \
	-d '{"client_name":"resilience-check-db-down","redirect_uris":["http://127.0.0.1:9/callback"]}')
if [ "$REG_CODE" != "201" ]; then
	pass "MCP client registration failed clearly (HTTP $REG_CODE) instead of hanging or succeeding while DB is down"
else
	fail "MCP client registration returned 201 (succeeded) while Postgres was down -- should have failed"
fi
rm -f /tmp/resilience-register-down.json

echo "==> Restoring Postgres..."
$COMPOSE start postgres >/dev/null 2>&1
if wait_for_postgres 30; then
	pass "Postgres back up"
else
	fail "Postgres did not come back up within 30s"
fi

# Give postgres.js a moment to notice the DB is back (the TCP port accepting
# connections and Postgres actually being ready to run a query are not the
# same instant), then confirm MCP registration (the exact thing that just
# failed) now works cleanly -- i.e. the earlier failed attempt left nothing
# corrupted/half-open. Retried with backoff rather than a single shot: this
# is proving eventual recovery, not instant recovery.
REG_CODE2="000"
for _ in $(seq 1 10); do
	REG_CODE2=$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' \
		-X POST "http://127.0.0.1:$MAIN_PORT/register" \
		-H 'Content-Type: application/json' \
		-d '{"client_name":"resilience-check-db-back","redirect_uris":["http://127.0.0.1:9/callback"]}')
	[ "$REG_CODE2" = "201" ] && break
	sleep 1
done
if [ "$REG_CODE2" = "201" ]; then
	pass "MCP client registration works again after Postgres recovered -- nothing left corrupted"
else
	fail "MCP client registration still failing ($REG_CODE2) after Postgres recovered"
fi

read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
[ "$H_CODE" = "200" ] && [ "$H_STATUS" = "ok" ] && pass "/api/health back to 200/ok" || fail "/api/health is $H_CODE/$H_STATUS after Postgres recovered"

# ---------------------------------------------------------------------------
# CHECK 2 -- object storage down
# ---------------------------------------------------------------------------

check_start "2. Object storage down -- routes still serve (live render fallback)"
$COMPOSE stop seaweedfs >/dev/null 2>&1
sleep 1

if assert_all_routes_serve "http://127.0.0.1:$MAIN_PORT"; then
	pass "all 10 routes returned 200 with real content while storage was down"
fi
# (a failing route already recorded its own specific failure above)

read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
if [ "$H_CODE" = "503" ] && [ "$H_STATUS" = "not_ready" ]; then
	pass "/api/health reports 503/not_ready while storage is unreachable"
else
	fail "/api/health reported $H_CODE/$H_STATUS with storage down (expected 503/not_ready)"
fi

echo "==> Restoring storage..."
$COMPOSE start seaweedfs >/dev/null 2>&1
if wait_for_storage 120; then
	pass "storage back up"
else
	fail "storage did not come back up within 30s"
fi
sleep 1
read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
[ "$H_CODE" = "200" ] && [ "$H_STATUS" = "ok" ] && pass "/api/health back to 200/ok" || fail "/api/health is $H_CODE/$H_STATUS after storage recovered"

# ---------------------------------------------------------------------------
# CHECK 3 -- both down
# ---------------------------------------------------------------------------

check_start "3. Both Postgres and storage down -- styled branded error page, never a raw crash"
$COMPOSE stop postgres >/dev/null 2>&1
$COMPOSE stop seaweedfs >/dev/null 2>&1
sleep 1

BODY=$(http_body "http://127.0.0.1:$MAIN_PORT/")
CODE=$(http_status "http://127.0.0.1:$MAIN_PORT/")

if [ "$CODE" != "200" ]; then
	pass "/ correctly returns a non-200 ($CODE) when nothing can be rendered or served from cache"
else
	fail "/ returned 200 with both dependencies down -- expected an error status"
fi

if echo "$BODY" | grep -qi "Algo salió mal\|No encontramos esta página"; then
	pass "response body is the site's own branded Spanish error page"
else
	fail "response body does not contain the branded error copy -- got: $(echo "$BODY" | head -c 200)"
fi

if echo "$BODY" | grep -Eqi "at file://|node_modules/|\.js:[0-9]+:[0-9]+|TypeError:|ReferenceError:"; then
	fail "response body looks like it contains a raw stack trace"
else
	pass "response body contains no raw stack trace / internals"
fi

if echo "$BODY" | grep -qi "volver al inicio"; then
	pass "error page offers a way back to the site"
else
	fail "error page does not offer a way back"
fi

echo "==> Restoring Postgres and storage..."
$COMPOSE start postgres >/dev/null 2>&1
$COMPOSE start seaweedfs >/dev/null 2>&1
wait_for_postgres 30 && wait_for_storage 120
sleep 1
read -r H_CODE H_STATUS <<<"$(health_status "$MAIN_PORT")"
[ "$H_CODE" = "200" ] && [ "$H_STATUS" = "ok" ] && pass "/api/health back to 200/ok" || fail "/api/health is $H_CODE/$H_STATUS after both recovered"

# ---------------------------------------------------------------------------
# CHECK 5 -- bad publish (run here, while everything is healthy)
# ---------------------------------------------------------------------------

check_start "5. Bad publish -- refused, previous version stays live"
if node "$SCRIPT_DIR/resilience-bad-publish.mjs" "http://127.0.0.1:$MAIN_PORT" "$OWNER_KEY" 2>&1 | tee "$SCRIPT_DIR/.resilience-bad-publish.log"; then
	pass "bad-publish check passed (see log lines above)"
else
	fail "bad-publish check failed -- see $SCRIPT_DIR/.resilience-bad-publish.log"
fi

stop_server

# ---------------------------------------------------------------------------
# CHECK 4 -- cold start: Postgres down BEFORE the process even starts,
# hammered with requests from the first millisecond.
# ---------------------------------------------------------------------------

check_start "4. Cold start -- Postgres down at boot, hammered immediately, zero 500s"
$COMPOSE stop postgres >/dev/null 2>&1
sleep 1

start_server "$COLD_PORT"

# Hammer immediately -- no sleep before the first request. Most of these
# will be connection-refused (000) until the listener binds; that's fine
# and expected. The only failure this check cares about is an actual 500.
FIVE_HUNDREDS=0
TOTAL_REQUESTS=0
RECEIVED_200=0
DEADLINE=$((SECONDS + 20))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
	for path in / /trabajos /estudio /contacto /trabajos/racebox; do
		CODE=$(http_status "http://127.0.0.1:$COLD_PORT$path")
		TOTAL_REQUESTS=$((TOTAL_REQUESTS + 1))
		if [ "$CODE" = "500" ]; then
			FIVE_HUNDREDS=$((FIVE_HUNDREDS + 1))
			echo "    !! got 500 for $path during cold start"
		elif [ "$CODE" = "200" ]; then
			RECEIVED_200=$((RECEIVED_200 + 1))
		fi
	done
done

echo "  fired $TOTAL_REQUESTS requests during the cold-start window ($RECEIVED_200 got 200, $FIVE_HUNDREDS got 500)"
if [ "$FIVE_HUNDREDS" -eq 0 ]; then
	pass "zero 500s during cold start with Postgres down"
else
	fail "$FIVE_HUNDREDS requests got a 500 during cold start"
fi
if [ "$RECEIVED_200" -gt 0 ]; then
	pass "the app served real 200s (from cache) while Postgres was still down"
else
	fail "the app never served a single 200 during the cold-start window"
fi

stop_server
echo "==> Restoring Postgres..."
$COMPOSE start postgres >/dev/null 2>&1
wait_for_postgres 30 >/dev/null

# ---------------------------------------------------------------------------
# CHECK 6 -- health endpoint: not-ready before the app can serve, ready after
# ---------------------------------------------------------------------------

check_start "6. Health endpoint -- not-ready before serving is possible, ready after"
$COMPOSE stop seaweedfs >/dev/null 2>&1
sleep 1

start_server "$HEALTH_PORT"
# Wait only for the TCP port to accept connections (not for a 200 -- with
# storage down the app should NEVER return a plain 200 readiness signal).
PORT_UP=0
for _ in $(seq 1 60); do
	if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$HEALTH_PORT/api/health"; then
		PORT_UP=1
		break
	fi
	sleep 0.3
done

if [ "$PORT_UP" -eq 1 ]; then
	read -r H_CODE H_STATUS <<<"$(health_status "$HEALTH_PORT")"
	if [ "$H_CODE" = "503" ] && [ "$H_STATUS" = "not_ready" ]; then
		pass "health endpoint reports 503/not_ready while storage is unreachable at boot"
	else
		fail "health endpoint reported $H_CODE/$H_STATUS while storage was down at boot (expected 503/not_ready)"
	fi
else
	fail "health endpoint never came up at all"
fi

echo "==> Restoring storage..."
$COMPOSE start seaweedfs >/dev/null 2>&1
if wait_for_storage 120; then
	# Poll health until it flips to ready.
	BECAME_READY=0
	for _ in $(seq 1 40); do
		read -r H_CODE H_STATUS <<<"$(health_status "$HEALTH_PORT")"
		if [ "$H_CODE" = "200" ] && [ "$H_STATUS" = "ok" ]; then
			BECAME_READY=1
			break
		fi
		sleep 0.5
	done
	if [ "$BECAME_READY" -eq 1 ]; then
		pass "health endpoint became 200/ok once storage recovered"
	else
		fail "health endpoint never reported 200/ok after storage recovered"
	fi
else
	fail "storage did not come back up within 30s"
fi

stop_server

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "===================================="
if [ "$TOTAL_FAILURES" -eq 0 ]; then
	echo "PASS: all resilience checks passed."
	EXIT_CODE=0
else
	echo "FAIL: $TOTAL_FAILURES check(s) failed. See above."
	EXIT_CODE=1
fi
echo "===================================="
exit $EXIT_CODE
