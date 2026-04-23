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

import { getFieldValuesForSuggestion } from "@/composables/useFieldValueStore";
import useSqlSuggestions from "./useSuggestions";

// ─── helper: build composable with common defaults ────────────────────────────
const makeComposable = (overrides: {
  storedValues?: string[];
  inSessionValues?: Record<string, string[]>;
} = {}) => {
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
    ["=",  "status = "],
    ["!=", "status != "],
    ["<>", "status <> "],
    [">=", "code >= "],
    ["<=", "code <= "],
    [">",  "code > "],
    ["<",  "code < "],
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
    c.updateFieldKeywords([
      { name: "status" },
      { name: "env" },
      { name: "_timestamp" },
    ]);
    const labels = c.autoCompleteKeywords.value.map((k: any) => k.label);
    expect(labels).toContain("status");
    expect(labels).toContain("env");
    expect(labels).not.toContain("_timestamp");
  });

  it("sets kind = Field for all field keywords", () => {
    const c = useSqlSuggestions();
    c.updateFieldKeywords([{ name: "status" }, { name: "env" }]);
    const fieldItems = c.autoCompleteKeywords.value.filter(
      (k: any) => k.kind === "Field",
    );
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
    const functionItems = c.effectiveKeywords.value.filter(
      (k: any) => k.kind === "Text",
    );
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
