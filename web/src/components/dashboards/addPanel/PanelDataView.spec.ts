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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import PanelDataView from "./PanelDataView.vue";

const mountView = (props: Record<string, unknown>) =>
  mount(PanelDataView, {
    props: { dataTestPrefix: "test", ...props },
    global: { plugins: [i18n] },
  });

describe("PanelDataView", () => {
  it("shows the query result columns and rows", () => {
    const wrapper = mountView({
      data: [
        [
          { x_axis_1: "api", "a.b": 3 },
          { x_axis_1: "web", "a.b": 4 },
        ],
      ],
    });
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("columns").map((c: any) => c.id)).toEqual(["x_axis_1", "a.b"]);
    expect(table.props("data")).toHaveLength(2);
    expect(table.props("columns")[1].accessorFn(table.props("data")[0])).toBe(3);
  });

  it("gives duplicate rows distinct keys", () => {
    const row = { x_axis_1: "api", y_axis_1: 1 };
    const wrapper = mountView({ data: [[row, { ...row }]] });
    const table = wrapper.findComponent({ name: "OTable" });
    const rowKey = table.props("rowKey") as (r: any) => string;
    const [a, b] = table.props("data");
    expect(rowKey(a)).not.toBe(rowKey(b));
  });

  it("flattens PromQL range and instant series into timestamp, value and labels", () => {
    const wrapper = mountView({
      queryType: "promql",
      data: [
        {
          result: [
            { metric: { job: "api" }, values: [[1, "5"]] },
            { metric: { job: "web" }, value: [2, "7"] },
          ],
        },
      ],
    });
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("columns").map((c: any) => c.id)).toEqual(["timestamp", "value", "job"]);
    expect(table.props("data")).toHaveLength(2);
  });

  it("shows its own empty message when the query returned nothing", () => {
    const table = mountView({ data: [[]] }).findComponent({ name: "OTable" });
    expect(table.props("data")).toHaveLength(0);
    expect(table.props("emptyMessage")).toBe("No rows returned");
  });

  it("keeps the rows on screen while a refresh streams in", () => {
    const table = mountView({ data: [[{ a: 1 }]], loading: true }).findComponent({
      name: "OTable",
    });
    expect(table.props("loading")).toBe(false);
    expect(table.props("streaming")).toBe(true);
  });

  it("caps very large results and says so", () => {
    const rows = Array.from({ length: 100005 }, (_, i) => ({ i }));
    // jsdom has no layout, so a real virtual-scrolled OTable would draw every row.
    const wrapper = mount(PanelDataView, {
      props: { dataTestPrefix: "test", data: [rows] },
      global: {
        plugins: [i18n],
        stubs: { OTable: { name: "OTable", props: ["data"], template: "<div />" } },
      },
    });
    expect(wrapper.findComponent({ name: "OTable" }).props("data")).toHaveLength(100000);
    expect(wrapper.find('[data-test="test-data-view-capped"]').text()).toContain("100,005");
  });

  it("aligns a numeric column right even when its first value is empty", () => {
    const table = mountView({ data: [[{ n: null }, { n: 4 }]] }).findComponent({ name: "OTable" });
    expect(table.props("columns")[0].meta.align).toBe("right");
  });
});
