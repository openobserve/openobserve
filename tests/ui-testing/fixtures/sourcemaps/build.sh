#!/usr/bin/env bash
# Regenerates the committed sourcemap fixture dist/ artifacts.
#
# The dist/ output AND manifest.json's generatedColumn values form a
# calibrated set: after any change to src/, rerun this script, then recompute
# the anchor columns (indexOf of each error's identifying token in the
# minified bundle, 1-based) and update manifest.json accordingly.
#
# NOTE: only the (diffable, text) dist/ files are committed. The upload ZIPs
# are generated AT TEST TIME from these files by the specs, via
# tests/ui-testing/playwright-tests/utils/zip-builder.js — no opaque .zip
# binaries live in the repo.
#
# Why not tests/ui-testing/playwright-tests/utils/sourcemap-helpers.js? That
# helper builds MD_Files/Sourcemaps/o2-sourcemap-test-app, which is not
# committed to this repo (and nothing imports the helper) — this fixture is
# the committed, deterministic replacement for that flow.
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD="../rum/npm-app/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "esbuild not found — run 'npm ci' in fixtures/rum/npm-app first" >&2
  exit 1
fi

"$ESBUILD" src/index.js --bundle --minify --sourcemap --outfile=dist/main.e2efix01.js

echo "Fixture rebuilt. Anchor columns (update manifest.json if changed):"
node -e "
const fs = require('fs');
const js = fs.readFileSync('dist/main.e2efix01.js', 'utf8');
const anchors = {
  typeError: 'e.profile.name',
  referenceError: 'undeclaredVariableThatDoesNotExist',
  rangeError: 'new Array(-1)',
  customError: 'Insufficient funds in account',
};
for (const [k, a] of Object.entries(anchors)) console.log(' ', k, '-> col', js.indexOf(a) + 1);
"
