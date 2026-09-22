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

// tmp/code.md D13 — the 400 in the panel-editor screenshot, reproduced in a
// browser rather than inferred.
//
// Clicking the ✕ beside "Select Field" in a filter's dropdown runs
// `removeColumnName()`, which sets `column = {}`. The watcher on
// `condition.column` then asks for the new column's values — including this
// one, which has no field — and `loadFilterItem` builds `fields: [row.field]`
// out of `undefined`. JSON.stringify turns `undefined` inside an array into
// `null`, so what leaves the browser is
//
//   {"stream_name":"_o2_service_graph", ..., "fields":[null], ...}
//
// and the server answers
//
//   400 {"code":400,"message":"SerdeJsonError# invalid type: null, expected a string"}
//
// That is the failing POST in the screenshot. The 200 beside it is the reload
// after a field is picked again, and the empty value list with "At least 1 item
// required" is the sibling watcher having cleared `values` in between.
//
// The trigger is not the bug — re-picking a field must still load its values.
// Sending a request that cannot succeed is. `_values_stream` answers 400, not
// an empty result, for every way a piece of this payload can go missing;
// measured against a running server:
//
//   fields: [null]        400  SerdeJsonError# invalid type: null, expected a string
//   fields: []            400  No valid fields to process
//   stream_name: ""       400  No valid fields to process
//   stream_name absent    400  SerdeJsonError# missing field `stream_name`
//   start_time: null      400  IoError# start_time is empty
//
// The time range fails differently, and the earlier note in this file's history
// had it wrong: no request with NaN timestamps ever leaves. `meta.dateTime`
// starts as `{start_time: "", end_time: ""}` and is only replaced once the date
// picker has run, and `""?.toISOString()` does not short-circuit — `""` is not
// nullish, so the call is attempted and throws before anything is sent. Both
// callers catch it and show "Something went wrong!". So the second defect on
// this path is not a bad request but a bogus error toast, for a lookup the user
// never asked to fail. An unparseable date reaches the same place by a
// different route: `new Date(undefined).toISOString()` is a RangeError.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises } from "@vue/test-utils";

const fetchFieldValues = vi.hoisted(() => vi.fn());
const showErrorNotification = vi.hoisted(() => vi.fn());

vi.mock("./useValuesWebSocket", () => ({
  default: () => ({ fetchFieldValues, cancelTraceId: vi.fn() }),
}));
vi.mock("../useNotifications", () => ({
  default: () => ({ showErrorNotification, showPositiveNotification: vi.fn() }),
}));
vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { schema: vi.fn() } });
});
vi.mock("@/services/metrics", () => ({ default: { get_promql_series: vi.fn() } }));
vi.mock("@/composables/fieldValueStore", () => ({
  getFieldValuesForSuggestion: vi.fn().mockResolvedValue([]),
  requestFieldValues: vi.fn().mockResolvedValue([]),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuex")>();
  return {
    ...actual,
    useStore: vi.fn(() => ({
      state: {
        selectedOrganization: { identifier: "default" },
        zoConfig: { timestamp_column: "_timestamp" },
      },
    })),
  };
});

import useDashboardPanelData from "./useDashboardPanel";

// A unique page key per test: the composable is a singleton per key, so a
// shared one would carry filter conditions and time ranges between tests.
let pageKey = 0;

const currentQuery = (p: any) =>
  p.dashboardPanelData.data.queries[p.dashboardPanelData.layout.currentQueryIndex];

/**
 * A panel in the state the screenshot was taken in: `logs` / `_o2_service_graph`
 * chosen, and the date picker having pushed its window into `meta.dateTime`.
 *
 * The Date-from-microseconds is not a typo. Every page that drives this
 * composable — `AddPanel.vue`, the logs and metrics visualisers, the alert and
 * pipeline previews — stores `new Date(startTime)` where `startTime` is already
 * microseconds. Faking it with a millisecond Date would make the assertions
 * below prove nothing about the real app.
 */
const readyPanel = () => {
  const p = useDashboardPanelData(`filter-values-spec-${++pageKey}`);
  currentQuery(p).fields.stream = "_o2_service_graph";
  currentQuery(p).fields.stream_type = "logs";
  p.dashboardPanelData.meta.dateTime = {
    start_time: new Date(1785731297114000),
    end_time: new Date(1785732197114000),
  } as any;
  return p;
};

/** The same panel with a time range in whatever state the caller wants. */
const panelWithRange = (dateTime: any) => {
  const p = readyPanel();
  p.dashboardPanelData.meta.dateTime = dateTime;
  return p;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadFilterItem", () => {
  it("asks for the values of a field that has one", async () => {
    const p = readyPanel();
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({
      org_identifier: "default",
      stream_name: "_o2_service_graph",
      start_time: 1785731297114000,
      end_time: 1785732197114000,
      fields: ["client_service"],
      size: 100,
      type: "logs",
      no_count: true,
    });
  });

  it("resolves a joined stream through its alias", async () => {
    // The positive half of the alias check below: a guard that bailed on every
    // alias would pass that test and break filters on joined streams.
    const p = readyPanel();
    currentQuery(p).joins = [{ stream: "_o2_span_metrics", streamAlias: "spans" }];
    await p.loadFilterItem({ field: "client_service", streamAlias: "spans" });
    await flushPromises();

    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({
      stream_name: "_o2_span_metrics",
      fields: ["client_service"],
    });
  });

  it("sends nothing when the column has been cleared — the ✕ in the screenshot", async () => {
    const p = readyPanel();
    await p.loadFilterItem({} as any);
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });

  it("sends nothing when the field name is empty", async () => {
    const p = readyPanel();
    await p.loadFilterItem({ field: "" });
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });

  it("sends nothing when the stream alias matches no selected stream", async () => {
    // getStreamNameFromStreamAlias ends in `.find(…)?.stream`, so an alias that
    // is not among the selected streams yields undefined — and JSON.stringify
    // drops the key, which the server rejects as a missing field.
    const p = readyPanel();
    await p.loadFilterItem({ field: "client_service", streamAlias: "not_a_stream" });
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });

  it("sends nothing before a stream has been chosen", async () => {
    const p = readyPanel();
    currentQuery(p).fields.stream = "";
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });

  it("sends nothing before the date picker has run", async () => {
    const p = panelWithRange({ start_time: "", end_time: "" });
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });

  it("does not blame the user for a time range that is not ready yet", async () => {
    const p = panelWithRange({ start_time: "", end_time: "" });
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("sends nothing, and says nothing, when the range holds unparseable dates", async () => {
    const p = panelWithRange({ start_time: new Date(undefined as any), end_time: new Date() });
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("still reports a failure that came from the request itself", async () => {
    // The guard must not swallow real errors — only skip requests it never sent.
    fetchFieldValues.mockRejectedValueOnce({
      response: { data: { message: "stream not found" } },
    });
    const p = readyPanel();
    await p.loadFilterItem({ field: "client_service" });
    await flushPromises();

    expect(showErrorNotification).toHaveBeenCalledWith("stream not found");
  });
});

describe("addFilteredItem", () => {
  it("asks for the values of the field it just added", async () => {
    const p = readyPanel();
    await p.addFilteredItem({ name: "client_service", stream: "_o2_service_graph" });
    await flushPromises();

    expect(fetchFieldValues).toHaveBeenCalledTimes(1);
    expect(fetchFieldValues.mock.calls[0][0]).toMatchObject({
      stream_name: "_o2_service_graph",
      fields: ["client_service"],
      start_time: 1785731297114000,
      end_time: 1785732197114000,
    });
  });

  it("adds the filter even when the values cannot be looked up yet", async () => {
    // The condition is what the user asked for; the value list is a convenience.
    // Skipping the request must not skip the filter.
    const p = panelWithRange({ start_time: "", end_time: "" });
    await p.addFilteredItem({ name: "client_service", stream: "_o2_service_graph" });
    await flushPromises();

    const conditions = currentQuery(p).fields.filter.conditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0].column).toMatchObject({ field: "client_service" });
    expect(fetchFieldValues).not.toHaveBeenCalled();
    expect(showErrorNotification).not.toHaveBeenCalled();
  });

  it("sends nothing when the dragged field carries no stream", async () => {
    // `PanelFieldList` builds its rows with `stream: query?.fields?.stream || null`.
    const p = readyPanel();
    await p.addFilteredItem({ name: "client_service", stream: null } as any);
    await flushPromises();

    expect(fetchFieldValues).not.toHaveBeenCalled();
  });
});
