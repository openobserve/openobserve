#!/usr/bin/env bash
# Classify a list of changed paths (one per line on stdin) into the suites that must run.
# Prints key=value lines. Unknown paths run everything: the merge queue uses the same rules,
# so an allow-list miss would mean a path that is never tested.
set -euo pipefail

docs=false ci=false build_support=false ops=false backend=false frontend=false
api_tests=false ui_tests=false db_tests=false test_data=false mobile=false unknown=false
workflows=""
n=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  n=$((n+1))
  case "$f" in
    *.md|docs/*|screenshots/*|qa-reports/*|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp|LICENSE|.github/ISSUE_TEMPLATE/*) docs=true ;;
    .github/workflows/*) ci=true; workflows="$workflows ${f#.github/workflows/}" ;;
    .github/actions/*|.github/scripts/*|.github/protoc.sh|.github/dependabot.yml|.github/pr-title-checker-config.json) build_support=true ;;
    scripts/*|deploy/*|cross/*|config/*|download.sh|downloadO2.sh|Cross.*.toml|deny.toml|.devcontainer/*|.agents/*|.claude/*|.opencode/*|opencode.jsonc|.claudeignore|.cursorignore|.typos.toml|.gitattributes|.gitignore|.env.example|openobserve.cdx.xml|package-lock.json) ops=true ;;
    src/*|proto/*|Cargo.toml|Cargo.lock|build.rs|rust-toolchain.toml|.cargo/*|tests/integration_test.rs|coverage.sh|clippy.toml|rustfmt.toml) backend=true ;;
    web/*) frontend=true ;;
    tests/api-testing/*) api_tests=true ;;
    tests/ui-testing/*) ui_tests=true ;;
    tests/db-testing/*) db_tests=true ;;
    tests/mobile-testing/*) mobile=true ;;
    tests/test-data/*|tests/*.json|tests/sourcemaps.zip|tests/.gitignore) test_data=true ;;
    *) unknown=true ;;
  esac
done

# No diff at all (no base to compare against) is treated as unknown: run everything.
[ "$n" -eq 0 ] && unknown=true

or() { for v in "$@"; do [ "$v" = true ] && { echo true; return; }; done; echo false; }
run_unit_backend=$(or "$backend" "$build_support" "$unknown")
run_unit_ui=$(or "$frontend" "$unknown")
run_api=$(or "$backend" "$api_tests" "$test_data" "$unknown")
run_db=$(or "$backend" "$db_tests" "$unknown")
run_playwright=$(or "$backend" "$frontend" "$ui_tests" "$test_data" "$unknown")
run_enterprise=$(or "$backend" "$frontend" "$unknown")

for k in docs ci build_support ops backend frontend api_tests ui_tests db_tests test_data mobile unknown \
         run_unit_backend run_unit_ui run_api run_db run_playwright run_enterprise; do
  echo "$k=${!k}"
done
echo "changed_workflows=${workflows# }"
