// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Regenerates src/utils/query/promqlTerms.ts from Prometheus's own term tables.
 *
 *   npm i --no-save @prometheus-io/codemirror-promql
 *   node scripts/generate-promql-terms.mjs
 *   npm r --no-save @prometheus-io/codemirror-promql
 *
 * The package is NOT a dependency, deliberately: its terms module does
 * `require("@codemirror/autocomplete")` at module scope — a require it never
 * uses — which pulled ~376 KB of the CodeMirror runtime into every route that
 * touches PromQL. Snapshotting the data keeps the vocabulary and drops the
 * runtime. Run this after a Prometheus release and commit the diff.
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const TERMS = "@prometheus-io/codemirror-promql/dist/cjs/complete/promql.terms";

let terms;
try {
  terms = require(TERMS);
} catch {
  console.error(
    "@prometheus-io/codemirror-promql is not installed.\n" +
      "  npm i --no-save @prometheus-io/codemirror-promql",
  );
  process.exit(1);
}

const version = require("@prometheus-io/codemirror-promql/package.json").version;

/** Keep only the three fields we render; drop upstream's editor-specific rest. */
const pick = (rows) =>
  rows.map((row) => ({
    label: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.info ? { info: row.info } : {}),
  }));

const groups = {
  AGGREGATION_TERMS: pick(terms.aggregateOpTerms),
  FUNCTION_TERMS: pick(terms.functionIdentifierTerms),
  AGGREGATION_MODIFIER_TERMS: pick(terms.aggregateOpModifierTerms),
  BINARY_MODIFIER_TERMS: pick(terms.binOpModifierTerms),
  AT_MODIFIER_TERMS: pick(terms.atModifierTerms),
  BINARY_OPERATOR_TERMS: pick(terms.binOpTerms),
};

const header = `// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The PromQL vocabulary: every aggregation, function, modifier and word-shaped
 * operator the language has, with Prometheus's own one-line description.
 *
 * GENERATED, not written. Snapshot of Prometheus's own term tables v${version}
 * (Apache-2.0), taken with scripts/generate-promql-terms.mjs — the one place
 * that names the package, because it is the thing you install to regenerate.
 *
 * A snapshot and not an import for one reason: that package's terms module
 * requires an unrelated editor library at module scope — for a require it never
 * actually uses — which dragged ~376 KB of that library's runtime into every
 * route touching PromQL. This app runs on monaco, and now so does its bundle,
 * exclusively.
 *
 * To refresh after a Prometheus release: install the package, run the script,
 * commit the diff. The data is inert — labels and prose, no behaviour.
 */

export interface PromqlTerm {
  label: string;
  /** Upstream's group name: "function", "aggregation". Absent on modifiers. */
  detail?: string;
  /** Upstream's one-line description. Absent on the set operators. */
  info?: string;
}
`;

const body = Object.entries(groups)
  .map(([name, rows]) => `export const ${name}: PromqlTerm[] = ${JSON.stringify(rows, null, 2)};`)
  .join("\n\n");

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/utils/query/promqlTerms.ts");
writeFileSync(out, `${header}\n${body}\n`);

console.log(
  `wrote ${out} from v${version}: ` +
    Object.entries(groups)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(" "),
);
