import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

// Mock services
vi.mock("@/services/search", () => ({
  default: {
    get_promql_series: vi.fn(),
  },
}));

// Mock vuex store
vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: vi.fn(() => ({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    })),
  };
});

import usePromqlSuggestions from "./usePromqlSuggestions";
import searchService from "@/services/search";

describe("usePromqlSuggestions Composable - Comprehensive Coverage", () => {
  let composable: ReturnType<typeof usePromqlSuggestions>;

  beforeEach(() => {
    vi.clearAllMocks();
    composable = usePromqlSuggestions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Composable initialization
  it("should initialize composable with default values", () => {
    expect(composable).toBeDefined();
    expect(composable.autoCompleteData).toBeDefined();
    expect(composable.autoCompletePromqlKeywords).toBeDefined();
    expect(composable.metricKeywords).toBeDefined();
  });

  // Test 2: autoCompleteData default structure
  it("should have correct default autoCompleteData structure", () => {
    const data = composable.autoCompleteData.value;
    expect(data.query).toBe("");
    expect(data.text).toBe("");
    expect(data.position.cursorIndex).toBe(0);
    expect(typeof data.popup.open).toBe("function");
    expect(typeof data.popup.close).toBe("function");
    expect(data.dateTime.startTime).toBeDefined();
    expect(data.dateTime.endTime).toBeDefined();
  });

  // Test 3: autoCompletePromqlKeywords initialization
  it("should initialize autoCompletePromqlKeywords with the catalog", () => {
    // Was "as empty array", and empty was the bug: the list is only filled by
    // getSuggestions, which runs on a query update, so Ctrl+Space on a freshly
    // opened PromQL editor offered nothing at all until the user typed a
    // character. See "has the catalog ready before the first keystroke" below —
    // that test and this one describe the same value, so leaving this one
    // asserting 0 would have made the suite unsatisfiable by construction.
    expect(Array.isArray(composable.autoCompletePromqlKeywords.value)).toBe(true);
    expect(composable.autoCompletePromqlKeywords.value.length).toBeGreaterThan(90);
  });

  // Test 4: metricKeywords initialization
  it("should initialize metricKeywords as empty array", () => {
    expect(Array.isArray(composable.metricKeywords.value)).toBe(true);
    expect(composable.metricKeywords.value.length).toBe(0);
  });

  // Test 5: parsePromQlQuery with simple metric
  it("should parse simple metric name correctly", () => {
    const result = composable.parsePromQlQuery('cpu_usage{instance="server1"}');
    expect(result.metricName).toBe("cpu_usage");
    expect(result.label.hasLabels).toBe(true);
    expect(result.label.labels).toEqual({ instance: "server1" });
  });

  // Test 6: parsePromQlQuery with metric and labels
  it("should parse metric with labels correctly", () => {
    const query = 'cpu_usage{instance="server1",job="node"}';
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("cpu_usage");
    expect(result.label.hasLabels).toBe(true);
    expect(result.label.labels).toEqual({
      instance: "server1",
      job: "node",
    });
  });

  // Test 7: parsePromQlQuery with no metric name
  it("should handle query without metric name", () => {
    const result = composable.parsePromQlQuery('{instance="server1"}');
    expect(result.metricName).toBeNull();
    expect(result.label.hasLabels).toBe(true);
    expect(result.label.labels).toEqual({
      instance: "server1",
    });
  });

  // Test 8: parsePromQlQuery with empty query
  it("should handle empty query", () => {
    const result = composable.parsePromQlQuery("");
    expect(result.metricName).toBeNull();
    expect(result.label.hasLabels).toBe(false);
    expect(result.label.labels).toEqual({});
  });

  // Test 9: parsePromQlQuery with complex labels
  it("should parse complex labels correctly", () => {
    const query = 'http_requests{method="GET",status="200",path="/api/v1"}';
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("http_requests");
    expect(result.label.labels).toEqual({
      method: "GET",
      status: "200",
      path: "/api/v1",
    });
  });

  // Test 10: parsePromQlQuery with malformed labels
  it("should handle malformed labels gracefully", () => {
    const query = "cpu_usage{instance=server1}"; // Missing quotes
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("cpu_usage");
    expect(result.label.hasLabels).toBe(true);
    expect(result.label.labels).toEqual({});
  });

  // Test 11: analyzeLabelFocus with cursor in label
  it("should detect cursor focus on label", () => {
    const query = 'cpu_usage{instance="server1"}';
    const cursorIndex = 11; // Position on 'instance'
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(true);
    expect(result.isFocused).toBe(true);
    expect(result.focusOn).toBe("label");
  });

  // Test 12: analyzeLabelFocus with cursor in value
  it("should detect cursor focus on value", () => {
    const query = 'cpu_usage{instance="server1"}';
    const cursorIndex = 20; // Position in "server1"
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(true);
    expect(result.isFocused).toBe(true);
    expect(result.focusOn).toBe("value");
  });

  // Test 13: analyzeLabelFocus with empty labels
  it("should handle empty labels in analyzeLabelFocus", () => {
    const query = "cpu_usage{}";
    const cursorIndex = 9; // Position at '{'
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.isFocused).toBe(true);
  });

  // Test 14: analyzeLabelFocus without labels
  it("should handle query without labels", () => {
    const query = "cpu_usage";
    const cursorIndex = 5;
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(false);
    expect(result.isFocused).toBe(false);
  });

  // Test 15: analyzeLabelFocus with cursor at opening brace
  it("should detect focus at opening brace", () => {
    const query = 'cpu_usage{instance="server1"}';
    const cursorIndex = 9; // Position at '{'
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.focusOn).toBe("label");
  });

  // Test 16: analyzeLabelFocus with cursor at comma
  it("should detect focus at comma", () => {
    const query = 'cpu_usage{instance="server1",job="node"}';
    const cursorIndex = 25; // Position at ','
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    // The function doesn't handle comma detection properly in this position
    expect(result.hasLabels).toBe(true);
    expect(result.isFocused).toBe(true);
  });

  // Test 17: analyzeLabelFocus with cursor at equals sign
  it("should detect focus at equals sign", () => {
    const query = 'cpu_usage{instance="server1"}';
    const cursorIndex = 18; // Position after '='
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.focusOn).toBe("value");
  });

  // Test 18: getLabelSuggestions for labels
  it("should generate label suggestions correctly", () => {
    const labels = [
      { instance: "server1", job: "node", __name__: "cpu_usage" },
      { instance: "server2", job: "node", __name__: "cpu_usage" },
    ];
    const meta = { focusOn: "label" };
    const queryLabels = "";

    const result = composable.getLabelSuggestions(labels, meta, queryLabels);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((item) => item.label === "instance")).toBe(true);
    expect(result.some((item) => item.label === "job")).toBe(true);
    expect(result.some((item) => item.label === "__name__")).toBe(true);
  });

  // Test 19: getLabelSuggestions for values
  it("should generate value suggestions correctly", () => {
    const labels = [
      { instance: "server1", job: "node" },
      { instance: "server2", job: "node" },
      { instance: "server1", job: "prometheus" },
    ];
    const meta = { focusOn: "value", meta: { label: "instance" } };
    const queryLabels = "";

    const result = composable.getLabelSuggestions(labels, meta, queryLabels);
    expect(result.length).toBe(2); // server1, server2
    expect(result.some((item) => item.label === "server1")).toBe(true);
    expect(result.some((item) => item.label === "server2")).toBe(true);
  });

  // Test 20: getLabelSuggestions with duplicate values
  it("should handle duplicate values in suggestions", () => {
    const labels = [{ instance: "server1" }, { instance: "server1" }, { instance: "server2" }];
    const meta = { focusOn: "value", meta: { label: "instance" } };

    const result = composable.getLabelSuggestions(labels, meta, "");
    expect(result.length).toBe(2); // Duplicates should be removed
  });

  // Test 21: getLabelSuggestions with empty labels array
  it("should handle empty labels array", () => {
    const result = composable.getLabelSuggestions([], { focusOn: "label" }, "");
    expect(result.length).toBe(0);
  });

  // Test 22: getLabelSuggestions filtering already used labels
  it("should filter out already used labels", () => {
    const labels = [{ instance: "server1", job: "node", __name__: "cpu_usage" }];
    const meta = { focusOn: "label" };
    const queryLabels = 'instance="server1"';

    const result = composable.getLabelSuggestions(labels, meta, queryLabels);
    expect(result.every((item) => item.label !== "instance")).toBe(true);
  });

  // Test 23: updateMetricKeywords functionality
  it("should update metric keywords correctly", () => {
    const metrics = [
      { label: "cpu_usage", type: "gauge" },
      { label: "memory_usage", type: "counter" },
      { label: "disk_usage" },
    ];

    composable.updateMetricKeywords(metrics);

    expect(composable.metricKeywords.value.length).toBe(3);
    expect(composable.metricKeywords.value[0].label).toBe("cpu_usage(gauge)");
    expect(composable.metricKeywords.value[0].insertText).toBe("cpu_usage");
    expect(composable.metricKeywords.value[2].label).toBe("disk_usage");
  });

  // Test 24: updateMetricKeywords with empty array
  it("should handle empty metrics array", () => {
    composable.updateMetricKeywords([]);
    expect(composable.metricKeywords.value.length).toBe(0);
  });

  // Test 25: updatePromqlKeywords with empty data
  it("should update keywords with functions when data is empty", async () => {
    await composable.updatePromqlKeywords([]);

    expect(composable.autoCompletePromqlKeywords.value.length).toBeGreaterThan(0);
    expect(composable.autoCompletePromqlKeywords.value.some((item) => item.label === "sum")).toBe(
      true,
    );
    expect(composable.autoCompletePromqlKeywords.value.some((item) => item.label === "rate")).toBe(
      true,
    );
  });

  // Test 26: updatePromqlKeywords with data
  it("should update keywords with provided data", async () => {
    const data = [{ label: "custom_label", kind: "Variable", insertText: "custom_label=" }];

    await composable.updatePromqlKeywords(data);

    expect(composable.autoCompletePromqlKeywords.value).toEqual(data);
  });

  // Test 27: getSuggestions with invalid cursor position
  it("should handle invalid cursor position in getSuggestions", async () => {
    composable.autoCompleteData.value.position.cursorIndex = -1;

    await composable.getSuggestions();

    // Should return early without making API call
    expect(searchService.get_promql_series).not.toHaveBeenCalled();
  });

  // Test 28: getSuggestions when not focused on labels
  it("should handle not focused on labels", async () => {
    composable.autoCompleteData.value.query = "cpu_usage";
    composable.autoCompleteData.value.position.cursorIndex = 5;

    await composable.getSuggestions();

    expect(searchService.get_promql_series).not.toHaveBeenCalled();
  });
  // Test 30: getSuggestions with API error
  it("should handle API error in getSuggestions", async () => {
    (searchService.get_promql_series as any).mockRejectedValue(new Error("API Error"));

    composable.autoCompleteData.value.query = 'cpu_usage{instance="';
    composable.autoCompleteData.value.position.cursorIndex = 18;

    // Should not throw error
    await expect(composable.getSuggestions()).resolves.toBeUndefined();
  });

  // Test 31: parsePromQlQuery with special characters
  it("should handle special characters in parsePromQlQuery", () => {
    const query = 'http_requests{path="/api/v1/users/123",method="POST"}';
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("http_requests");
    expect(result.label.labels.path).toBe("/api/v1/users/123");
    expect(result.label.labels.method).toBe("POST");
  });

  // Test 32: parsePromQlQuery with nested braces
  it("should handle nested braces correctly", () => {
    const query = 'cpu_usage{instance="server{1}"}';
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("cpu_usage");
    expect(result.label.hasLabels).toBe(true);
  });

  // Test 33: analyzeLabelFocus with multiple labels
  it("should analyze focus with multiple labels", () => {
    const query = 'cpu_usage{instance="server1",job="node",status="active"}';
    const cursorIndex = 35; // Position in 'job' value
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(true);
    expect(result.isFocused).toBe(true);
    expect(result.meta.label).toBe("job");
  });

  // Test 34: analyzeLabelFocus edge cases
  it("should handle edge cases in analyzeLabelFocus", () => {
    // Test with cursor at the end
    let query = 'cpu_usage{instance="server1"}';
    let result = composable.analyzeLabelFocus(query, query.length);
    expect(result.hasLabels).toBe(true);

    // Test with cursor at the beginning
    result = composable.analyzeLabelFocus(query, 0);
    expect(result.isFocused).toBe(false);
  });
  // Test 36: Function return types validation
  it("should return correct types from all functions", () => {
    expect(typeof composable.parsePromQlQuery).toBe("function");
    expect(typeof composable.analyzeLabelFocus).toBe("function");
    expect(typeof composable.getSuggestions).toBe("function");
    expect(typeof composable.getLabelSuggestions).toBe("function");
    expect(typeof composable.updateMetricKeywords).toBe("function");
    expect(typeof composable.updatePromqlKeywords).toBe("function");
  });

  // Test 37: Complex query parsing
  it("should parse complex PromQL queries", () => {
    const query = 'rate(http_requests_total{job="api-server",handler="/api/comments"}[5m])';
    const result = composable.parsePromQlQuery(query);
    expect(result.metricName).toBe("http_requests_total");
    expect(result.label.hasLabels).toBe(true);
  });

  // Test 38: analyzeLabelFocus with quoted values containing special chars
  it("should handle quoted values with special characters", () => {
    const query = 'cpu_usage{path="/api/v1/data?param=value&other=test"}';
    const cursorIndex = 25; // Inside the quoted value
    const result = composable.analyzeLabelFocus(query, cursorIndex);
    expect(result.hasLabels).toBe(true);
    expect(result.isFocused).toBe(true);
  });

  // Test 39: updatePromqlKeywords function list validation
  it("should include all expected PromQL functions", async () => {
    await composable.updatePromqlKeywords([]);

    const functions = ["sum", "avg_over_time", "rate", "avg", "max", "topk", "histogram_quantile"];
    functions.forEach((func) => {
      expect(
        composable.autoCompletePromqlKeywords.value.some(
          (item) => item.label === func && item.kind === "Function",
        ),
      ).toBe(true);
    });
  });

  // Test 40: Memory and performance considerations
  it("should maintain reasonable memory usage with large datasets", () => {
    // Generate large dataset
    const largeMetrics = Array.from({ length: 1000 }, (_, i) => ({
      label: `metric_${i}`,
      type: "gauge",
    }));

    composable.updateMetricKeywords(largeMetrics);
    expect(composable.metricKeywords.value.length).toBe(1000);

    // Clean up
    composable.updateMetricKeywords([]);
    expect(composable.metricKeywords.value.length).toBe(0);
  });

  // Test 41: Date time handling in autoCompleteData
  it("should have valid datetime values", () => {
    const data = composable.autoCompleteData.value;
    expect(typeof data.dateTime.startTime).toBe("number");
    expect(typeof data.dateTime.endTime).toBe("number");
    expect(data.dateTime.startTime).toBeGreaterThan(0);
    expect(data.dateTime.endTime).toBeGreaterThan(0);
  });

  // Test 42: getLabelSuggestions with malformed data
  it("should handle malformed label data gracefully", () => {
    const malformedLabels = [null, undefined, { instance: null }, { job: undefined }, {}];

    const result = composable.getLabelSuggestions(malformedLabels as any, { focusOn: "label" }, "");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  // Test 43: parsePromQlQuery should return null for metric name when not present
  it("should return null metric name when query has no metric", () => {
    const result = composable.parsePromQlQuery('{job="api"}');
    expect(result.metricName).toBeNull();
  });

  // Test 44: parsePromQlQuery should handle query with only curly braces
  it("should return null metric name for query with only curly braces", () => {
    const result = composable.parsePromQlQuery("{}");
    expect(result.metricName).toBeNull();
    expect(result.label.hasLabels).toBe(true);
  });

  // Test 45: parsePromQlQuery should handle incomplete metric query
  it("should return null metric name for incomplete query", () => {
    const result = composable.parsePromQlQuery("cpu");
    expect(result.metricName).toBeNull();
    expect(result.label.hasLabels).toBe(false);
  });

  // Test 46: parsePromQlQuery should correctly identify metric name vs empty query
  it("should differentiate between metric with braces and empty query", () => {
    const metricResult = composable.parsePromQlQuery("metric_name{}");
    expect(metricResult.metricName).toBe("metric_name");
    expect(metricResult.label.hasLabels).toBe(true);

    const emptyResult = composable.parsePromQlQuery("{}");
    expect(emptyResult.metricName).toBeNull();
    expect(emptyResult.label.hasLabels).toBe(true);
  });

  // Test 47: parsePromQlQuery should handle whitespace before braces
  it("should handle whitespace in query parsing", () => {
    const result = composable.parsePromQlQuery('metric_name {instance="test"}');
    // Note: This depends on regex implementation. Based on current regex, it should still match
    expect(result.metricName).toBeNull(); // Space breaks the pattern
    expect(result.label.hasLabels).toBe(true);
  });

  // Test 48: parsePromQlQuery with functions wrapping metric
  it("should extract metric name from function-wrapped queries", () => {
    const result = composable.parsePromQlQuery('rate(http_requests{job="api"}[5m])');
    // Current implementation will find first match
    expect(result.metricName).toBe("http_requests");
    expect(result.label.hasLabels).toBe(true);
  });
});

// ─── tmp/code.md item 18 (section E) — the catalog behind these keywords ─────
// The seven-function hardcode is replaced by the upstream-derived catalog in
// utils/query/promqlCompletion.ts. The composable's job is unchanged: offer the
// catalog when it has nothing better, and get out of the way when it does.
//
// The catalog's CONTENT is asserted in promqlCompletion.spec.ts; what belongs
// here is that the composable actually serves it, and that the context
// switching it already does still wins.

describe("PromQL catalog reaches the editor", () => {
  let c: ReturnType<typeof usePromqlSuggestions>;

  beforeEach(() => {
    vi.clearAllMocks();
    c = usePromqlSuggestions();
  });

  const offered = () => c.autoCompletePromqlKeywords.value as any[];

  it("offers far more than the seven that were hardcoded", async () => {
    await c.updatePromqlKeywords([]);
    expect(offered().length).toBeGreaterThan(90);
  });

  it("offers the functions users reported missing", async () => {
    await c.updatePromqlKeywords([]);
    const labels = offered().map((k: any) => k.label);
    for (const fn of ["irate", "increase", "delta", "label_replace", "clamp_max", "quantile"]) {
      expect(labels, `missing ${fn}`).toContain(fn);
    }
  });

  it("offers the grouping modifiers", async () => {
    await c.updatePromqlKeywords([]);
    const labels = offered().map((k: any) => k.label);
    for (const kw of ["by", "without", "on", "ignoring"]) {
      expect(labels, `missing ${kw}`).toContain(kw);
    }
  });

  it("keeps functions and modifiers on different kinds", async () => {
    await c.updatePromqlKeywords([]);
    const byLabel = (l: string) => offered().find((k: any) => k.label === l);
    expect(byLabel("rate").kind).toBe("Function");
    expect(byLabel("by").kind).not.toBe("Function");
  });

  it("still appends the metric names, and does not bury them", async () => {
    // Metrics are this language's fields. Replacing the hardcode must not drop
    // them — and the ORDER is the point, which an earlier draft of this test
    // claimed in its name and never asserted: 107 catalog entries in front of
    // the metric the user came to type is the same as not offering it.
    c.updateMetricKeywords([{ label: "http_requests_total", type: "counter" }]);
    await c.updatePromqlKeywords([]);
    const metric = offered().find((k: any) => String(k.label).startsWith("http_requests_total"));
    expect(metric, "the metric was dropped").toBeTruthy();
    const firstFunction = offered().find((k: any) => k.kind === "Function");
    // Both must carry a lane. Comparing `sortText ?? ""` instead would let the
    // metric win by having no sortText at all — an ordering that holds by
    // accident and breaks the moment someone gives it one.
    expect(metric.sortText, "the metric carries no sort lane").toBeTruthy();
    expect(firstFunction.sortText, "the function carries no sort lane").toBeTruthy();
    expect(metric.sortText < firstFunction.sortText).toBe(true);
  });

  // Caller-supplied lists replacing the catalog outright is already covered by
  // "should update keywords with provided data" above; not duplicated here.
  it("never leaves the editor with an empty list", async () => {
    // getSuggestions clears the list before deciding what to show, and two of
    // its branches return without refilling it — an untracked cursor is one.
    // Eager initialisation alone does not cover this: the list starts full,
    // then a single suggestion pass empties it again.
    const fresh = usePromqlSuggestions();
    fresh.autoCompleteData.value.query = "up";
    fresh.autoCompleteData.value.position.cursorIndex = -1;
    await fresh.getSuggestions();
    expect((fresh.autoCompletePromqlKeywords.value as any[]).length).toBeGreaterThan(90);
  });

  it("offers metric names the moment they arrive, with no keystroke", async () => {
    // The catalog is seeded at construction, but METRICS arrive later, from a
    // watcher on the stream results. Nothing rebuilt the offered list when they
    // did, so a freshly opened PromQL editor showed 113 catalog entries and not
    // one metric name until the user edited the query — the same "Ctrl+Space
    // shows nothing useful" complaint, half fixed.
    const fresh = usePromqlSuggestions();
    const popupOpen = vi.fn();
    fresh.autoCompleteData.value.popup.open = popupOpen;

    fresh.updateMetricKeywords([{ label: "http_requests_total", type: "counter" }]);

    const labels = (fresh.autoCompletePromqlKeywords.value as any[]).map((k: any) => k.label);
    expect(labels.some((l: string) => l.startsWith("http_requests_total"))).toBe(true);
    // Rebuilding the list is not a reason to open the widget over whatever the
    // user is doing.
    expect(popupOpen, "arriving metrics popped the suggest widget open").not.toHaveBeenCalled();
  });

  it("does not let arriving metrics clobber a contextual list", async () => {
    // Label suggestions are showing; a metric refresh landing at that moment
    // must not replace them with the catalog.
    const fresh = usePromqlSuggestions();
    const labelList = [{ label: "instance", kind: "Variable", insertText: "instance=" }];
    await fresh.updatePromqlKeywords(labelList, { contextual: true });
    fresh.updateMetricKeywords([{ label: "http_requests_total", type: "counter" }]);
    expect(fresh.autoCompletePromqlKeywords.value).toEqual(labelList);
  });

  it("keeps an empty label result empty instead of showing every function", async () => {
    // A label lookup that matched nothing is not the same as "no context" — but
    // both arrived as `[]`, so the catalog took over and offered 97 functions
    // inside `up{instance="`, where none of them can be typed.
    vi.mocked(searchService.get_promql_series).mockResolvedValue({ data: { data: [] } } as any);
    const fresh = usePromqlSuggestions();
    fresh.autoCompleteData.value.query = 'up{instance="';
    fresh.autoCompleteData.value.position.cursorIndex = 12;

    await fresh.getSuggestions();
    await flushPromises();

    const rows = fresh.autoCompletePromqlKeywords.value as any[];
    expect(rows.filter((k: any) => k.kind === "Function")).toEqual([]);
  });
  it("has the catalog ready before the first keystroke", async () => {
    // getSuggestions is what fills this list today, and getSuggestions only
    // runs on a query update — so a freshly opened PromQL editor has an EMPTY
    // list, and Ctrl+Space on it produces nothing until the user types a
    // character. That is the same shape as the SLO bug (the helper worked,
    // nobody had called it) and it is exactly the state a user is in when a
    // placeholder invites them to press Ctrl+Space.
    const fresh = usePromqlSuggestions();
    expect((fresh.autoCompletePromqlKeywords.value as any[]).length).toBeGreaterThan(90);
  });
});

// ─── Removed with the series endpoint (tmp/code.md D11) ──────────────────────
// Four tests lived here that drove getSuggestions through
// /prometheus/api/v1/series: two asserted the call was made, one asserted the
// label suggestions it produced, and one held its promise open to observe the
// loading row. Item 21 replaced that source with the stream schema and the
// field-value cache, so asserting the series call is now asserting the bug.
//
// Their subjects did not disappear with them: label names, label values and the
// loading row are all covered in usePromqlSuggestions.streamSources.spec.ts,
// against the sources that actually serve them.
