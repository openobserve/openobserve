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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TracesSqlResultTable from "./TracesSqlResultTable.vue";
import { buildResultColumns } from "@/plugins/traces/composables/useTracesTableColumns";

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    props: ["columns", "data", "sorting", "pagination"],
    template: `<div data-test="o-table-stub">
      <div v-for="(row, i) in data" :key="i" data-test="o-table-row">
        <template v-for="col in columns" :key="col.id">
          <slot :name="'cell-' + col.id" :row="row">{{ row[col.id] }}</slot>
        </template>
      </div>
    </div>`,
  },
}));

const mountTable = (props: Record<string, unknown>) =>
  mount(TracesSqlResultTable, {
    props: {
      hits: [],
      columns: [],
      shape: "rows",
      ...props,
    },
    global: { plugins: [i18n] },
  });

describe("TracesSqlResultTable", () => {
  it("shows one column per returned field, unsorted and unpaged", () => {
    const columns = buildResultColumns(["service_name", "n"]);
    const wrapper = mountTable({ hits: [{ service_name: "api", n: 3 }], columns });
    const table = wrapper.findComponent({ name: "OTable" });
    expect(table.props("columns").map((c: any) => c.id)).toEqual(["service_name", "n"]);
    expect(table.props("sorting")).toBe("none");
    expect(table.props("pagination")).toBe("none");
    expect(wrapper.find('[data-test="o-table-row"]').text()).toContain("api");
  });

  it("links trace rows to their trace and opens it on a plain click", async () => {
    const row = { trace_id: "t-1", n: 2 };
    const wrapper = mountTable({
      hits: [row],
      columns: buildResultColumns(["trace_id", "n"]),
      shape: "traces",
      traceHref: (r: any) => `/traces/trace?trace_id=${r.trace_id}`,
    });
    const link = wrapper.find('[data-test="traces-sql-result-trace-link"]');
    expect(link.attributes("href")).toBe("/traces/trace?trace_id=t-1");

    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("open-trace")).toEqual([[row]]);
  });

  it("leaves a modified click to the browser", () => {
    const wrapper = mountTable({
      hits: [{ trace_id: "t-1" }],
      columns: buildResultColumns(["trace_id"]),
      shape: "traces",
    });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    wrapper.find('[data-test="traces-sql-result-trace-link"]').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("open-trace")).toBeUndefined();
  });

  it("does not link trace_id for plain rows", () => {
    const wrapper = mountTable({
      hits: [{ trace_id: "t-1" }],
      columns: buildResultColumns(["trace_id"]),
      shape: "rows",
    });
    expect(wrapper.find('[data-test="traces-sql-result-trace-link"]').exists()).toBe(false);
  });

  it("offers Add trace_id only when asked to", async () => {
    expect(mountTable({}).find('[data-test="traces-sql-add-trace-id-btn"]').exists()).toBe(false);
    const wrapper = mountTable({ offerAddTraceId: true });
    await wrapper.find('[data-test="traces-sql-add-trace-id-btn"]').trigger("click");
    expect(wrapper.emitted("add-trace-id")).toHaveLength(1);
  });
});
