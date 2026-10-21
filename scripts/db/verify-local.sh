#!/usr/bin/env bash
# Applies every migration in supabase/migrations/ to a throwaway local
# PostgreSQL, in filename order, on top of scripts/db/supabase-stubs.sql, then
# runs each SQL test in supabase/tests/ (they RAISE on the first failed check).
#
# Local and disposable: the cluster lives in a temporary directory, listens
# only on a Unix socket, and is deleted on exit. It never connects to a
# Supabase project and needs no credentials.
#
# Usage: bash scripts/db/verify-local.sh            # all migrations and tests
#        KEEP=1 bash scripts/db/verify-local.sh     # leave the cluster running
#
# Needs PostgreSQL server binaries (initdb, pg_ctl): set PG_BIN, or have them
# under /usr/lib/postgresql/<version>/bin. Production runs PostgreSQL 17; a
# 16 server is close enough for syntax, grants and RLS behaviour.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "${PG_BIN}" || ! -x "${PG_BIN}/initdb" ]]; then
  echo "PostgreSQL server binaries not found; set PG_BIN" >&2
  exit 2
fi

WORK="$(mktemp -d /var/tmp/dikho-pg.XXXXXX)"
DATA="${WORK}/data"
SOCK="${WORK}/sock"
mkdir -p "${SOCK}"

# initdb refuses to run as root; use the postgres account when we are root.
run() {
  if [[ "$(id -u)" == "0" ]]; then runuser -u postgres -- "$@"; else "$@"; fi
}
if [[ "$(id -u)" == "0" ]]; then chown -R postgres "${WORK}"; chmod 755 "${WORK}"; fi

cleanup() {
  if [[ -z "${KEEP:-}" ]]; then
    run "${PG_BIN}/pg_ctl" -D "${DATA}" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "${WORK}"
  else
    echo "Cluster kept: psql -h ${SOCK} -p 54329 -U postgres dikho"
  fi
}
trap cleanup EXIT

run "${PG_BIN}/initdb" -D "${DATA}" -U postgres -A trust --no-sync >/dev/null
run "${PG_BIN}/pg_ctl" -D "${DATA}" -o "-k ${SOCK} -p 54329 -c listen_addresses=''" -w start >/dev/null

PSQL=(run psql -h "${SOCK}" -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "create database dikho" >/dev/null
"${PSQL[@]}" -d dikho -f "${ROOT}/scripts/db/supabase-stubs.sql" >/dev/null

count=0
for file in "${ROOT}"/supabase/migrations/*.sql; do
  if ! out="$("${PSQL[@]}" -d dikho -f "${file}" 2>&1)"; then
    echo "FAILED applying $(basename "${file}")" >&2
    echo "${out}" >&2
    exit 1
  fi
  count=$((count + 1))
done
echo "applied ${count} migrations"

shopt -s nullglob
tests=("${ROOT}"/supabase/tests/*.sql)
for file in "${tests[@]}"; do
  if ! out="$("${PSQL[@]}" -d dikho -f "${file}" 2>&1)"; then
    echo "FAILED $(basename "${file}")" >&2
    echo "${out}" >&2
    exit 1
  fi
  echo "ok   $(basename "${file}")"
done
echo "${#tests[@]} SQL test file(s) passed"
