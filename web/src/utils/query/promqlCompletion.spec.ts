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

// TDD spec for tmp/code.md item 18 (section E) — the PromQL catalog.
//
// PromQL completion is a SEVEN-function hardcode in usePromqlSuggestions.ts:
// sum, avg_over_time, rate, avg, max, topk, histogram_quantile. Everything else
// a user might type is absent — irate, increase, delta, label_replace, the rest
// of the *_over_time family, the clamp_* pair, and the by/without/on/ignoring
// grouping modifiers that every non-trivial query needs.
//
// The fix is the same one B4 applied to SQL: stop hand-maintaining a list.
// monaco-promql (already a dependency, already used for the tokenizer) builds
// its own keyword list from @prometheus-io/codemirror-promql's term tables —
// Prometheus's own vocabulary, versioned with the upstream package. This module
// reads those tables and shapes them into the entry format the editor already
// consumes, so PromQL and SQL differ in content and in nothing else.
//
// What this spec does NOT do is re-list the terms it expects. A test that
// hardcodes the catalog it is checking only proves someone typed the same list
// twice; the assertions below are about SHAPE, about the specific gaps that
// were reported, and about the catalog being upstream-derived at all.

import { describe, it, expect } from "vitest";
import { SORT_LANE } from "./sqlCompletion";
import { PROMQL_FUNCTIONS, PROMQL_KEYWORDS, PROMQL_CATALOG } from "./promqlCompletion";

const labels = (list: { label: string }[]) => list.map((e) => e.label);
const find = (label: string) => PROMQL_CATALOG.find((e) => e.label === label);

describe("PROMQL_FUNCTIONS — aggregations and function identifiers", () => {
  it("keeps every function the hardcoded list already had", () => {
    // The seven that shipped. Losing one while "improving" the catalog would be
    // a regression no other test in this file would notice.
    for (const fn of ["sum", "avg_over_time", "rate", "avg", "max", "topk", "histogram_quantile"]) {
      expect(labels(PROMQL_FUNCTIONS), `lost ${fn}`).toContain(fn);
    }
  });

  it("offers the functions the hardcoded list was missing", () => {
    // Named in the report: the ones a user reaches for immediately after the
    // seven, and never found.
    for (const fn of [
      "irate",
      "increase",
      "delta",
      "idelta",
      "min",
      "count",
      "quantile",
      "label_replace",
      "label_join",
      "clamp_max",
      "clamp_min",
      "absent",
      "absent_over_time",
      "sum_over_time",
      "max_over_time",
      "min_over_time",
      "count_over_time",
      "quantile_over_time",
      "stddev_over_time",
    ]) {
      expect(labels(PROMQL_FUNCTIONS), `missing ${fn}`).toContain(fn);
    }
  });

  it("carries the whole *_over_time family, not a sample of it", () => {
    // The family is the most common source of "I know this function exists".
    const overTime = labels(PROMQL_FUNCTIONS).filter((l) => l.endsWith("_over_time"));
    expect(overTime.length).toBeGreaterThanOrEqual(10);
  });

  it("marks them Function, so they get the function glyph", () => {
    // The PromQL form of A1. monaco-promql's own provider labels EVERY term
    // Keyword, which is why simply registering it would reintroduce the icon
    // bug this workstream started from.
    for (const e of PROMQL_FUNCTIONS) {
      expect(e.kind, `${e.label} is not a Function`).toBe("Function");
    }
  });
});

describe("PROMQL_KEYWORDS — modifiers and operators", () => {
  it("offers the grouping modifiers", () => {
    // by/without decide what an aggregation returns; on/ignoring and
    // group_left/group_right decide whether a binary op matches at all.
    for (const kw of ["by", "without", "on", "ignoring", "group_left", "group_right", "bool"]) {
      expect(labels(PROMQL_KEYWORDS), `missing ${kw}`).toContain(kw);
    }
  });

  it("offers the set operators", () => {
    for (const op of ["and", "or", "unless"]) {
      expect(labels(PROMQL_KEYWORDS), `missing ${op}`).toContain(op);
    }
  });

  it("does NOT mark a modifier as a Function", () => {
    // `by` is not callable. Kind drives the glyph, and a wrong glyph is the
    // complaint that opened this workstream.
    for (const e of PROMQL_KEYWORDS) {
      expect(e.kind, `${e.label} claims to be a Function`).not.toBe("Function");
    }
  });

  it("does not offer the symbolic operators as completions", () => {
    // The upstream table includes +, -, ==, =~ and friends. They are typed, not
    // completed, and a dropdown of punctuation is noise.
    for (const sym of ["+", "-", "==", "=~", "^", "!="]) {
      expect(labels(PROMQL_KEYWORDS), `offered ${sym}`).not.toContain(sym);
    }
  });
});

describe("PROMQL_CATALOG — the merged list the editor receives", () => {
  it("is the union of both lists", () => {
    expect(PROMQL_CATALOG.length).toBe(PROMQL_FUNCTIONS.length + PROMQL_KEYWORDS.length);
  });

  it("is derived from the upstream term tables, not hand-written", () => {
    // Deep cuts nobody types from memory: if these are present, the catalog was
    // built from @prometheus-io/codemirror-promql rather than a list someone
    // curated (and would then have to re-curate on every Prometheus release).
    for (const fn of [
      "ts_of_max_over_time",
      "limit_ratio",
      "mad_over_time",
      "double_exponential_smoothing",
    ]) {
      expect(labels(PROMQL_CATALOG), `${fn} absent — catalog looks hand-written`).toContain(fn);
    }
  });

  it("is far larger than the seven it replaces", () => {
    // Guards the failure mode where the upstream import silently resolves to
    // nothing and the catalog quietly becomes [] — every other assertion here
    // would still pass on an empty list only if it were also empty of names.
    expect(PROMQL_CATALOG.length).toBeGreaterThan(90);
  });

  it("has no duplicate labels", () => {
    const seen = labels(PROMQL_CATALOG);
    expect(new Set(seen).size, `duplicates: ${seen.filter((l, i) => seen.indexOf(l) !== i)}`).toBe(
      seen.length,
    );
  });

  it("gives every entry a label, a name and something to insert", () => {
    for (const e of PROMQL_CATALOG) {
      expect(e.label, "entry with no label").toBeTruthy();
      expect(e.name, `${e.label} has no name`).toBe(e.label);
      expect(e.insertText, `${e.label} has nothing to insert`).toBeTruthy();
    }
  });

  it("inserts exactly what it shows", () => {
    // No decoration of any kind, which upstream argues for and is right about:
    // some PromQL keywords require parentheses, some forbid them, some are
    // optional, and the term tables carry no signature to tell them apart.
    // `rate(` would be helpful, `by(` is wrong, and nothing here can
    // distinguish the two — so add nothing.
    //
    // Stated as insertText === label rather than "contains no parens", because
    // the at-modifiers are LABELLED `start()` and `end()` upstream. Inserting
    // those verbatim is not inventing anything; a rule about the character
    // would have banned a valid term.
    for (const e of PROMQL_CATALOG) {
      expect(e.insertText, `${e.label} does not insert itself`).toBe(e.label);
    }
  });

  it("carries upstream's description as documentation", () => {
    // The one-line description is why hover and the docs panel are worth having
    // here at all.
    //
    // The expected text is upstream's exact wording for `rate`. An earlier
    // draft asserted the documentation merely CONTAINED "rate", which reads
    // like a safe loose check and is in fact unsatisfiable: the sentence is
    // "Calculate per-second increase over a range vector (for counters)" and
    // the word "rate" never appears in it.
    expect(find("rate")!.documentation).toBe(
      "Calculate per-second increase over a range vector (for counters)",
    );
    // Upstream leaves `info` off exactly three terms (and, or, unless), so
    // near-total coverage is the real invariant, not every single entry.
    const withDocs = PROMQL_CATALOG.filter((e) => e.documentation);
    expect(withDocs.length / PROMQL_CATALOG.length).toBeGreaterThan(0.8);
  });

  it("distinguishes the two groups in the detail column", () => {
    // Upstream fills `detail` for functions and aggregations ("function",
    // "aggregation") but leaves the modifiers blank, so this one is ours to
    // supply — an entry with no detail renders a bare name next to entries that
    // explain themselves.
    expect(find("rate")!.detail).toBeTruthy();
    expect(find("by")!.detail).toBeTruthy();
    expect(find("rate")!.detail).not.toBe(find("by")!.detail);
  });

  it("sorts functions above modifiers", () => {
    // Same lane scheme SQL uses, so the two languages rank consistently and a
    // shared item builder needs no special case.
    expect(find("rate")!.sortText!.startsWith(SORT_LANE.function)).toBe(true);
    expect(find("by")!.sortText!.startsWith(SORT_LANE.clause)).toBe(true);
    expect(find("rate")!.sortText! < find("by")!.sortText!).toBe(true);
  });

  it("orders alphabetically inside each lane", () => {
    const fnSorts = PROMQL_FUNCTIONS.map((e) => e.sortText!);
    expect([...fnSorts].sort()).toEqual(fnSorts);
  });
});
