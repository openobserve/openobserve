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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import QueryTypeSelector from "./QueryTypeSelector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { promqlRenderer } from "@/components/promql/operations/queryModeller";

const { parsePromqlQuery, removeXYFilters, applyDefaultPanelFields, panel } = vi.hoisted(() => ({
  parsePromqlQuery: vi.fn(),
  removeXYFilters: vi.fn(),
  applyDefaultPanelFields: vi.fn(),
  panel: { data: null as any },
}));

vi.mock("@/services/metrics", () => ({ default: { parsePromqlQuery } }));
vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: panel.data,
    removeXYFilters,
    updateXYFieldsForCustomQueryMode: vi.fn(),
  }),
}));
vi.mock("@/composables/dashboard/useDefaultPanelFields", () => ({
  default: () => ({ applyDefaultPanelFields }),
}));

const TEXT = 'sum by (job)(rate(http_requests_total{code=~"5.."}[5m]))';
const TREE = {
  type: "aggregate",
  op: "sum",
  by: ["job"],
  param: null,
  expr: {
    type: "call",
    func: "rate",
    args: [
      {
        type: "matrix",
        range: "5m",
        selector: {
          name: "http_requests_total",
          matchers: [{ label: "code", op: "=~", value: "5.." }],
        },
      },
    ],
  },
};

const promqlPanel = (query: string) =>
  reactive({
    data: {
      type: "line",
      queryType: "promql",
      queries: [
        {
          query,
          customQuery: true,
          fields: {
            stream: "http_requests_total",
            stream_type: "metrics",
            promql_labels: [],
            promql_operations: [],
          },
        },
      ],
    },
    layout: { currentQueryIndex: 0, showQueryBar: true },
    meta: { errors: { queryErrors: [] as string[] } },
  });

describe("QueryTypeSelector code to builder", () => {
  let wrapper: VueWrapper<any>;

  const mountWith = (query: string) => {
    panel.data = promqlPanel(query);
    wrapper = mount(QueryTypeSelector, {
      global: {
        plugins: [i18n, store],
        provide: { dashboardPanelDataPageKey: "dashboard" },
        stubs: { ConfirmDialog: true },
      },
    });
    return panel.data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => wrapper?.unmount());

  it("switches a query the builder can show, without asking and without touching its text", async () => {
    parsePromqlQuery.mockResolvedValue({ data: { data: TREE } });
    const data = mountWith(TEXT);

    await wrapper.vm.onUpdateBuilderMode("builder");
    await flushPromises();

    const slot = data.data.queries[0];
    expect(wrapper.vm.confirmQueryModeChangeDialog).toBe(false);
    expect(slot.customQuery).toBe(false);
    expect(slot.query).toBe(TEXT);
    expect(slot.fields.stream).toBe("http_requests_total");
    expect(slot.fields.promql_labels).toEqual([{ label: "code", op: "=~", value: "5.." }]);
    expect(slot.fields.promql_operations).toEqual([
      { id: "rate", params: ["5m"] },
      { id: "sum", params: [["job"]] },
    ]);
    expect(removeXYFilters).not.toHaveBeenCalled();
    expect(applyDefaultPanelFields).not.toHaveBeenCalled();
  });

  it("returns to the builder's own state, unparsed, when the code is what the builder last wrote", async () => {
    const labels = [{ label: "", op: "=", value: "" }];
    const operations = [{ id: "rate", params: ["5m"] }];
    const text = promqlRenderer.renderQuery({ metric: "http_requests_total", labels, operations });
    const data = mountWith(text);
    data.data.queries[0].fields.promql_labels = labels;
    data.data.queries[0].fields.promql_operations = operations;
    // A click lands after mount has settled the toggle, which ignores updates until then.
    await flushPromises();

    await wrapper.vm.onUpdateBuilderMode("builder");
    await flushPromises();

    const slot = data.data.queries[0];
    expect(parsePromqlQuery).not.toHaveBeenCalled();
    expect(slot.customQuery).toBe(false);
    expect(slot.query).toBe(text);
    expect(slot.fields.promql_labels).toEqual(labels);
    expect(slot.fields.promql_operations).toEqual(operations);
  });

  it("stays in code mode with the reason when the builder cannot show the query", async () => {
    const two = {
      type: "binary",
      op: "/",
      lhs: { type: "selector", name: "a", matchers: [] },
      rhs: { type: "selector", name: "b", matchers: [] },
    };
    parsePromqlQuery.mockResolvedValue({ data: { data: two } });
    const data = mountWith("a / b");

    await wrapper.vm.onUpdateBuilderMode("builder");
    await flushPromises();

    const slot = data.data.queries[0];
    expect(slot.customQuery).toBe(true);
    expect(slot.query).toBe("a / b");
    expect(slot.fields.promql_operations).toEqual([]);
    expect(data.meta.errors.queryErrors).toEqual([
      "The builder cannot show an operation between two metrics — use a formula",
    ]);
    expect(wrapper.vm.confirmQueryModeChangeDialog).toBe(false);
  });

  it("discards the result if the user moved to another tab while it was parsing", async () => {
    let resolve!: (value: any) => void;
    parsePromqlQuery.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    parsePromqlQuery.mockResolvedValue({ data: { data: TREE } });
    const data = mountWith(TEXT);
    data.data.queries.push({
      query: "up",
      customQuery: true,
      fields: { stream: "up", stream_type: "metrics", promql_labels: [], promql_operations: [] },
    });

    const pending = wrapper.vm.onUpdateBuilderMode("builder");
    data.layout.currentQueryIndex = 1;
    resolve({ data: { data: TREE } });
    await pending;
    await flushPromises();

    expect(data.data.queries[0].customQuery).toBe(true);
    expect(data.data.queries[0].fields.promql_operations).toEqual([]);
    expect(data.data.queries[1].customQuery).toBe(true);
    expect(data.data.queries[1].fields.promql_operations).toEqual([]);
    expect(data.meta.errors.queryErrors).toEqual([]);
  });

  it("discards the result if the user edited the code while it was parsing", async () => {
    let resolve!: (value: any) => void;
    parsePromqlQuery.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    parsePromqlQuery.mockResolvedValue({ data: { data: TREE } });
    const data = mountWith(TEXT);

    const pending = wrapper.vm.onUpdateBuilderMode("builder");
    data.data.queries[0].query = "up";
    resolve({ data: { data: TREE } });
    await pending;
    await flushPromises();

    expect(data.data.queries[0].customQuery).toBe(true);
    expect(data.data.queries[0].query).toBe("up");
    expect(data.data.queries[0].fields.promql_operations).toEqual([]);
  });

  it("stays in code mode with the parser's message for a query that does not parse", async () => {
    parsePromqlQuery.mockRejectedValue({
      response: { data: { error: "unclosed left parenthesis" } },
    });
    const data = mountWith("sum(x");

    await wrapper.vm.onUpdateBuilderMode("builder");
    await flushPromises();

    expect(data.data.queries[0].customQuery).toBe(true);
    expect(data.data.queries[0].query).toBe("sum(x");
    expect(data.meta.errors.queryErrors).toEqual(["unclosed left parenthesis"]);
  });
});
