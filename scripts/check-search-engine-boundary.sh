#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

cargo metadata --no-deps --format-version 1 \
  | jq -e '.packages[] | select(.name == "search") | all(.dependencies[]; .name != "openobserve-core")' \
  >/dev/null

cargo metadata --no-deps --format-version 1 \
  | jq -e '.packages[] | select(.name == "o2_vrl") | all(.dependencies[]; .name != "openobserve-core" and .name != "search")' \
  >/dev/null

candidate_paths=(
  src/core/src/service/search/datafusion
  src/core/src/service/search/sql
  src/core/src/service/search/tantivy
  src/core/src/service/search/bloom_pruner.rs
  src/core/src/service/search/index.rs
  src/core/src/service/search/inspector.rs
  src/core/src/service/search/utils.rs
)

deny_direct='openobserve_core|crate::(common|cipher)::|crate::service::(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)::|crate::service::search::(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)::'
deny_grouped='crate::\{[^;]*\b(common|cipher)\b|crate::\{[^;]*\bservice::(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)\b|crate::\{[^;]*\bservice::search::\{[^;]*\b(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)\b|crate::service::\{[^;]*\b(db|file_list|file_downloader|ingestion|self_reporting|dashboards|http)\b|crate::service::\{[^;]*\bsearch::\{[^;]*\b(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)\b|crate::service::search::\{[^;]*\b(cache|cluster|grpc|partition|streaming|super_cluster|work_group|cardinality|searcher)\b'

if rg "$deny_direct" "${candidate_paths[@]}" || \
  rg -U "$deny_grouped" "${candidate_paths[@]}"; then
  echo 'search engine boundary violation' >&2
  exit 1
fi

if rg 'SearchRuntime|CoreSearchRuntime|set_search_runtime|#\[path|include!' src; then
  echo 'temporary search bridge is forbidden' >&2
  exit 1
fi

echo 'search engine boundary check passed'
