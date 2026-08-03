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
 * The PromQL completion catalog.
 *
 * PromQL completion used to be seven names in an array literal — sum,
 * avg_over_time, rate, avg, max, topk, histogram_quantile — so `irate`,
 * `increase`, `label_replace`, most of the *_over_time family and every
 * grouping modifier were simply undiscoverable.
 *
 * The list is not hand-maintained here either. It reads promqlTerms.ts —
 * Prometheus's own vocabulary with a one-line description per term, generated
 * by scripts/generate-promql-terms.mjs and refreshed by re-running it, not by
 * remembering what Prometheus added last release.
 *
 * Snapshotted rather than imported: the upstream package that publishes those
 * tables requires an unrelated editor library at module scope — for a require
 * it never uses — which dragged ~376 KB of that library's runtime into every
 * route touching PromQL. This app runs on monaco, and only monaco.
 *
 * The vendored grammar's own completion provider would have been the shorter
 * path and is the wrong one: it labels EVERY term `Keyword`, so functions get
 * the keyword glyph — the icon complaint this workstream started from,
 * reintroduced in a second language.
 */

import {
  AGGREGATION_MODIFIER_TERMS,
  AGGREGATION_TERMS,
  AT_MODIFIER_TERMS,
  BINARY_MODIFIER_TERMS,
  BINARY_OPERATOR_TERMS,
  FUNCTION_TERMS,
  type PromqlTerm,
} from "./promqlTerms";
import { SORT_LANE, type CompletionKindName } from "./sqlCompletion";

/** Shaped like SqlCompletionEntry so both languages feed one item builder. */
export interface PromqlCompletionEntry {
  name: string;
  label: string;
  kind: CompletionKindName;
  insertText: string;
  detail?: string;
  documentation?: string;
  sortText?: string;
}

/**
 * Insertion is the label and nothing else.
 *
 * Upstream's reasoning, which holds: some PromQL keywords require parentheses,
 * some forbid them, some are optional, and the term tables carry no signature
 * to tell them apart. `rate(` would help; `by(` would be wrong; nothing here
 * can distinguish the two. The at-modifiers are LABELLED `start()` and `end()`,
 * so they insert their own parens without us inventing any.
 */
const toEntry = (
  term: PromqlTerm,
  kind: CompletionKindName,
  lane: string,
  fallbackDetail: string,
): PromqlCompletionEntry => ({
  name: term.label,
  label: term.label,
  kind,
  insertText: term.label,
  // Upstream fills `detail` for functions and aggregations but leaves the
  // modifiers blank; an entry with no detail renders a bare name beside
  // entries that explain themselves.
  detail: term.detail || fallbackDetail,
  ...(term.info ? { documentation: term.info } : {}),
  sortText: lane + term.label,
});

const byLabel = (a: PromqlCompletionEntry, b: PromqlCompletionEntry) =>
  a.label < b.label ? -1 : a.label > b.label ? 1 : 0;

/**
 * Aggregation operators and function identifiers — everything callable.
 *
 * Both groups are Function: `sum` and `rate` are the same kind of thing to
 * someone typing, whatever Prometheus's grammar calls them.
 */
export const PROMQL_FUNCTIONS: PromqlCompletionEntry[] = [
  ...AGGREGATION_TERMS.map((t) => toEntry(t, "Function", SORT_LANE.function, "aggregation")),
  ...FUNCTION_TERMS.map((t) => toEntry(t, "Function", SORT_LANE.function, "function")),
].sort(byLabel);

/**
 * Modifiers and word-shaped operators.
 *
 * The symbolic binary operators (+, -, ==, =~ …) are dropped: they are typed,
 * not completed, and a dropdown of punctuation is noise. `and`, `or`, `unless`
 * and `atan2` are words, so they stay.
 */
export const PROMQL_KEYWORDS: PromqlCompletionEntry[] = [
  ...AGGREGATION_MODIFIER_TERMS,
  ...BINARY_MODIFIER_TERMS,
  ...AT_MODIFIER_TERMS,
  ...BINARY_OPERATOR_TERMS.filter((t) => /^[a-z_][a-z0-9_]*$/i.test(t.label)),
]
  .map((t) => toEntry(t, "Keyword", SORT_LANE.clause, "modifier"))
  .sort(byLabel);

/**
 * What the editor receives. Deduplicated by label, functions before modifiers.
 */
export const PROMQL_CATALOG: PromqlCompletionEntry[] = (() => {
  const seen = new Set<string>();
  return [...PROMQL_FUNCTIONS, ...PROMQL_KEYWORDS].filter((e) =>
    seen.has(e.label) ? false : (seen.add(e.label), true),
  );
})();
