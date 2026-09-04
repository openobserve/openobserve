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

// tmp/code.md D11, second half — the PromQL BUILDER's label sources.
//
// The editor stopped calling /prometheus/api/v1/series in Phase 5 item 21; the
// visual builder did not. fetchPromQLLabels still asks for every series over
// the panel's range and derives both label names and label values from them.
//
// Measured on this instance, cpu_utilization_percent over 24h:
//
//   /series                                  11778 B   49 ms   20 series
//   /streams/{metric}/schema                  1699 B    4 ms   metadata, no scan
//   /{metric}/_values, ALL 18 labels at once   6685 B  330 ms
//
// Which says something more interesting than "series is slow": asking _values
// for every label AT ONCE is SEVEN TIMES SLOWER than the series call, because
// it runs eighteen distinct-value aggregations. The win is not a cheaper bulk
// request — it is not making a bulk request at all.
//
// The builder needs names to populate one dropdown, and values only for the
// labels a user actually filters on. So: names from the schema, values per
// label on demand, through the SAME cache the editor fills — a label completed
// in the query editor is already warm here, and the reverse.
//
// The series call also scales with series count where these do not: 20 series
// is 11 KB, and a high-cardinality metric is megabytes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

vi.mock("@/services/metrics", () => ({ default: { get_promql_series: vi.fn() } }));
vi.mock("@/services/stream", () => ({ default: { schema: vi.fn() } }));
vi.mock("@/composables/fieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue([]),
}));

const mockStore = vi.hoisted(() => ({
  state: {
    selectedOrganization: { identifier: "myorg" },
    zoConfig: { timestamp_column: "_timestamp" },
  },
}));
vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return { ...actual, useStore: vi.fn(() => mockStore) };
});

import metricsService from "@/services/metrics";
import streamService from "@/services/stream";
import { getFieldValuesForSuggestion, requestFieldValues } from "@/composables/fieldValueStore";
import useDashboardPanelData from "./useDashboardPanel";

/** The columns a metrics stream really carries, verified against a live one. */
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

// A UNIQUE page key per test. useDashboardPanelData is a singleton per key —
// which is right for the app, one state per panel — so a shared key leaks the
// labelValuesMap between tests, and the "already cached" early return then
// silently satisfies tests that meant to exercise a cold one.
let pageKey = 0;
const panel = () => useDashboardPanelData(`promql-labels-spec-${++pageKey}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockStore.state.selectedOrganization.identifier = "myorg";
  vi.mocked(streamService.schema).mockResolvedValue(METRIC_SCHEMA as any);
  vi.mocked(getFieldValuesForSuggestion).mockResolvedValue([]);
  vi.mocked(requestFieldValues).mockResolvedValue([]);
});

describe("fetchPromQLLabels — names come from the schema", () => {
  it("does not ask for every series", async () => {
    const p = panel();
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(metricsService.get_promql_series).not.toHaveBeenCalled();
  });

  it("reads the metric's stream schema", async () => {
    const p = panel();
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(streamService.schema).toHaveBeenCalledWith(
      "myorg",
      "cpu_utilization_percent",
      "metrics",
    );
  });

  it("publishes the labels, sorted, without the four that are not labels", async () => {
    const p = panel();
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(p.dashboardPanelData.meta.promql.availableLabels).toEqual([
      "environment",
      "region",
      "service",
    ]);
  });

  it("does not fetch values nobody has asked for", async () => {
    // The reason this is not a bulk _values call: eighteen aggregations up
    // front, for a user who will filter on one label.
    const p = panel();
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(requestFieldValues).not.toHaveBeenCalled();
    expect(getFieldValuesForSuggestion).not.toHaveBeenCalled();
  });

  it("clears the loading flag, and leaves it clear on failure", async () => {
    const p = panel();
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(p.dashboardPanelData.meta.promql.loadingLabels).toBe(false);

    vi.mocked(streamService.schema).mockRejectedValue(new Error("500"));
    await p.fetchPromQLLabels("cpu_utilization_percent");
    await flushPromises();
    expect(p.dashboardPanelData.meta.promql.loadingLabels).toBe(false);
    expect(p.dashboardPanelData.meta.promql.availableLabels).toEqual([]);
  });

  it("ignores a call with no metric", async () => {
    const p = panel();
    await p.fetchPromQLLabels("");
    await flushPromises();
    expect(streamService.schema).not.toHaveBeenCalled();
  });
});

describe("fetchPromQLLabelValues — values, for one label, on demand", () => {
  it("reads the shared cache under the metric's stream key", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway", "chat-service"]);
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();
    expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(
      { org: "myorg", streamType: "metrics", streamName: "cpu_utilization_percent" },
      "service",
    );
  });

  it("publishes them where the value dropdown reads them", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway", "chat-service"]);
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();
    expect(p.dashboardPanelData.meta.promql.labelValuesMap.get("service")).toEqual([
      "api-gateway",
      "chat-service",
    ]);
  });

  it("asks the server when the cache is cold", async () => {
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();
    expect(requestFieldValues).toHaveBeenCalledWith(
      { org: "myorg", streamType: "metrics", streamName: "cpu_utilization_percent" },
      "service",
    );
  });

  it("shares the editor's cache — a warm label costs nothing here", async () => {
    // Same key space as the query editor's completion. Filtering on `service`
    // in the builder after completing it in the editor is free, and the other
    // way round.
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway"]);
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();
    expect(requestFieldValues).not.toHaveBeenCalled();
  });

  it("does not ask twice for a label it already has", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway"]);
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();
    expect(vi.mocked(getFieldValuesForSuggestion).mock.calls.length).toBe(1);
  });

  it("survives a failed lookup without emptying what is already there", async () => {
    vi.mocked(getFieldValuesForSuggestion).mockResolvedValue(["api-gateway"]);
    const p = panel();
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "service");
    await flushPromises();

    vi.mocked(getFieldValuesForSuggestion).mockRejectedValue(new Error("idb down"));
    await expect(
      p.fetchPromQLLabelValues("cpu_utilization_percent", "region"),
    ).resolves.toBeUndefined();
    expect(p.dashboardPanelData.meta.promql.labelValuesMap.get("service")).toEqual(["api-gateway"]);
  });

  it("ignores a call with no metric or no label", async () => {
    const p = panel();
    await p.fetchPromQLLabelValues("", "service");
    await p.fetchPromQLLabelValues("cpu_utilization_percent", "");
    await flushPromises();
    expect(getFieldValuesForSuggestion).not.toHaveBeenCalled();
  });
});
