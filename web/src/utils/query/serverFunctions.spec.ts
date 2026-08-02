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

// TDD spec for tmp/code.md B4 — turning the server's function registry into
// completion entries and merging it with the hand-written O2 catalog.
//
// The server list is authoritative for WHAT exists (it is derived from the
// DataFusion registry, so it tracks the pinned fork, build features and
// per-org VRL transforms). The local catalog is authoritative for HOW an entry
// should be inserted, because only it knows which arguments are columns and
// which are literals — the distinction A3 was about.

import { describe, it, expect } from "vitest";
import { SQL_FUNCTIONS } from "./sqlCompletion";
import { toCompletionEntries, mergeServerFunctions } from "./serverFunctions";

const serverFn = (over: Record<string, unknown> = {}) => ({
  name: "date_trunc",
  signature: "(precision, timestamp)",
  doc: "Truncate a timestamp to a given precision.",
  kind: "scalar",
  ...over,
});

describe("toCompletionEntries — server payload to catalog entries", () => {
  it("maps name, signature and doc onto the entry shape", () => {
    const [e] = toCompletionEntries([serverFn()]);
    expect(e.name).toBe("date_trunc");
    expect(e.label).toBe("date_trunc");
    expect(e.kind).toBe("Function");
    expect(e.detail).toBe("(precision, timestamp)");
    expect(e.documentation).toBe("Truncate a timestamp to a given precision.");
  });

  it("builds a snippet with one tab stop per declared argument", () => {
    const [e] = toCompletionEntries([serverFn()]);
    expect(e.insertText).toBe("date_trunc(${1:precision}, ${2:timestamp})");
    expect(e.insertTextRules).toBe("InsertAsSnippet");
  });

  it("never reuses a tab stop index", () => {
    const [e] = toCompletionEntries([
      serverFn({ name: "f", signature: "(a, b, c, d)" }),
    ]);
    const indices = [...e.insertText.matchAll(/\$\{(\d+):/g)].map((m) => m[1]);
    expect(indices).toEqual(["1", "2", "3", "4"]);
  });

  it("emits empty parens for a zero-argument function", () => {
    const [e] = toCompletionEntries([serverFn({ name: "now", signature: "()" })]);
    expect(e.insertText).toBe("now()");
  });

  it("falls back to a single tab stop when the signature is unparseable", () => {
    const [e] = toCompletionEntries([serverFn({ name: "weird", signature: undefined })]);
    expect(e.insertText).toBe("weird(${1:arg})");
  });

  it("does not quote any server argument — arity is known, types are not", () => {
    // Quoting is a per-function decision the server list cannot make. Guessing
    // wrong is exactly the A3 bug (sum('field')), so never guess.
    for (const e of toCompletionEntries([serverFn(), serverFn({ name: "concat" })])) {
      expect(e.insertText, `${e.name} must not quote an argument`).not.toContain("'");
    }
  });

  it("flags deprecated entries from the server", () => {
    const [e] = toCompletionEntries([serverFn({ deprecated: true })]);
    expect(e.deprecated).toBe(true);
  });

  it("tolerates an empty or missing payload", () => {
    expect(toCompletionEntries([])).toEqual([]);
    expect(toCompletionEntries(undefined as any)).toEqual([]);
  });

  it("skips entries with no usable name", () => {
    expect(toCompletionEntries([{ name: "" } as any, {} as any])).toEqual([]);
  });
});

describe("mergeServerFunctions — local catalog wins on insertion detail", () => {
  it("keeps the local entry when the server reports the same function", () => {
    // The local sum() knows its argument is a COLUMN; the server only knows
    // the arity. Preferring the server entry would reintroduce sum('field').
    const merged = mergeServerFunctions(SQL_FUNCTIONS, [serverFn({ name: "sum" })]);
    const sum = merged.filter((f) => f.name === "sum");
    expect(sum).toHaveLength(1);
    expect(sum[0].insertText).toBe("sum(${1:field})");
  });

  it("adds server functions the local catalog does not have", () => {
    const merged = mergeServerFunctions(SQL_FUNCTIONS, [serverFn()]);
    expect(merged.some((f) => f.name === "date_trunc")).toBe(true);
  });

  it("keeps every local entry even when the server list is empty", () => {
    const merged = mergeServerFunctions(SQL_FUNCTIONS, []);
    expect(merged).toHaveLength(SQL_FUNCTIONS.length);
  });

  it("returns the local catalog unchanged when the server call failed", () => {
    expect(mergeServerFunctions(SQL_FUNCTIONS, undefined as any)).toEqual(SQL_FUNCTIONS);
  });

  it("produces no duplicate names", () => {
    const merged = mergeServerFunctions(SQL_FUNCTIONS, [
      serverFn({ name: "sum" }),
      serverFn(),
      serverFn(),
    ]);
    const names = merged.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches case-insensitively so SUM does not duplicate sum", () => {
    const merged = mergeServerFunctions(SQL_FUNCTIONS, [serverFn({ name: "SUM" })]);
    expect(merged.filter((f) => f.name.toLowerCase() === "sum")).toHaveLength(1);
  });

  it("marks server-only entries kind Function so they get the right icon", () => {
    const merged = mergeServerFunctions(SQL_FUNCTIONS, [serverFn()]);
    expect(merged.find((f) => f.name === "date_trunc")!.kind).toBe("Function");
  });

  it("sorts deterministically so the dropdown order is stable", () => {
    const a = mergeServerFunctions(SQL_FUNCTIONS, [serverFn(), serverFn({ name: "coalesce" })]);
    const b = mergeServerFunctions(SQL_FUNCTIONS, [serverFn({ name: "coalesce" }), serverFn()]);
    expect(a.map((f) => f.name)).toEqual(b.map((f) => f.name));
  });
});
