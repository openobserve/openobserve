#!/usr/bin/env bash
# Regenerates Sources/GeneratedConfig.swift from environment variables (CI uses this to retarget the
# app at a locally-built OpenObserve). With no env set it writes the SAME committed defaults, so it's
# a no-op locally. See docs/CI-NOTES.md.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${O2_RUM_HOST:-https://dev.common-dev.internal.zinclabs.dev}"
ORG="${O2_RUM_ORG:-3HOStgiihM8H43cMLWY3BUfXV5r}"
TOKEN="${O2_RUM_TOKEN:-rumtbJXyJcgC8jB9Otu}"
ENV="${O2_RUM_ENV:-testing}"

cat > Sources/GeneratedConfig.swift <<EOF
// Build-time overridable RUM target. Committed with the default (dev-cluster) values; CI
// regenerates it (gen-config.sh) to point at a locally-built OpenObserve. See docs/CI-NOTES.md.
enum GeneratedConfig {
    static let host = "${HOST}"
    static let org = "${ORG}"
    static let token = "${TOKEN}"
    static let env = "${ENV}"
}
EOF
echo "GeneratedConfig.swift -> ${HOST} ${ORG}"
