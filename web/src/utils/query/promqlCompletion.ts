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
 * The list is not hand-maintained here either. It is derived from the term
 * tables in @prometheus-io/codemirror-promql: Prometheus's own vocabulary,
 * carrying a one-line description per term, and versioned with the upstream
 * package rather than with our memory of what Prometheus added last release.
 * monaco-promql (already a dependency, already used here for the tokenizer)
 * builds its keyword list from exactly these tables.
 *
 * Registering monaco-promql's own completion provider would have been the
 * shorter path and is the wrong one: it labels EVERY term `Keyword`, so
 * functions get the keyword glyph — the icon complaint this workstream started
 * from, reintroduced in a second language.
 */

import {
  aggregateOpModifierTerms,
  aggregateOpTerms,
  atModifierTerms,
  binOpModifierTerms,
  binOpTerms,
  functionIdentifierTerms,
} from "@prometheus-io/codemirror-promql/dist/cjs/complete/promql.terms";
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

/** One upstream term. `info` is the human description; `detail` the group. */
interface PromqlTerm {
  label: string;
  detail?: string;
  info?: string;
  type?: string;
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
  ...(aggregateOpTerms as PromqlTerm[]).map((t) =>
    toEntry(t, "Function", SORT_LANE.function, "aggregation"),
  ),
  ...(functionIdentifierTerms as PromqlTerm[]).map((t) =>
    toEntry(t, "Function", SORT_LANE.function, "function"),
  ),
].sort(byLabel);

/**
 * Modifiers and word-shaped operators.
 *
 * The symbolic binary operators (+, -, ==, =~ …) are dropped: they are typed,
 * not completed, and a dropdown of punctuation is noise. `and`, `or`, `unless`
 * and `atan2` are words, so they stay.
 */
export const PROMQL_KEYWORDS: PromqlCompletionEntry[] = [
  ...(aggregateOpModifierTerms as PromqlTerm[]),
  ...(binOpModifierTerms as PromqlTerm[]),
  ...(atModifierTerms as PromqlTerm[]),
  ...(binOpTerms as PromqlTerm[]).filter((t) => /^[a-z_][a-z0-9_]*$/i.test(t.label)),
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
