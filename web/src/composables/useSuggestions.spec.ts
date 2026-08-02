import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Vuex useStore ───────────────────────────────────────────────────────
vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: vi.fn(() => ({
      state: { zoConfig: { timestamp_column: "_timestamp" } },
    })),
  };
});

// ─── Mock IDB so no real storage is touched ───────────────────────────────────
vi.mock("@/composables/useFieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
}));

// getSuggestions now lazily loads the server function catalog. Stub it to an
// empty list so this suite makes no HTTP call; the fetch itself is covered in
// useSuggestions.serverCatalog.spec.ts.
vi.mock("@/services/query_functions", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: { list: [] } }) },
}));

import { getFieldValuesForSuggestion } from "@/composables/useFieldValueStore";
import useSqlSuggestions from "./useSuggestions";

// ─── helper: build composable with common defaults ────────────────────────────
const makeComposable = (
  overrides: {
    storedValues?: string[];
    inSessionValues?: Record<string, string[]>;
  } = {},
) => {
  const { storedValues = [], inSessionValues = {} } = overrides;
  vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(storedValues);

  const c = useSqlSuggestions();
  c.autoCompleteData.value.org = "myorg";
  c.autoCompleteData.value.streamType = "logs";
  c.autoCompleteData.value.streamName = "http_logs";
  c.autoCompleteData.value.fieldValues = Object.fromEntries(
    Object.entries(inSessionValues).map(([k, v]) => [k, new Set(v)]),
  );
  c.autoCompleteData.value.popup.open = vi.fn();
  return c;
};

const run = async (
  c: ReturnType<typeof useSqlSuggestions>,
  query: string,
  cursorIndex?: number,
) => {
  c.autoCompleteData.value.query = query;
  (c.autoCompleteData.value as any).cursorIndex = cursorIndex ?? query.length;
  await c.getSuggestions();
  return c.effectiveKeywords.value;
};

// ─── operator detection ───────────────────────────────────────────────────────

describe("analyzeSqlWhereClause — operator detection", () => {
  beforeEach(() => vi.clearAllMocks());

  const operators: [string, string][] = [
    ["=", "status = "],
    ["!=", "status != "],
    ["<>", "status <> "],
    [">=", "code >= "],
    ["<=", "code <= "],
    [">", "code > "],
    ["<", "code < "],
  ];

  it.each(operators)("detects field %s operator", async (_op, query) => {
    const c = makeComposable({ storedValues: ["200"] });
    const keywords = await run(c, query);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects IN (", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    const q = "status IN (";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects NOT IN (", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    const q = "status NOT IN (";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects LIKE (space)", async () => {
    const c = makeComposable({ storedValues: ["api"] });
    const keywords = await run(c, "msg LIKE ");
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects LIKE with open quote", async () => {
    const c = makeComposable({ storedValues: ["api"] });
    const q = "msg LIKE '";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects NOT LIKE", async () => {
    const c = makeComposable({ storedValues: ["api"] });
    const q = "path NOT LIKE '";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects str_match(field, )", async () => {
    const c = makeComposable({ storedValues: ["frontend"] });
    const q = "str_match(service, '";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects fuzzy_match(field, )", async () => {
    const c = makeComposable({ storedValues: ["frontend"] });
    const q = "fuzzy_match(service, '";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("handles auto-closed bracket IN () — cursor between ( and )", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    const full = "status IN ()";
    // cursor is between ( and ) — Monaco offset 11, getCursorIndex = offset-1 = 10.
    // slice(0, 10+1) = "status IN (" which matches the IN regex.
    const keywords = await run(c, full, 10);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("detects partial typed value after operator: field = '20", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    const q = "status = '20";
    const keywords = await run(c, q, q.length);
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(true);
  });

  it("falls through to keywords when no operator context", async () => {
    const c = makeComposable({ storedValues: [] });
    const keywords = await run(c, "SELECT * FROM stream WHERE ");
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(false);
    expect(keywords.length).toBeGreaterThan(0);
  });

  it("shows default keywords for empty query", async () => {
    const c = makeComposable({ storedValues: [] });
    const keywords = await run(c, "");
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(false);
    expect(keywords.length).toBeGreaterThan(0);
  });
});

// ─── insertText quoting logic ─────────────────────────────────────────────────

describe("getSuggestions — insertText quoting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps string value in single quotes when no open quote", async () => {
    const c = makeComposable({ storedValues: ["prod"] });
    const keywords = await run(c, "env = ");
    const item = keywords.find((k: any) => k.label === "prod");
    expect(item?.insertText).toBe("'prod'");
  });

  it("closes only when open quote already typed", async () => {
    const c = makeComposable({ storedValues: ["prod"] });
    const q = "env = '";
    const keywords = await run(c, q, q.length);
    const item = keywords.find((k: any) => k.label === "prod");
    expect(item?.insertText).toBe("prod'");
  });

  it("wraps in quotes for second condition when first condition's closing quote is in the query", async () => {
    // Regression: http = 'te' and host = <cursor>
    // The closing quote of 'te' must NOT be mistaken for an open quote for host.
    const c = makeComposable({ storedValues: ["node-1"] });
    const q = "http = 'te' and host = ";
    const keywords = await run(c, q, q.length);
    const item = keywords.find((k: any) => k.label === "node-1");
    expect(item?.insertText).toBe("'node-1'");
  });

  it("closes only when second condition genuinely has an open quote", async () => {
    const c = makeComposable({ storedValues: ["node-1"] });
    const q = "http = 'te' and host = '";
    const keywords = await run(c, q, q.length);
    const item = keywords.find((k: any) => k.label === "node-1");
    expect(item?.insertText).toBe("node-1'");
  });

  it("inserts numeric values without quotes", async () => {
    const c = makeComposable({ storedValues: ["200", "404"] });
    const keywords = await run(c, "status = ");
    const item = keywords.find((k: any) => k.label === "200");
    expect(item?.insertText).toBe("200");
  });

  it("inserts boolean 'true' without quotes", async () => {
    const c = makeComposable({ storedValues: ["true"] });
    const keywords = await run(c, "active = ");
    const item = keywords.find((k: any) => k.label === "true");
    expect(item?.insertText).toBe("true");
  });

  it("inserts boolean 'false' without quotes", async () => {
    const c = makeComposable({ storedValues: ["false"] });
    const keywords = await run(c, "active = ");
    const item = keywords.find((k: any) => k.label === "false");
    expect(item?.insertText).toBe("false");
  });

  it("sortText starts with \\x01 so values sort above keywords", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    const keywords = await run(c, "status = ");
    const item = keywords.find((k: any) => k.kind === "Value");
    expect(item?.sortText.startsWith("\x01")).toBe(true);
  });

  it("all value suggestions have kind = 'Value'", async () => {
    const c = makeComposable({ storedValues: ["200", "404", "500"] });
    const keywords = await run(c, "status = ");
    const valueItems = keywords.filter((k: any) => k.kind === "Value");
    expect(valueItems).toHaveLength(3);
  });
});

// ─── merge: in-session vs stored ─────────────────────────────────────────────

describe("getSuggestions — in-session and stored value merge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows in-session values from fieldValues prop", async () => {
    const c = makeComposable({
      storedValues: [],
      inSessionValues: { status: ["200", "404"] },
    });
    const keywords = await run(c, "status = ");
    const labels = keywords.map((k: any) => k.label);
    expect(labels).toContain("200");
    expect(labels).toContain("404");
  });

  it("merges stored values with in-session values", async () => {
    const c = makeComposable({
      storedValues: ["500"],
      inSessionValues: { status: ["200"] },
    });
    const keywords = await run(c, "status = ");
    const labels = keywords.map((k: any) => k.label);
    expect(labels).toContain("200");
    expect(labels).toContain("500");
  });

  it("deduplicates values appearing in both sources", async () => {
    const c = makeComposable({
      storedValues: ["200", "500"],
      inSessionValues: { status: ["200", "404"] },
    });
    const keywords = await run(c, "status = ");
    const labels = keywords.map((k: any) => k.label);
    expect(labels.filter((l: string) => l === "200")).toHaveLength(1);
    expect(labels).toContain("404");
    expect(labels).toContain("500");
  });

  it("skips IDB read when stream context is missing", async () => {
    const c = useSqlSuggestions();
    // org/streamType/streamName left as empty strings
    c.autoCompleteData.value.fieldValues = {};
    c.autoCompleteData.value.popup.open = vi.fn();
    await run(c, "status = ");
    expect(getFieldValuesForSuggestion).not.toHaveBeenCalled();
  });

  it("falls through to updateAutoComplete when merged is empty", async () => {
    const c = makeComposable({ storedValues: [] });
    const keywords = await run(c, "status = ");
    expect(keywords.some((k: any) => k.kind === "Value")).toBe(false);
    expect(keywords.length).toBeGreaterThan(0);
  });
});

// ─── IDB context forwarding ───────────────────────────────────────────────────

describe("getSuggestions — IDB context forwarding", () => {
  it("passes org/streamType/streamName to getFieldValuesForSuggestion", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["prod"]);
    const c = useSqlSuggestions();
    c.autoCompleteData.value.org = "acme";
    c.autoCompleteData.value.streamType = "traces";
    c.autoCompleteData.value.streamName = "default";
    c.autoCompleteData.value.fieldValues = {};
    c.autoCompleteData.value.popup.open = vi.fn();
    await run(c, "env = ");
    expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(
      { org: "acme", streamType: "traces", streamName: "default" },
      "env",
    );
  });
});

// ─── updateFieldKeywords ──────────────────────────────────────────────────────

describe("updateFieldKeywords", () => {
  it("adds field keywords excluding timestamp column", () => {
    const c = useSqlSuggestions();
    c.updateFieldKeywords([{ name: "status" }, { name: "env" }, { name: "_timestamp" }]);
    const labels = c.autoCompleteKeywords.value.map((k: any) => k.label);
    expect(labels).toContain("status");
    expect(labels).toContain("env");
    expect(labels).not.toContain("_timestamp");
  });

  it("sets kind = Field for all field keywords", () => {
    const c = useSqlSuggestions();
    c.updateFieldKeywords([{ name: "status" }, { name: "env" }]);
    const fieldItems = c.autoCompleteKeywords.value.filter((k: any) => k.kind === "Field");
    expect(fieldItems.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── effectiveSuggestions: no functions when showing values ───────────────────

describe("effectiveSuggestions — empty when value suggestions are shown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is empty when value context is active", async () => {
    const c = makeComposable({ storedValues: ["200", "404"] });
    await run(c, "status = ");
    expect(c.effectiveSuggestions.value).toEqual([]);
  });

  it("effectiveKeywords has no Text-kind function items during value context", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    await run(c, "status = ");
    const functionItems = c.effectiveKeywords.value.filter((k: any) => k.kind === "Text");
    expect(functionItems).toHaveLength(0);
  });

  it("only Value-kind items appear in effectiveKeywords during value context", async () => {
    const c = makeComposable({ storedValues: ["200", "404"] });
    await run(c, "status = ");
    const kinds = c.effectiveKeywords.value.map((k: any) => k.kind);
    expect(kinds.every((kind: string) => kind === "Value")).toBe(true);
  });

  it("is non-empty in normal (non-value) context", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    expect(c.effectiveSuggestions.value.length).toBeGreaterThan(0);
  });

  it("transitions back to non-empty after value context clears", async () => {
    const c = makeComposable({ storedValues: ["200"] });
    // First enter value context
    await run(c, "status = ");
    expect(c.effectiveSuggestions.value).toEqual([]);
    // Then move to a context with no operator match (no stored values for empty)
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue([]);
    c.autoCompleteData.value.fieldValues = {};
    await run(c, "SELECT * FROM stream WHERE ");
    expect(c.effectiveSuggestions.value.length).toBeGreaterThan(0);
  });
});

// ─── Phase 1 (tmp/code.md): catalog wiring ────────────────────────────────────
// The composable must source its suggestions/keywords from the shared
// sqlCompletion catalog rather than its own inline copy (D7), so every surface
// gets identical content.

describe("catalog wiring — suggestions come from the shared sqlCompletion module", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes the full catalog as defaultSuggestions", async () => {
    const { SQL_FUNCTIONS } = await import("@/utils/query/sqlCompletion");
    const c = makeComposable();
    expect(c.defaultSuggestions).toEqual(SQL_FUNCTIONS);
  });

  it("every exposed suggestion is kind Function, never Text (A1)", () => {
    const c = makeComposable();
    for (const s of c.defaultSuggestions as any[]) {
      expect(s.kind, `${s.name ?? s.label}`).toBe("Function");
    }
  });

  it("every exposed suggestion has a static string label (A2)", () => {
    const c = makeComposable();
    for (const s of c.defaultSuggestions as any[]) {
      expect(typeof s.label).toBe("string");
    }
  });

  it("effectiveSuggestions in normal context carries the aggregates", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    for (const agg of ["sum", "avg", "count", "max", "min", "histogram"]) {
      expect(names, `missing ${agg}`).toContain(agg);
    }
  });

  it("keeps field keywords sorted ahead of SQL keywords", async () => {
    const c = makeComposable({ storedValues: [] });
    c.updateFieldKeywords([{ name: "host" }, { name: "level" }]);
    await run(c, "SELECT * FROM stream WHERE ");
    const host = c.effectiveKeywords.value.find((k: any) => k.label === "host");
    const and = c.effectiveKeywords.value.find((k: any) => k.label === "and");
    expect(host.sortText < and.sortText).toBe(true);
  });
});

// ─── Phase 2 (tmp/code.md D1/N5 + B1) ────────────────────────────────────────
// The composable is what Logs/Traces/Alerts actually consume, so the column
// type and the clause keywords have to survive the trip through it — not just
// exist in the catalog.

describe("Phase 2 — column types reach the editor as detail (D1/N5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("carries the column type into each field keyword's detail", () => {
    const c = makeComposable();
    c.updateFieldKeywords([
      { name: "code", type: "Int64" },
      { name: "message", type: "Utf8" },
    ]);
    const code = c.autoCompleteKeywords.value.find((k: any) => k.label === "code");
    const message = c.autoCompleteKeywords.value.find((k: any) => k.label === "message");
    expect(code.detail).toBe("Int64");
    expect(message.detail).toBe("Utf8");
  });

  it("still excludes the timestamp column", () => {
    const c = makeComposable();
    c.updateFieldKeywords([
      { name: "_timestamp", type: "Int64" },
      { name: "code", type: "Int64" },
    ]);
    const labels = c.autoCompleteKeywords.value.map((k: any) => k.label);
    expect(labels).not.toContain("_timestamp");
    expect(labels).toContain("code");
  });

  it("tolerates fields with no type rather than emitting 'undefined'", () => {
    const c = makeComposable();
    c.updateFieldKeywords([{ name: "code" }]);
    const code = c.autoCompleteKeywords.value.find((k: any) => k.label === "code");
    expect(code.detail).toBeUndefined();
  });

  it("carries types through updateAllKeywords too", () => {
    const c = makeComposable();
    c.updateAllKeywords([{ name: "code", type: "Int64" }], []);
    const code = c.autoCompleteKeywords.value.find((k: any) => k.label === "code");
    expect(code.detail).toBe("Int64");
  });
});

describe("Phase 2 — SQL clause keywords are offered (B1)", () => {
  beforeEach(() => vi.clearAllMocks());

  // Decision: clause keywords are NOT gated on SQL mode. They are offered in
  // every SQL-language editor, including the Logs filter-fragment ("non-SQL")
  // mode, where a user may still be composing a full query. There is therefore
  // no mode flag anywhere in this contract — only CONTEXT suppression (see the
  // value-context test below), which is a different thing.

  it("offers clause keywords for a bare filter fragment, not just a full query", () => {
    // The Logs non-SQL mode edits a WHERE fragment; clauses must still appear.
    const c = makeComposable({ storedValues: [] });
    c.updateFieldKeywords([{ name: "level", type: "Utf8" }]);
    const labels = c.autoCompleteKeywords.value.map((k: any) => k.label);
    for (const kw of ["SELECT", "FROM", "WHERE"]) {
      expect(labels, `missing ${kw} in fragment mode`).toContain(kw);
    }
  });

  it("includes SELECT/FROM/WHERE in the base keyword list", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    const labels = c.effectiveKeywords.value.map((k: any) => k.label);
    for (const kw of ["SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT"]) {
      expect(labels, `missing ${kw}`).toContain(kw);
    }
  });

  it("keeps predicates alongside the clauses", async () => {
    const c = makeComposable({ storedValues: [] });
    await run(c, "SELECT * FROM stream WHERE ");
    const labels = c.effectiveKeywords.value.map((k: any) => k.label);
    expect(labels).toContain("and");
    expect(labels).toContain("=");
  });

  it("suppresses clause keywords in value context", async () => {
    const c = makeComposable({ storedValues: ["error"] });
    await run(c, "level = ");
    const labels = c.effectiveKeywords.value.map((k: any) => k.label);
    expect(labels).not.toContain("SELECT");
    expect(labels).toEqual(["error"]);
  });

  it("sorts fields ahead of clause keywords", async () => {
    const c = makeComposable({ storedValues: [] });
    c.updateFieldKeywords([{ name: "host", type: "Utf8" }]);
    await run(c, "SELECT * FROM stream WHERE ");
    const host = c.effectiveKeywords.value.find((k: any) => k.label === "host");
    const select = c.effectiveKeywords.value.find((k: any) => k.label === "SELECT");
    expect(host.sortText < select.sortText).toBe(true);
  });
});

// ─── Phase 2 (tmp/code.md B4) — server functions must actually REACH the editor
// Testing mergeServerFunctions in isolation would repeat the Phase 1 mistake:
// the helper can be perfect while nothing wires it to what the editor consumes.

describe("Phase 2 — server-supplied functions reach the suggestion list (B4)", () => {
  beforeEach(() => vi.clearAllMocks());

  const serverList = [
    { name: "date_trunc", signature: "(precision, timestamp)", doc: "Truncate a timestamp." },
    { name: "coalesce", signature: "(a, b)", doc: "First non-null argument." },
  ];

  it("adds server-only functions to what the editor receives", async () => {
    const c = makeComposable({ storedValues: [] });
    c.setServerFunctions(serverList);
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("date_trunc");
    expect(names).toContain("coalesce");
  });

  it("keeps the hand-written O2 catalog alongside them", async () => {
    const c = makeComposable({ storedValues: [] });
    c.setServerFunctions(serverList);
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    for (const local of ["match_all", "histogram", "approx_topk"]) {
      expect(names, `lost local ${local}`).toContain(local);
    }
  });

  it("does NOT let a server entry override local insertion detail", async () => {
    // The server knows arity, not which arguments are columns. Letting it win
    // would reintroduce sum('field') — the A3 bug Phase 1 fixed.
    const c = makeComposable({ storedValues: [] });
    c.setServerFunctions([{ name: "sum", signature: "(expr)", doc: "Sum." }]);
    await run(c, "SELECT * FROM stream WHERE ");
    const sums = (c.effectiveSuggestions.value as any[]).filter((s) => s.name === "sum");
    expect(sums).toHaveLength(1);
    expect(sums[0].insertText).toBe("sum(${1:field})");
  });

  it("still blanks the suggestion list in value context", async () => {
    const c = makeComposable({ storedValues: ["error"] });
    c.setServerFunctions(serverList);
    await run(c, "level = ");
    expect(c.effectiveSuggestions.value).toEqual([]);
  });

  it("is a no-op when the server call returned nothing", async () => {
    const c = makeComposable({ storedValues: [] });
    c.setServerFunctions([]);
    await run(c, "SELECT * FROM stream WHERE ");
    const names = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(names).toContain("match_all");
  });

  it("survives a failed server call without throwing", async () => {
    const c = makeComposable({ storedValues: [] });
    expect(() => c.setServerFunctions(undefined as any)).not.toThrow();
    await run(c, "SELECT * FROM stream WHERE ");
    expect((c.effectiveSuggestions.value as any[]).length).toBeGreaterThan(0);
  });
});

// ─── Org VRL functions arrive by TWO paths ───────────────────────────────────
// updateFunctionKeywords puts them in autoCompleteKeywords (the `keywords`
// prop) and the server catalog puts the same names in autoCompleteSuggestions
// (the `suggestions` prop). Monaco concatenates both, so the user sees each org
// function twice — and the two entries disagree on quoting, so the duplicates
// insert different text.

describe("org VRL functions are offered exactly once", () => {
  beforeEach(() => vi.clearAllMocks());

  const seedBothPaths = (c: ReturnType<typeof useSqlSuggestions>) => {
    // legacy path (Logs/Traces/Dashboards fetch these and pass args)
    c.updateFunctionKeywords([{ name: "my_vrl_fn", args: "('${1:value}')" }]);
    // server catalog reports the very same org transform
    c.setServerFunctions([
      { name: "my_vrl_fn", signature: "(arg1)", doc: "Org function.", kind: "vrl" },
      { name: "date_trunc", signature: "(precision, timestamp)", doc: "T.", kind: "scalar" },
    ]);
  };

  it("keeps the org function in keywords and drops it from suggestions", async () => {
    const c = makeComposable({ storedValues: [] });
    seedBothPaths(c);
    await run(c, "SELECT * FROM stream WHERE ");

    const keywords = c.effectiveKeywords.value.map((k: any) => k.label);
    const suggestions = (c.effectiveSuggestions.value as any[]).map((s) => s.name);

    expect(keywords).toContain("my_vrl_fn");
    expect(
      suggestions,
      "server catalog re-added a function the keywords already carry",
    ).not.toContain("my_vrl_fn");
  });

  it("still adds server functions the keywords path does NOT carry", async () => {
    const c = makeComposable({ storedValues: [] });
    seedBothPaths(c);
    await run(c, "SELECT * FROM stream WHERE ");
    const suggestions = (c.effectiveSuggestions.value as any[]).map((s) => s.name);
    expect(suggestions).toContain("date_trunc");
  });

  it("offers exactly one completion item for the org function", async () => {
    const { buildCompletionItems } = await import("@/utils/query/sqlCompletion");
    const c = makeComposable({ storedValues: [] });
    seedBothPaths(c);
    await run(c, "SELECT * FROM stream WHERE ");

    // Mirrors what CodeQueryEditor hands monaco: keywords ++ suggestions.
    const items = buildCompletionItems({
      keywords: c.effectiveKeywords.value as any[],
      suggestions: c.effectiveSuggestions.value as any[],
      word: "",
      range: {},
      kinds: { Function: 1, Keyword: 17, Field: 3, Operator: 11, Value: 13, Text: 18 },
      insertTextRules: { InsertAsSnippet: 4 },
    });
    const hits = items.filter((i: any) => i.label === "my_vrl_fn");
    expect(hits).toHaveLength(1);
    // The surviving entry keeps the legacy quoting that has always shipped.
    expect(hits[0].insertText).toBe("my_vrl_fn('${1:value}')");
  });
});

// ─── Phase 3 C4: the composable must expose the value resolver ───────────────
// The provider-level test injects a fieldValueResolver straight into
// CodeQueryEditor, which proves the component can use one but not that anything
// supplies it. Alerts bound the wrong list, the SLO form never loaded the
// catalog, and Traces omitted a prop — all "the helper works, nobody calls it".
// The resolver therefore comes from the composable every surface already uses.

describe("Phase 3 — resolveFieldValues is exposed for the editor to await", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes a resolver", () => {
    const c = makeComposable({ storedValues: [] });
    expect(typeof (c as any).resolveFieldValues).toBe("function");
  });

  it("returns the stored values for a field", async () => {
    const c = makeComposable({ storedValues: ["error", "warn"] });
    await expect((c as any).resolveFieldValues("level")).resolves.toEqual(
      expect.arrayContaining(["error", "warn"]),
    );
  });

  it("merges in-session values ahead of stored ones", async () => {
    const c = makeComposable({
      storedValues: ["stored_only"],
      inSessionValues: { level: ["fresh"] },
    });
    const values = await (c as any).resolveFieldValues("level");
    expect(values[0]).toBe("fresh");
    expect(values).toContain("stored_only");
  });

  it("resolves to an empty list rather than throwing when the lookup fails", async () => {
    const c = makeComposable({ storedValues: [] });
    vi.mocked(getFieldValuesForSuggestion).mockRejectedValueOnce(new Error("idb down"));
    await expect((c as any).resolveFieldValues("level")).resolves.toEqual([]);
  });

  it("resolves to an empty list when no stream context is set", async () => {
    const c = makeComposable({ storedValues: ["error"] });
    c.autoCompleteData.value.streamName = "";
    await expect((c as any).resolveFieldValues("level")).resolves.toEqual([]);
  });
});
