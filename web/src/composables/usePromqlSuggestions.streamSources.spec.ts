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

// TDD spec for tmp/code.md Phase 5 item 21 (D11) — PromQL stops asking for
// every series.
//
// Label names and label values both came from
// `/prometheus/api/v1/series?match[]=<metric>`, which returns every matching
// series with all of its labels and leaves the client to dedupe. Measured on a
// ten-series metric: 5903 bytes for what the schema answers in 1699 (3ms, no
// scan) and `_values` answers in 821 — and all three sources returned the SAME
// ten values, identical after sorting.
//
// A metrics stream IS the metric, so a field value in that stream IS a label
// value. That means no new endpoint and no second cache: values ride the
// `_values` path item 20 builds, names come from the schema the SQL editors
// already read. An earlier revision of the plan proposed the Prometheus
// `label_values` endpoint instead; it was rejected precisely because it would
// have been a second value path for an identical answer, and this workstream
// has twice paid for two paths that were meant to agree and drifted.
//
// In its own file: the main spec mocks @/services/search for the series call
// this one is removing.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

vi.mock("@/services/search", () => ({ default: { get_promql_series: vi.fn() } }));
vi.mock("@/services/stream", () => ({ default: { schema: vi.fn() } }));
vi.mock("@/composables/fieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue([]),
}));
vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: vi.fn(() => ({ state: { selectedOrganization: { identifier: "myorg" } } })),
  };
});

import searchService from "@/services/search";
import streamService from "@/services/stream";
import { getFieldValuesForSuggestion, requestFieldValues } from "@/composables/fieldValueStore";

/**
 * A fresh copy of the composable module per test.
 *
 * Anything cached per METRIC belongs at module scope — one schema fetch per
 * metric per page, not per editor — and that state would otherwise leak between
 * tests: the first test to read a schema warms the cache and every later test
 * sees zero calls, passing or failing by position in the file.
 */
const freshComposable = async () => {
  vi.resetModules();
  const mod = await import("./usePromqlSuggestions");
  return mod.default();
};

/** What the schema endpoint returns for a metrics stream, verified live. */
const METRIC_SCHEMA = {
  data: {
    schema: [
      { name: "__hash__", type: "Utf8" },
      { name: "__name__", type: "Utf8" },
      { name: "_timestamp", type: "Int64" },
      { name: "environment", type: "Utf8" },
      { name: "service", type: "Utf8" },
      { name: "region", type: "Utf8" },
      { name: "value", type: "Float64" },
    ],
  },
};

/** Cursor inside `{`, where a label NAME is being typed. */
const atLabelName = (c: any, query: string) => {
  c.autoCompleteData.value.query = query;
  c.autoCompleteData.value.position.cursorIndex = query.length - 1;
};

/** Cursor after `label="`, where a label VALUE is being typed. */
const atLabelValue = (c: any, query: string) => {
  c.autoCompleteData.value.query = query;
  c.autoCompleteData.value.position.cursorIndex = query.length - 1;
};

const offered = (c: any) => c.autoCompletePromqlKeywords.value as any[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(streamService.schema).mockResolvedValue(METRIC_SCHEMA as any);
  vi.mocked(getFieldValuesForSuggestion).mockResolvedValue([]);
  vi.mocked(requestFieldValues).mockResolvedValue([]);
});

describe("PromQL no longer asks for every series", () => {
  it("does not call the series endpoint for a label name", async () => {
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    expect(searchService.get_promql_series).not.toHaveBeenCalled();
  });

  it("does not call the series endpoint for a label value", async () => {
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(searchService.get_promql_series).not.toHaveBeenCalled();
  });
});

describe("label NAMES come from the stream schema", () => {
  it("reads the schema of the metric under the cursor", async () => {
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    // A metrics stream is named for its metric, and the type must be passed or
    // the lookup reads it as a log stream.
    expect(streamService.schema).toHaveBeenCalledWith(
      "myorg",
      "cpu_utilization_percent",
      "metrics",
    );
  });

  it("offers the labels", async () => {
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    const labels = offered(c).map((k) => k.label);
    expect(labels).toEqual(expect.arrayContaining(["environment", "service", "region"]));
  });

  it("does NOT offer the four columns that are not labels", async () => {
    // `value` is the sample, `_timestamp` is the clock, `__hash__` is internal
    // and `__name__` is the metric you already typed. None of them belong
    // inside `{`.
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    const labels = offered(c).map((k) => k.label);
    // Anchored on a real label first: "contains none of these four" is also
    // true of an empty list, and an empty list is the bug next door.
    expect(labels, "no labels were offered at all").toContain("service");
    for (const col of ["value", "_timestamp", "__hash__", "__name__"]) {
      expect(labels, `offered ${col} as a label`).not.toContain(col);
    }
  });

  it("keeps inserting a label ready to be matched", async () => {
    // Existing behaviour worth not losing: the insertion leaves the cursor at
    // an `=`, because a bare label name is not a filter.
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    expect(offered(c).find((k) => k.label === "service")?.insertText).toBe("service=");
  });

  it("does not offer a label the query already filters on", async () => {
    // Written with the CLOSING BRACE, because that is what is really in the
    // editor: monaco auto-closes `{`, so the user is typing inside `{...}`.
    // An earlier draft used `{service="api",` — unterminated — which
    // parsePromQlQuery cannot read at all (it returns no labels), so the test
    // was demanding dedupe behaviour that has never existed and that this item
    // is not about. The shape matters more than the assertion here.
    const c = await freshComposable();
    const query = 'cpu_utilization_percent{service="api",}';
    c.autoCompleteData.value.query = query;
    c.autoCompleteData.value.position.cursorIndex = query.length - 2;
    await c.getSuggestions();
    await flushPromises();
    const labels = offered(c).map((k) => k.label);
    expect(labels, "no labels offered at all").toContain("environment");
    expect(labels, "re-offered a label the query already filters on").not.toContain("service");
  });

  it("asks the schema once per metric, not once per keystroke", async () => {
    const c = await freshComposable();
    for (const q of [
      "cpu_utilization_percent{",
      "cpu_utilization_percent{s",
      "cpu_utilization_percent{se",
    ]) {
      atLabelName(c, q);
      await c.getSuggestions();
      await flushPromises();
    }
    expect(vi.mocked(streamService.schema).mock.calls.length).toBe(1);
  });

  it("asks again for a different metric", async () => {
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    atLabelName(c, "cache_hit_ratio{");
    await c.getSuggestions();
    await flushPromises();
    expect(vi.mocked(streamService.schema).mock.calls.length).toBe(2);
  });

  it("leaves the catalog in place when the schema call fails", async () => {
    // A failed lookup must not empty the list; the language is still the
    // language.
    vi.mocked(streamService.schema).mockRejectedValue(new Error("500"));
    const c = await freshComposable();
    atLabelName(c, "cpu_utilization_percent{");
    await c.getSuggestions();
    await flushPromises();
    expect(offered(c).length).toBeGreaterThan(90);
  });
});

describe("label VALUES come from the same place SQL gets them", () => {
  it("reads the cache under the metric's stream key", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway", "chat-service"]);
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(
      { org: "myorg", streamType: "metrics", streamName: "cpu_utilization_percent" },
      "service",
    );
  });

  it("offers the cached values", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway", "chat-service"]);
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(offered(c).map((k) => k.label)).toEqual(["api-gateway", "chat-service"]);
  });

  // ── Quoting, against the model monaco actually holds ───────────────────────
  // Typing `"` auto-closes, so the model is `service=""` with the cursor
  // BETWEEN the quotes — not the unterminated `service="` a naive spec assumes.
  // Inserting a fully quoted value there produces
  //   cpu_utilization_percent{service=""analytics-service""}
  // which is what this build does today; reproduced in a dashboard panel before
  // these tests were written. An earlier draft asserted insertText was
  // '"api-gateway"' and would have blessed it.
  describe("inserting a value leaves exactly one pair of quotes", () => {
    const valuesFor = async (query: string, cursorIndex: number) => {
      vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway"]);
      const c = await freshComposable();
      c.autoCompleteData.value.query = query;
      c.autoCompleteData.value.position.cursorIndex = cursorIndex;
      await c.getSuggestions();
      await flushPromises();
      return offered(c);
    };

    it("inserts the bare value when both quotes are already there", async () => {
      // `{service=""}` with the cursor between the quotes — the auto-closed
      // shape, and the one a user is actually in.
      const query = 'cpu_utilization_percent{service=""}';
      const items = await valuesFor(query, query.indexOf('""'));
      expect(items[0]?.insertText).toBe("api-gateway");
    });

    it("closes the quote when the user typed only the opening one", async () => {
      // Auto-closing off, or the closer deleted: the value has to terminate
      // itself or the query will not parse.
      const query = 'cpu_utilization_percent{service="';
      const items = await valuesFor(query, query.length - 1);
      expect(items[0]?.insertText).toBe('api-gateway"');
    });

    it("supplies both quotes when none were typed", async () => {
      const query = "cpu_utilization_percent{service=";
      const items = await valuesFor(query, query.length - 1);
      expect(items[0]?.insertText).toBe('"api-gateway"');
    });
  });

  it("asks the server when the cache is cold", async () => {
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(requestFieldValues).toHaveBeenCalledWith(
      { org: "myorg", streamType: "metrics", streamName: "cpu_utilization_percent" },
      "service",
    );
  });

  it("does not ask the server when the cache answered", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway"]);
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(requestFieldValues).not.toHaveBeenCalled();
  });

  it("keeps an empty result empty rather than showing the language", async () => {
    // Same rule as the SQL side: a lookup that matched nothing is not an
    // invitation to offer 113 functions inside a label filter.
    const c = await freshComposable();
    atLabelValue(c, 'cpu_utilization_percent{service="');
    await c.getSuggestions();
    await flushPromises();
    // Asserted as EMPTY, not merely "no functions": the loading row satisfies
    // "no functions" too, so the weaker form passes while the position still
    // shows something that is not a value.
    expect(offered(c)).toEqual([]);
  });
});

describe("what must not change", () => {
  it("still offers the catalog when the cursor is not in a label position", async () => {
    const c = await freshComposable();
    c.autoCompleteData.value.query = "rate(";
    c.autoCompleteData.value.position.cursorIndex = 4;
    await c.getSuggestions();
    await flushPromises();
    expect(offered(c).length).toBeGreaterThan(90);
    expect(streamService.schema).not.toHaveBeenCalled();
  });

  it("does nothing at all without a metric name to scope to", async () => {
    // `{service="` on its own names no stream, so there is nothing to read.
    const c = await freshComposable();
    atLabelValue(c, '{service="');
    await c.getSuggestions();
    await flushPromises();
    expect(streamService.schema).not.toHaveBeenCalled();
    expect(getFieldValuesForSuggestion).not.toHaveBeenCalled();
  });
});
