#!/usr/bin/env bash
# Guards migrations/ against the failures that only show up once two PRs land:
# golang-migrate refuses a directory where two files share a version, and the
# binary then fails at boot. Areas number in their own ranges (core 0001xx,
# email 0002xx, helpdesk 0003xx), so gaps are expected; duplicates are not.
#
# Run by `make check-migrations` and the Migrations job in CI. CI runs it on the
# PR's merge commit, so it sees main's migrations too.
set -euo pipefail

DIR="${1:-migrations}"
[[ -d $DIR ]] || { echo "check-migrations: no such directory: $DIR" >&2; exit 1; }

status=0
fail() { echo "check-migrations: $*" >&2; status=1; }

shopt -s nullglob
sql=("$DIR"/*.sql)
[[ ${#sql[@]} -gt 0 ]] || { echo "check-migrations: no migrations in $DIR" >&2; exit 1; }

for path in "${sql[@]}"; do
  name=$(basename "$path")
  [[ $name =~ ^[0-9]{6}_[a-z0-9_]+\.(up|down)\.sql$ ]] ||
    fail "bad filename '$name' (expected 000123_snake_case_name.up.sql / .down.sql)"
done

ups=("$DIR"/*.up.sql)
dupes=$(printf '%s\n' "${ups[@]}" | xargs -n1 basename | cut -d_ -f1 | sort | uniq -d)
for version in $dupes; do
  fail "duplicate migration version $version:"
  for path in "$DIR/${version}_"*.up.sql; do echo "    $path" >&2; done
done
[[ -z $dupes ]] || echo "check-migrations: renumber the migration that has NOT been released to the next free number in its area's range." >&2

for path in "${ups[@]}"; do
  [[ -f ${path%.up.sql}.down.sql ]] || fail "missing $(basename "${path%.up.sql}").down.sql"
done
for path in "$DIR"/*.down.sql; do
  [[ -f ${path%.down.sql}.up.sql ]] || fail "missing $(basename "${path%.down.sql}").up.sql"
done

[[ $status -eq 0 ]] || exit 1
echo "check-migrations: ${#ups[@]} migrations, no duplicate versions, every up has its down."
