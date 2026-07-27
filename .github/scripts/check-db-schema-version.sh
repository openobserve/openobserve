#!/usr/bin/env bash

set -euo pipefail

MIGRATION_DIR="src/infra/src/table/migration"
SCHEMA_VERSION_FILE="src/config/src/config.rs"

usage() {
  echo "Usage: $0 <base-sha> <head-sha>" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

base_sha=$1
head_sha=$2

for sha in "$base_sha" "$head_sha"; do
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "::error::Unable to find commit ${sha}. Ensure the checkout has full history."
    exit 1
  fi
done

if ! added_files=$(git diff --name-only --diff-filter=A "$base_sha" "$head_sha" -- "$MIGRATION_DIR"); then
  echo "::error::Unable to compare the base and head commits."
  exit 1
fi

added_migrations=()
while IFS= read -r file; do
  if [[ "$file" =~ ^src/infra/src/table/migration/m[0-9].*\.rs$ ]]; then
    added_migrations+=("$file")
  fi
done <<< "$added_files"

if [[ ${#added_migrations[@]} -eq 0 ]]; then
  echo "No new database migration files were added; DB schema version check passed."
  exit 0
fi

extract_schema_version() {
  local sha=$1
  local file_contents
  local matches

  if ! file_contents=$(git show "${sha}:${SCHEMA_VERSION_FILE}"); then
    echo "::error file=${SCHEMA_VERSION_FILE}::Unable to read DB_SCHEMA_VERSION at commit ${sha}." >&2
    return 1
  fi

  matches=$(awk '
    /^[[:space:]]*pub const DB_SCHEMA_VERSION: u64 = [0-9]+;[[:space:]]*$/ {
      line = $0
      sub(/^[^=]*=[[:space:]]*/, "", line)
      sub(/;.*/, "", line)
      print line
    }
  ' <<< "$file_contents")

  if [[ $(wc -w <<< "$matches") -ne 1 ]]; then
    echo "::error file=${SCHEMA_VERSION_FILE}::Expected exactly one numeric DB_SCHEMA_VERSION declaration at commit ${sha}." >&2
    return 1
  fi

  printf '%s\n' "$matches"
}

base_version=$(extract_schema_version "$base_sha") || exit 1
head_version=$(extract_schema_version "$head_sha") || exit 1

echo "New database migration files:"
printf '  - %s\n' "${added_migrations[@]}"
echo "DB_SCHEMA_VERSION: ${base_version} -> ${head_version}"

if (( 10#$head_version <= 10#$base_version )); then
  echo "::error file=${SCHEMA_VERSION_FILE}::New database migrations require DB_SCHEMA_VERSION to be increased above ${base_version}; found ${head_version}."
  exit 1
fi

echo "DB schema version was increased; check passed."
