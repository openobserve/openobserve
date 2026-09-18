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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { http, HttpResponse } from "msw";
import tracesMockData from "@/test/unit/mockData/traces";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

// Mocked because the test store's streams module is a stub that never caches a fetched list.
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi
      .fn()
      .mockResolvedValue({ list: [{ name: "test-stream" }, { name: "_rumdata" }] }),
    getStream: vi.fn().mockResolvedValue({
      name: "_rumdata",
      schema: [{ name: "_oo_trace_id" }, { name: "type" }],
    }),
  }),
}));

// Trace window in ns; every value divides by 1000 exactly so the µs assertions are exact.
const TRACE_START_NS = 1_755_853_746_000_000_000;
const TRACE_END_NS = 1_755_853_747_000_000_000;
const TRACE_START_US = 1_755_853_746_000_000;
const TRACE_END_US = 1_755_853_747_000_000;
const ONE_MINUTE_US = 60_000_000;
const FIVE_MINUTES_US = 300_000_000;
// Deliberately weeks wide so a leg still driven by the details window is distinguishable.
const WIDE_NEW_START_US = 1_753_000_000_000_000;
const WIDE_NEW_END_US = 1_758_000_000_000_000;

function makeDetailsResponse(rootParentId: string) {
  const hits = JSON.parse(JSON.stringify(tracesMockData.tracesDetails.traceSpans.hits));
  hits[0].reference_parent_span_id = rootParentId;
  const windows = [
    [TRACE_START_NS, TRACE_END_NS],
    [TRACE_START_NS + 100_000_000, TRACE_END_NS - 100_000_000],
    [TRACE_START_NS + 200_000_000, TRACE_END_NS - 200_000_000],
  ];
  windows.forEach(([start, end], i) => {
    hits[i].start_time = start;
    hits[i].end_time = end;
    hits[i]._start_time_ns = String(start);
    hits[i]._end_time_ns = String(end);
  });
  return { hits, new_start_time: WIDE_NEW_START_US, new_end_time: WIDE_NEW_END_US };
}

const STUBS = {
  "chart-renderer": {
    template: '<div data-test="chart-renderer">Chart</div>',
    props: ["data", "id"],
    emits: ["updated:chart"],
  },
  "trace-tree": {
    template: '<div data-test="trace-tree">Trace Tree</div>',
    props: [
      "collapseMapping",
      "spans",
      "baseTracePosition",
      "spanDimensions",
      "spanMap",
      "leftWidth",
      "searchQuery",
      "spanList",
    ],
    emits: ["toggle-collapse", "select-span", "update-current-index", "search-result"],
    methods: {
      nextMatch: vi.fn(),
      prevMatch: vi.fn(),
    },
  },
  "trace-header": {
    template: '<div data-test="trace-header">Trace Header</div>',
    props: ["baseTracePosition", "splitterWidth"],
    emits: ["resize-start"],
  },
  "trace-details-sidebar": {
    template: '<div data-test="trace-details-sidebar">Sidebar</div>',
    props: ["span", "baseTracePosition", "searchQuery"],
    emits: ["view-logs", "close", "open-trace"],
  },
};

describe("TraceDetails - RUM bridge gate and windows", () => {
  let wrapper: any;
  let rumRequests: any[];

  function mountWithDetails(details: any) {
    rumRequests = [];
    globalThis.server.use(
      http.get(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/settings/v2/key_fields`,
        () => HttpResponse.json({ setting_value: {} }),
      ),
      http.get(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/:stream/traces/:traceId/details`,
        () => HttpResponse.json(details),
      ),
      http.post(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
        async ({ request }) => {
          const body: any = await request.json();
          if (body.query?.sql?.includes("_rumdata")) {
            rumRequests.push(body.query);
            return HttpResponse.json({ took: 0, hits: [], total: 0, from: 0, size: 0 });
          }
          return HttpResponse.json(details);
        },
      ),
    );

    return mountTraceDetails({ traceId: "test-trace-id" });
  }

  function mountTraceDetails(props: Record<string, unknown>) {
    return mount(TraceDetails, {
      attachTo: "#app",
      props,
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: STUBS,
      },
    });
  }

  beforeEach(() => {
    localStorage.removeItem("o2_trace_active_tab");
    localStorage.removeItem("o2_trace_tab_order");

    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          trace_id: "test-trace-id",
          from: "1752490492843",
          to: "1752490493164",
          stream: "test-stream",
          org_identifier: "default",
        },
        name: "traceDetails",
      },
    } as any);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  it("sends no _rumdata search when the root span has an empty parent id", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    wrapper = mountWithDetails(makeDetailsResponse(""));
    await flushPromises();

    // spanList is assigned only after the RUM leg has settled, so it is the sync point.
    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBe(3), { timeout: 5000 });
    await flushPromises();

    expect(rumRequests).toHaveLength(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("bounds the browser-request search by the span-derived trace window, not the details window", async () => {
    wrapper = mountWithDetails(makeDetailsResponse("d4b07e603e2fa32f"));
    await flushPromises();

    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBe(3), { timeout: 5000 });
    await flushPromises();

    expect(rumRequests).toHaveLength(1);
    expect(rumRequests[0].start_time).toBe(TRACE_START_US - ONE_MINUTE_US);
    expect(rumRequests[0].end_time).toBe(TRACE_END_US + FIVE_MINUTES_US);
  });

  it("derives the header trace window from the spans with a usable pair of timestamps", async () => {
    const consoleSpy = vi.spyOn(console, "error");
    const details = makeDetailsResponse("");
    // The earliest-starting span has no end, so it must not lower the header start.
    details.hits[0].end_time = "";
    wrapper = mountWithDetails(details);
    await flushPromises();

    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBe(3), { timeout: 5000 });
    await flushPromises();

    const selected = wrapper.vm.searchObj.data.traceDetails.selectedTrace;
    expect(selected.trace_start_time).toBe(TRACE_START_US + 100_000);
    expect(selected.trace_end_time).toBe(TRACE_END_US - 100_000);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("floors the start and ceils the end of the embedded header window", async () => {
    // +512 ns is exact in a double at this magnitude (granularity 256); +999 would round to +1024.
    wrapper = mountTraceDetails({
      mode: "embedded",
      traceIdProp: "test-trace-id",
      streamNameProp: "test-stream",
      spanListProp: [
        {
          ...makeDetailsResponse("").hits[0],
          start_time: TRACE_START_NS + 512,
          end_time: TRACE_END_NS + 512,
        },
      ],
    });
    await flushPromises();

    const selected = wrapper.vm.searchObj.data.traceDetails.selectedTrace;
    expect(selected.trace_start_time).toBe(TRACE_START_US);
    expect(selected.trace_end_time).toBe(TRACE_END_US + 1);
  });
});
