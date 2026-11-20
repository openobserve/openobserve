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
import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { gt } from "@/types/i18n";
import { buildGroupsColumns } from "@/plugins/traces/composables/tracesGroupsColumns";
import TracesGroupsTable from "./TracesGroupsTable.vue";

const { mockSearch, mockCancelAll, mockCopy, sharedSearchObj } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockCancelAll: vi.fn(),
  mockCopy: vi.fn(),
  sharedSearchObj: {
    meta: { groupBy: "service_name" },
    data: { stream: { addToFilter: "" } },
  },
}));

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery: mockSearch, cancelAll: mockCancelAll }),
}));

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: mockCopy }));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: sharedSearchObj }),
}));

const HOUR_US = 3_600_000_000;
const START = 1_793_640_000_000_000;

const request = (over: Record<string, unknown> = {}) => ({
  stream: "default",
  key: "service_name",
  filter: "duration > 10",
  scope: "",
  startTime: START,
  endTime: START + HOUR_US,
  runId: 1,
  ...over,
});

const hit = (value: string | null, spans: number, errors: number) => ({
  ...(value === null ? {} : { value }),
  spans,
  errors,
  p50: 1500,
  p95: 2_000_000,
  p99: 3_000_000,
});

// The column whose cells the stub shows hover actions for, as OTable does for the hovered cell.
const hoveredColumn = ref<string | null>(null);

const OTableStub = {
  name: "OTable",
  props: ["data", "columns", "sortBy", "sortOrder", "loading"],
  emits: ["row-click", "sort-change", "cell-contextmenu"],
  setup: () => ({ hoveredColumn }),
  template: `<div>
    <div v-for="(row, i) in data" :key="i" data-test="row" @click="$emit('row-click', row)">
      <span v-for="col in columns" :key="col.id" :data-test="'cell-' + col.id">
        <slot :name="'cell-' + col.id" :row="row" />
        <span v-if="hoveredColumn === col.id" :data-test="'hover-' + col.id">
          <slot name="cell-hover-actions" :row="row" :column="col" :active="true" />
        </span>
      </span>
    </div>
    <slot v-if="!data.length" name="empty" />
  </div>`,
};

const sqlOf = (call: number) => mockSearch.mock.calls[call][0] as string;

const respond = (...responses: Array<Record<string, unknown>[] | Error>) => {
  for (const response of responses) {
    if (response instanceof Error) mockSearch.mockRejectedValueOnce(response);
    else mockSearch.mockResolvedValueOnce(response);
  }
};

const mountTable = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(TracesGroupsTable, {
    props: {
      request: request(),
      sort: { by: "errors", order: "desc" },
      columns: buildGroupsColumns("service_name", gt),
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        OTable: OTableStub,
        OContextMenu: { template: '<div><slot name="trigger" /><slot /></div>' },
        OContextMenuItem: {
          props: ["iconLeft"],
          emits: ["select"],
          template: "<button @click=\"$emit('select')\"><slot /></button>",
        },
        OContextMenuLabel: { template: "<div><slot /></div>" },
        OContextMenuSeparator: { template: "<hr />" },
        OSparkline: { name: "OSparkline", props: ["points"], template: "<i />" },
        QueryErrorState: {
          name: "QueryErrorState",
          props: ["errorMsg", "errorCode", "errorDetail"],
          template: "<div />",
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
};

describe("TracesGroupsTable", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    sharedSearchObj.meta.groupBy = "service_name";
    sharedSearchObj.data.stream.addToFilter = "";
    hoveredColumn.value = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("streams the groups query over the request's window, then the sparklines for the visible keys", async () => {
    respond([hit("cart", 200, 10), hit(null, 5, 0)], []);
    const wrapper = await mountTable();
    expect(mockSearch.mock.calls[0].slice(1)).toEqual([
      START,
      START + HOUR_US,
      "traces",
      { replaceStreamingAggs: true },
    ]);
    expect(sqlOf(0)).toContain('GROUP BY "service_name" ORDER BY errors DESC, spans DESC LIMIT 50');
    expect(sqlOf(0)).toContain("WHERE duration > 10");
    expect(sqlOf(1)).toContain("histogram(_timestamp");
    expect(sqlOf(1)).toContain(`"service_name" IN ('cart') OR "service_name" IS NULL`);
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(2);
  });

  it("asks for no value count when fewer than 50 values came back", async () => {
    respond([hit("cart", 200, 10)], []);
    const wrapper = await mountTable();
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="traces-groups-footer"]').exists()).toBe(false);
  });

  it("says how many values exist when the top 50 is only part of them", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => hit(`svc-${i}`, 100 - i, 0));
    respond(fifty, [], [{ n: 1234 }]);
    const wrapper = await mountTable();
    const distinctCall = mockSearch.mock.calls.findIndex((c) =>
      String(c[0]).startsWith("SELECT approx_distinct"),
    );
    expect(sqlOf(distinctCall)).toBe(
      'SELECT approx_distinct("service_name") AS n FROM "default" WHERE duration > 10',
    );
    expect(wrapper.find('[data-test="traces-groups-footer"]').text()).toBe(
      "Showing 50 of ~1.2K values",
    );
    expect(wrapper.emitted("update:count")!.at(-1)).toEqual([1234]);
  });

  it("shows no footer when the count is not above 50", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => hit(`svc-${i}`, 100 - i, 0));
    respond(fifty, [], [{ n: 49 }]);
    const wrapper = await mountTable();
    expect(wrapper.find('[data-test="traces-groups-footer"]').exists()).toBe(false);
  });

  it("draws one sparkline per row from the histogram counts", async () => {
    respond([hit("cart", 200, 10)], [{ ts: "2026-11-02T17:22:30", value: "cart", spans: 9 }]);
    const wrapper = await mountTable();
    const points = wrapper.findComponent({ name: "OSparkline" }).props("points") as number[];
    expect(points.reduce((a, b) => a + b, 0)).toBe(9);
    expect(points.length).toBeGreaterThanOrEqual(24);
  });

  it("keeps the table without sparklines when the sparkline query fails", async () => {
    respond([hit("cart", 200, 10)], new Error("boom"));
    const wrapper = await mountTable();
    expect(wrapper.findAll('[data-test="row"]')).toHaveLength(1);
    expect(wrapper.findComponent({ name: "OSparkline" }).props("points")).toEqual([]);
    expect(wrapper.findComponent({ name: "QueryErrorState" }).exists()).toBe(false);
  });

  it("reports how many groups it shows once they load, and none while loading or failed", async () => {
    respond([hit("cart", 200, 10), hit(null, 5, 0)], []);
    const wrapper = await mountTable();
    expect(wrapper.emitted("update:count")).toEqual([[null], [2]]);
    respond(new Error("boom"));
    await wrapper.setProps({ request: request() });
    await flushPromises();
    expect(wrapper.emitted("update:count")!.at(-1)).toEqual([null]);
  });

  it("shows the error when the groups query fails", async () => {
    respond(
      Object.assign(new Error("Search SQL execute error"), {
        code: 20008,
        raw: { content: { error_detail: "bad column" } },
      }),
    );
    const wrapper = await mountTable();
    const errorState = wrapper.findComponent({ name: "QueryErrorState" });
    expect(errorState.props("errorMsg")).toBe("Search SQL execute error");
    expect(errorState.props("errorCode")).toBe(20008);
    expect(errorState.props("errorDetail")).toBe("bad column");
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it("cancels the in-flight streams on a new load and on unmount", async () => {
    respond([hit("cart", 200, 10)], []);
    const wrapper = await mountTable();
    const before = mockCancelAll.mock.calls.length;
    respond([hit("cart", 200, 10)], []);
    await wrapper.setProps({ sort: { by: "p95", order: "asc" } });
    expect(mockCancelAll.mock.calls.length).toBe(before + 1);
    wrapper.unmount();
    expect(mockCancelAll.mock.calls.length).toBe(before + 2);
  });

  it("labels an empty key (no value) and formats durations like the span list", async () => {
    respond([hit(null, 5, 0), hit("", 3, 0)], []);
    const wrapper = await mountTable();
    const values = wrapper.findAll('[data-test="cell-value"]').map((c) => c.text());
    expect(values).toEqual(["(no value)", "(no value)"]);
    expect(wrapper.find('[data-test="cell-p50"]').text()).toBe("1.50ms");
  });

  it("lets a cancelled load finish even though the cancelled stream never answers", async () => {
    mockSearch.mockReturnValue(new Promise(() => {}));
    const wrapper = await mountTable();
    const stale = (wrapper.vm as any).load() as Promise<void>;
    let settled = false;
    void stale.then(() => (settled = true));
    await wrapper.setProps({ sort: { by: "p95", order: "asc" } });
    await flushPromises();
    expect(settled).toBe(true);
    const current = (wrapper.vm as any).load() as Promise<void>;
    let unmountSettled = false;
    void current.then(() => (unmountSettled = true));
    wrapper.unmount();
    await flushPromises();
    expect(unmountSettled).toBe(true);
    mockSearch.mockReset();
  });

  it("names span_kind values like the span list, and filters on the stored number", async () => {
    respond([hit("2", 200, 10)], []);
    const wrapper = await mountTable({ request: request({ key: "span_kind" }) });
    expect(wrapper.find('[data-test="traces-groups-value"]').text()).toBe("Server");
    wrapper
      .findComponent(OTableStub)
      .vm.$emit("row-click", { value: "2" }, new MouseEvent("click"));
    expect(wrapper.emitted("open-group")).toEqual([["span_kind = '2'"]]);
  });

  it("colours Error % red from 5 % and mutes zero", async () => {
    respond([hit("a", 100, 5), hit("b", 100, 4), hit("c", 100, 0)], []);
    const wrapper = await mountTable();
    const cells = wrapper.findAll('[data-test="traces-groups-error-pct"]');
    expect(cells.map((c) => c.text())).toEqual(["5.0%", "4.0%", "0%"]);
    expect(cells[0].classes()).toContain("text-status-error-text");
    expect(cells[1].classes()).not.toContain("text-status-error-text");
    expect(cells[2].classes()).toContain("text-text-muted");
  });

  it("re-runs with a new sort and emits it from a header click", async () => {
    respond([hit("cart", 200, 10)], []);
    const wrapper = await mountTable();
    wrapper.findComponent(OTableStub).vm.$emit("sort-change", { column: "p95", order: "asc" });
    expect(wrapper.emitted("update:sort")).toEqual([[{ by: "p95", order: "asc" }]]);
    respond([hit("cart", 200, 10)], []);
    await wrapper.setProps({ sort: { by: "p95", order: "asc" } });
    await flushPromises();
    expect(sqlOf(2)).toContain("ORDER BY p95 ASC");
  });

  it("flips the order when the table clears the sort", async () => {
    respond([hit("cart", 200, 10)], []);
    const wrapper = await mountTable();
    wrapper.findComponent(OTableStub).vm.$emit("sort-change", { column: "", order: "asc" });
    expect(wrapper.emitted("update:sort")).toEqual([[{ by: "errors", order: "asc" }]]);
  });

  it("row click opens the list filtered to the value, leaving the run to the page", async () => {
    respond([hit("it's", 200, 10)], []);
    const wrapper = await mountTable();
    wrapper
      .findComponent(OTableStub)
      .vm.$emit("row-click", { value: "it's" }, new MouseEvent("click"));
    expect(wrapper.emitted("open-group")).toEqual([["service_name = 'it''s'"]]);
    expect(sharedSearchObj.data.stream.addToFilter).toBe("");
  });

  it("row click on (no value) matches both null and empty", async () => {
    respond([hit(null, 5, 0)], []);
    const wrapper = await mountTable();
    wrapper
      .findComponent(OTableStub)
      .vm.$emit("row-click", { value: null }, new MouseEvent("click"));
    expect(wrapper.emitted("open-group")).toEqual([
      ["(service_name IS NULL OR service_name = '')"],
    ]);
  });

  const openMenu = async (value: string | null) => {
    respond([hit(value, 200, 10)], []);
    const wrapper = await mountTable();
    wrapper.findComponent(OTableStub).vm.$emit("cell-contextmenu", {
      columnId: "spans",
      row: { value },
      value: 200,
    });
    await flushPromises();
    return wrapper;
  };

  it("right-click Include term filters and stays in Groups", async () => {
    const wrapper = await openMenu("cart");
    await wrapper.find('[data-test="traces-groups-context-include-term"]').trigger("click");
    expect(sharedSearchObj.data.stream.addToFilter).toBe("service_name = 'cart'");
    expect(sharedSearchObj.meta.groupBy).toBe("service_name");
  });

  it("right-click Exclude term filters the value out and stays in Groups", async () => {
    const wrapper = await openMenu("cart");
    await wrapper.find('[data-test="traces-groups-context-exclude-term"]').trigger("click");
    expect(sharedSearchObj.data.stream.addToFilter).toBe("service_name != 'cart'");
    expect(sharedSearchObj.meta.groupBy).toBe("service_name");
  });

  it("right-click Open traces opens the list filtered to the value", async () => {
    const wrapper = await openMenu(null);
    await wrapper.find('[data-test="traces-groups-context-open-traces"]').trigger("click");
    expect(wrapper.emitted("open-group")).toEqual([
      ["(service_name IS NULL OR service_name = '')"],
    ]);
    expect(sharedSearchObj.data.stream.addToFilter).toBe("");
  });

  it("offers no Open in new tab or Copy item", async () => {
    const wrapper = await openMenu("cart");
    expect(wrapper.findAll("button").map((b) => b.text())).toEqual([
      "Include Term",
      "Exclude Term",
      "Open traces",
    ]);
  });

  describe("cell hover actions", () => {
    const hoverOn = async (column: string, value: string | null, key = "service_name") => {
      respond([hit(value, 200, 10)], []);
      const wrapper = await mountTable({ request: request({ key }) });
      hoveredColumn.value = column;
      await flushPromises();
      return wrapper;
    };
    const actions = (wrapper: any, column = "value") =>
      wrapper.find(`[data-test="hover-${column}"]`);

    it("offers Copy, Include and Exclude on the grouped field's cell", async () => {
      const wrapper = await hoverOn("value", "cart");
      const cell = actions(wrapper);
      expect(cell.find('[data-test="logs-cell-actions-copy-btn"]').exists()).toBe(true);
      expect(cell.find('[data-test="log-details-include-field-cart"]').exists()).toBe(true);
      expect(cell.find('[data-test="log-details-exclude-field-cart"]').exists()).toBe(true);
    });

    it.each(["spans", "errors", "p50", "p95", "p99"])("offers none on the %s column", async (c) => {
      const wrapper = await hoverOn(c, "cart");
      expect(actions(wrapper, c).exists()).toBe(true);
      expect(actions(wrapper, c).find('[data-test="logs-cell-actions-copy-btn"]').exists()).toBe(
        false,
      );
    });

    it("Include adds the context menu's filter and opens no traces", async () => {
      const wrapper = await hoverOn("value", "it's");
      await actions(wrapper)
        .find("[data-test='log-details-include-field-it\\'s']")
        .trigger("click");
      expect(sharedSearchObj.data.stream.addToFilter).toBe("service_name = 'it''s'");
      expect(wrapper.emitted("open-group")).toBeUndefined();
    });

    it("Exclude on (no value) filters out both null and empty, as the context menu does", async () => {
      const wrapper = await hoverOn("value", null);
      await actions(wrapper).find('[data-test^="log-details-exclude-field-"]').trigger("click");
      expect(sharedSearchObj.data.stream.addToFilter).toBe(
        "(service_name IS NOT NULL AND service_name != '')",
      );
      expect(wrapper.emitted("open-group")).toBeUndefined();
    });

    it("Copy copies the shown value without opening traces", async () => {
      const wrapper = await hoverOn("value", "2", "span_kind");
      await actions(wrapper).find('[data-test="logs-cell-actions-copy-btn"]').trigger("click");
      expect(mockCopy).toHaveBeenCalledWith("Server", expect.any(Function));
      expect(wrapper.emitted("open-group")).toBeUndefined();
    });
  });
});
