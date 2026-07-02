#!/usr/bin/env bash
# Regenerates the committed sourcemap fixture artifacts.
#
# The dist/ output, the zips AND manifest.json's generatedColumn values form a
# calibrated set: after any change to src/, rerun this script, then recompute
# the anchor columns (indexOf of each error's identifying token in the
# minified bundle, 1-based) and update manifest.json accordingly.
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD="../rum/npm-app/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "esbuild not found — run 'npm install' in fixtures/rum/npm-app first" >&2
  exit 1
fi

"$ESBUILD" src/index.js --bundle --minify --sourcemap --outfile=dist/main.e2efix01.js

(cd dist && rm -f ../sourcemaps.zip && zip -q ../sourcemaps.zip main.e2efix01.js main.e2efix01.js.map)

TMP_README=$(mktemp)
printf 'not a sourcemap\n' > "$TMP_README"
rm -f invalid.zip
zip -qj invalid.zip "$TMP_README"
rm -f "$TMP_README"

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
