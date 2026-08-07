#!/bin/bash
# Run pytest from the tests/api-testing/ project directory.
# Translates repo-root-relative paths appended by Testbot into project-relative paths
# so pytest resolves them correctly from within tests/api-testing/.
set -e

export PATH="$HOME/.rye/shims:$PATH"

cd tests/api-testing

args=()
for arg in "$@"; do
  if [[ "$arg" == tests/api-testing/* ]]; then
    args+=("${arg#tests/api-testing/}")
  else
    args+=("$arg")
  fi
done

exec rye run pytest "${args[@]}"
