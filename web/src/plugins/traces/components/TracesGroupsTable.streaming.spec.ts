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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { gt } from "@/types/i18n";
import { buildGroupsColumns } from "@/plugins/traces/composables/tracesGroupsColumns";
import TracesGroupsTable from "./TracesGroupsTable.vue";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetch,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: { meta: { groupBy: "service_name" }, data: { stream: { addToFilter: "" } } },
  }),
}));

const meta = () => ({
  type: "search_response_metadata",
  content: { streaming_aggs: true, results: { hits: [] } },
});
const hits = (rows: Record<string, unknown>[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});
const group = (value: string, spans: number) => ({
  value,
  spans,
  errors: 0,
  p50: 1,
  p95: 2,
  p99: 3,
});

const OTableStub = {
  name: "OTable",
  props: ["data", "columns"],
  template: `<div><div v-for="(row, i) in data" :key="i" data-test="row">{{ row.value }}:{{ row.spans }}</div></div>`,
};

// The groups query streams over time partitions; under streaming_aggs each partition's hits are the running answer.
describe("TracesGroupsTable over a multi-partition streaming aggregate", () => {
  const mountTable = () =>
    mount(TracesGroupsTable, {
      props: {
        request: {
          stream: "default",
          key: "service_name",
          filter: "",
          scope: "",
          startTime: 1,
          endTime: 2,
          runId: 1,
        },
        sort: { by: "errors", order: "desc" },
        columns: buildGroupsColumns("service_name", gt),
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          OTable: OTableStub,
          OContextMenu: { template: "<div><slot name='trigger' /><slot /></div>" },
          OSparkline: true,
          QueryErrorState: true,
        },
      },
    });

  it("shows the last running answer, not every partition's rows added up", async () => {
    mockFetch.mockClear();
    const wrapper = mountTable();
    await flushPromises();
    const [, handlers] = mockFetch.mock.calls[0];
    handlers.data({}, meta());
    handlers.data({}, hits([group("cart", 3)]));
    handlers.data({}, meta());
    handlers.data({}, hits([group("cart", 7), group("api", 2)]));
    handlers.data({}, meta());
    handlers.data({}, hits([]));
    handlers.complete({});
    await flushPromises();
    expect(wrapper.findAll('[data-test="row"]').map((row) => row.text())).toEqual([
      "cart:7",
      "api:2",
    ]);
    wrapper.unmount();
  });

  it("replaces with each later chunk of one partition", async () => {
    mockFetch.mockClear();
    const wrapper = mountTable();
    await flushPromises();
    const [, handlers] = mockFetch.mock.calls[0];
    handlers.data({}, meta());
    handlers.data({}, hits([group("cart", 3)]));
    handlers.data({}, hits([group("cart", 7), group("api", 2)]));
    handlers.complete({});
    await flushPromises();
    expect(wrapper.findAll('[data-test="row"]').map((row) => row.text())).toEqual([
      "cart:7",
      "api:2",
    ]);
    wrapper.unmount();
  });
});
