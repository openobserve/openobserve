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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    __v_isRef: true,
    value: {
      getTotalSize: () => (optsRef.value.count ?? 0) * 24,
      getVirtualItems: () =>
        Array.from({ length: optsRef.value.count ?? 0 }, (_, i) => ({
          key: i,
          index: i,
          start: i * 24,
          size: 24,
        })),
      measureElement: vi.fn(),
    },
  }),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({ state: { theme: "light", zoConfig: {}, printMode: false } }),
  };
});

vi.stubGlobal("CSS", { supports: () => false });

import TableRenderer from "@/components/dashboards/panels/TableRenderer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { convertTableData } from "@/utils/dashboard/convertTableData";
import { applyTableOptions } from "@/utils/dashboard/tableOptions";

const fieldType = (alias: string, value: string) => ({
  field: { matchBy: "name", value: alias },
  config: [{ type: "field_type", value }],
});

const panel = (config: Record<string, any>) => ({
  type: "table",
  queries: [
    {
      fields: {
        x: [{ label: "Service", alias: "service", column: "service" }],
        y: [
          { label: "Requests", alias: "requests", column: "requests" },
          { label: "Trend", alias: "trend", column: "trend" },
        ],
      },
    },
  ],
  config: { decimals: 0, ...config },
});

const rows = [
  { service: "api", requests: 30, trend: [1, 2, 3] },
  { service: "web", requests: 10, trend: "[3, 2, 1]" },
];

const tableFor = (config: Record<string, any>) => {
  const schema = panel(config);
  const table: any = convertTableData(schema, [rows.map((row) => ({ ...row }))], store);
  applyTableOptions(table, schema);
  return table;
};

describe("TableRenderer cell types and footer (real converter, OTable and cells)", () => {
  let wrapper: VueWrapper<any> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  const mountTable = async (config: Record<string, any>, density?: string) => {
    wrapper = mount(TableRenderer, {
      props: { data: tableFor(config), valueMapping: [], density },
      global: { plugins: [i18n, store] },
    });
    await flushPromises();
    return wrapper;
  };

  it("draws bar gauge cells scaled to the column and coloured by thresholds", async () => {
    await mountTable({
      override_config: [fieldType("requests", "bar_gauge")],
      thresholds: {
        mode: "absolute",
        baseColor: "#00aa00",
        steps: [{ value: 20, color: "#cc0000" }],
      },
    });
    const bars = wrapper!.findAll('[data-test="dashboard-table-bar-gauge-requests"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].text()).toBe("30");
    expect(bars.every((bar) => bar.find('[data-test="o2-data-bar-cell-track"]').exists())).toBe(
      true,
    );
    const fills = bars.map((bar) =>
      bar.find('[data-test="o2-data-bar-cell-fill"]').attributes("style"),
    );
    expect(fills[0]).toContain("width: 100%");
    expect(fills[0]).toContain("background-color: rgb(204, 0, 0)");
    expect(fills[1]).toContain("width: 33.3");
    expect(fills[1]).toContain("background-color: rgb(0, 170, 0)");
  });

  it("draws a sparkline for numeric array cells", async () => {
    await mountTable({ override_config: [fieldType("trend", "sparkline")] });
    expect(
      wrapper!.findAll('[data-test="dashboard-table-sparkline-trend-sparkline"]'),
    ).toHaveLength(2);
  });

  it("falls back to the formatted value for a sparkline on a scalar column, footer included", async () => {
    await mountTable({
      override_config: [fieldType("requests", "sparkline")],
      table_footer_calcs: ["sum"],
    });
    const cells = wrapper!
      .findAll("td")
      .map((td) => td.text())
      .filter(Boolean);
    expect(cells).toContain("30");
    expect(cells).toContain("10");
    const foot = wrapper!.find('[data-test="o2-table-pivot-total-foot"]');
    expect(foot.find('[data-test="o2-table-pivot-total-cell-requests"]').text()).toBe("40");
  });

  it("renders the footer row from the footer calculations", async () => {
    await mountTable({ table_footer_calcs: ["sum", "mean"] });
    const foot = wrapper!.find('[data-test="o2-table-pivot-total-foot"]');
    expect(foot.exists()).toBe(true);
    const cells = (id: string) =>
      foot.findAll(`[data-test="o2-table-pivot-total-cell-${id}"]`).map((cell) => cell.text());
    expect(foot.findAll("tr")).toHaveLength(2);
    expect(cells("service")).toEqual(["Sum", "Mean"]);
    expect(cells("requests")).toEqual(["40", "20"]);
  });

  it("has no footer and today's row height without the keys", async () => {
    await mountTable({});
    expect(wrapper!.find('[data-test="o2-table-pivot-total-foot"]').exists()).toBe(false);
    expect(wrapper!.findComponent({ name: "OTable" }).props("rowHeight")).toBe(22);
  });

  it("passes the density row height to the table", async () => {
    await mountTable({}, "comfortable");
    expect(wrapper!.findComponent({ name: "OTable" }).props("rowHeight")).toBe(36);
  });
});
