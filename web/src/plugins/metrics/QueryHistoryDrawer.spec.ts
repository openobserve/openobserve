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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enableAutoUnmount, mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import store from "@/test/unit/helpers/store";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  record: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));

const breakpoint = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isMobile: ref(breakpoint.mobile) }),
}));

const push = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push, resolve: () => ({ href: "/web/metrics" }) }),
}));

import QueryHistoryDrawer from "./QueryHistoryDrawer.vue";

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;

// v1.1.x rows: no key, no window; the migration gave them source metrics and updated_at.
const LEGACY = [
  {
    id: "e2",
    source: "metrics",
    query: "rate(x[5m])",
    query_key: null,
    streams: [],
    context: { metrics_data: "blob-2", time_range: { period: "6h" }, chart_type: "bar" },
    status: "ok",
    starred: true,
    run_count: 1,
    created_at: NOW_US,
    updated_at: NOW_US,
  },
  {
    id: "e1",
    source: "metrics",
    query: "up",
    query_key: null,
    streams: [],
    context: { metrics_data: "blob-1", time_range: { from: 1000, to: 2000 }, chart_type: "line" },
    status: "ok",
    starred: false,
    run_count: 1,
    created_at: NOW_US - 1,
    updated_at: NOW_US - 1,
  },
];

const mountDrawer = () =>
  mount(QueryHistoryDrawer, {
    global: {
      plugins: [store],
      stubs: {
        ODrawer: {
          props: ["open", "size"],
          template: `<div v-if="open" data-stub="drawer" :data-size="size"><slot /></div>`,
        },
        ODropdown: { template: `<div @click.stop><slot name="trigger" /><slot /></div>` },
        ODropdownItem: {
          emits: ["select"],
          template: `<button v-bind="$attrs" @click="$emit('select')"><slot /></button>`,
        },
        OTimeCell: true,
        OTooltip: true,
      },
    },
  });

const open = async (wrapper: ReturnType<typeof mountDrawer>) => {
  (wrapper.vm as unknown as { show: () => void }).show();
  await flushPromises();
};

describe("QueryHistoryDrawer (Metrics on the shared drawer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    breakpoint.mobile = false;
    api.list.mockResolvedValue({ data: LEGACY });
  });

  it("fetches nothing until opened, then lists this page's rows newest first", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    expect(api.list).not.toHaveBeenCalled();

    await open(wrapper);
    expect(api.list).toHaveBeenCalledWith("default", { source: "metrics", limit: 50, offset: 0 });
    const rows = wrapper
      .findAll('[data-test^="recent-searches-drawer-row-"]')
      .map((r) => r.attributes("data-test"));
    expect(rows).toEqual(["recent-searches-drawer-row-e2", "recent-searches-drawer-row-e1"]);
  });

  it("re-runs a v1.1.x row with its stored panel and range", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="recent-searches-drawer-row-e2"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("load")?.[0]?.[0]).toEqual({
      metricsData: "blob-2",
      timeRange: expect.objectContaining({ valueType: "relative", relativeTimePeriod: "6h" }),
      run: true,
    });
    expect(wrapper.find('[data-stub="drawer"]').exists()).toBe(false);
  });

  it("loads a v1.1.x absolute row without running", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="recent-searches-load-e1"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("load")?.[0]?.[0]).toEqual({
      metricsData: "blob-1",
      timeRange: expect.objectContaining({ valueType: "absolute", startTime: 1000, endTime: 2000 }),
      run: false,
    });
  });

  it("stars, unstars and deletes through the entry routes", async () => {
    api.star.mockResolvedValue({ data: {} });
    api.remove.mockResolvedValue({ data: {} });
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="recent-searches-star-e1"]').trigger("click");
    await flushPromises();
    expect(api.star).toHaveBeenCalledWith("default", "e1", true);
    await wrapper.find('[data-test="recent-searches-star-e2"]').trigger("click");
    await flushPromises();
    expect(api.star).toHaveBeenCalledWith("default", "e2", false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await wrapper.find('[data-test="recent-searches-delete-e1"]').trigger("click");
      vi.advanceTimersByTime(6000);
      await flushPromises();
    } finally {
      vi.useRealTimers();
    }
    expect(api.remove).toHaveBeenCalledWith("default", "e1");
    expect(wrapper.emitted("load")).toBeUndefined();
  });

  it("opens another page's row on that page instead of loading it here", async () => {
    const wrapper = mountDrawer();
    (wrapper.vm as unknown as { restore: (...args: unknown[]) => void }).restore(
      {
        ...LEGACY[0],
        id: "logs-row",
        source: "logs",
        query: "level = 'error'",
        streams: ["k8s"],
        context: { page: { stream: "k8s" } },
      },
      "now",
      true,
    );
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/logs",
        query: expect.objectContaining({ type: "search_history_re_apply" }),
      }),
    );
    expect(wrapper.emitted("load")).toBeUndefined();
  });

  it("goes full screen on mobile", async () => {
    breakpoint.mobile = true;
    const wrapper = mountDrawer();
    await open(wrapper);
    expect(wrapper.find('[data-stub="drawer"]').attributes("data-size")).toBe("full");
  });
});
