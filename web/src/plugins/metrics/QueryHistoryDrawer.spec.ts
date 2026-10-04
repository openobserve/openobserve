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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  record: vi.fn(),
  star: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/services/query_history", () => ({ default: api }));

const breakpoint = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({ isMobile: ref(breakpoint.mobile) }),
}));

import QueryHistoryDrawer from "./QueryHistoryDrawer.vue";

const ENTRIES = [
  {
    id: "e2",
    query: "rate(x[5m])",
    context: { metrics_data: "blob-2", time_range: { period: "6h" }, chart_type: "bar" },
    starred: true,
    created_at: 2_000_000,
  },
  {
    id: "e1",
    query: "up",
    context: { metrics_data: "blob-1", time_range: { from: 1000, to: 2000 }, chart_type: "line" },
    starred: false,
    created_at: 1_000_000,
  },
];

const mountDrawer = () =>
  mount(QueryHistoryDrawer, {
    global: {
      plugins: [store],
      stubs: {
        ODrawer: {
          props: ["open", "size"],
          emits: ["update:open"],
          template: `<div>
            <span @click="$emit('update:open', true)"><slot name="trigger" /></span>
            <div v-if="open" data-test="drawer" :data-size="size"><slot /></div>
          </div>`,
        },
        OTable: {
          props: ["data"],
          emits: ["row-click"],
          template: `<div>
            <div v-for="row in data" :key="row.id" :data-test="'row-' + row.id" @click="$emit('row-click', row, $event)">
              <slot name="cell-query" :row="row" />
              <slot name="cell-actions" :row="row" />
            </div>
          </div>`,
        },
        OTimeCell: true,
        OTooltip: true,
        OSearchInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        OSwitch: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
        },
      },
    },
  });

const open = async (wrapper: any) => {
  await wrapper.find('[data-test="metrics-history-btn"]').trigger("click");
  await flushPromises();
};

describe("QueryHistoryDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    breakpoint.mobile = false;
    api.list.mockResolvedValue({ data: ENTRIES });
    api.star.mockResolvedValue({ data: {} });
    api.remove.mockResolvedValue({ data: {} });
  });

  it("fetches nothing until opened, then lists the entries in server (newest-first) order", async () => {
    const wrapper = mountDrawer();
    await flushPromises();
    expect(api.list).not.toHaveBeenCalled();

    await open(wrapper);
    expect(api.list).toHaveBeenCalledWith("default", { limit: 50, offset: 0 });
    const rows = wrapper.findAll('[data-test^="row-"]').map((r) => r.attributes("data-test"));
    expect(rows).toEqual(["row-e2", "row-e1"]);
  });

  it("asks the server for starred entries only when the toggle is on", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="metrics-history-starred-only"]').setValue(true);
    await flushPromises();
    expect(api.list).toHaveBeenLastCalledWith("default", { starred: true, limit: 50, offset: 0 });
  });

  it("searches on the server", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="metrics-history-search"]').setValue("rate");
    await flushPromises();
    expect(api.list).toHaveBeenLastCalledWith("default", { q: "rate", limit: 50, offset: 0 });
  });

  it("stars, unstars and deletes through the entry routes", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="metrics-history-star-e1"]').trigger("click");
    await flushPromises();
    expect(api.star).toHaveBeenCalledWith("default", "e1", true);

    await wrapper.find('[data-test="metrics-history-star-e2"]').trigger("click");
    await flushPromises();
    expect(api.star).toHaveBeenCalledWith("default", "e2", false);

    await wrapper.find('[data-test="metrics-history-delete-e1"]').trigger("click");
    await flushPromises();
    expect(api.remove).toHaveBeenCalledWith("default", "e1");
    // A row action is not a load.
    expect(wrapper.emitted("load")).toBeUndefined();
  });

  it("loads a clicked entry and closes", async () => {
    const wrapper = mountDrawer();
    await open(wrapper);

    await wrapper.find('[data-test="row-e2"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("load")?.[0]?.[0]).toMatchObject({
      metricsData: "blob-2",
      timeRange: { valueType: "relative", relativeTimePeriod: "6h" },
    });
    expect(wrapper.find('[data-test="drawer"]').exists()).toBe(false);
  });

  describe("loading past the first page", () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...ENTRIES[1],
        id: `p${from + i}`,
        created_at: 1_000_000 - (from + i),
      }));
    const loadMore = (wrapper: any) => wrapper.find('[data-test="metrics-history-load-more"]');

    it("fetches the next page by offset and appends it", async () => {
      api.list.mockImplementation((_org: string, params: any) =>
        Promise.resolve({ data: params.offset ? page(50, 7) : page(0, 50) }),
      );
      const wrapper = mountDrawer();
      await open(wrapper);
      expect(wrapper.findAll('[data-test^="row-"]')).toHaveLength(50);

      await loadMore(wrapper).trigger("click");
      await flushPromises();
      expect(api.list).toHaveBeenLastCalledWith("default", { limit: 50, offset: 50 });
      const rows = wrapper.findAll('[data-test^="row-"]').map((r) => r.attributes("data-test"));
      expect(rows).toHaveLength(57);
      expect(rows[0]).toBe("row-p0");
      expect(rows[50]).toBe("row-p50");
      // The short page was the last one.
      expect(loadMore(wrapper).exists()).toBe(false);
    });

    it("offers no more when the first page is already short", async () => {
      const wrapper = mountDrawer();
      await open(wrapper);
      expect(loadMore(wrapper).exists()).toBe(false);
    });
  });

  it("goes full screen on mobile", async () => {
    breakpoint.mobile = true;
    const wrapper = mountDrawer();
    await open(wrapper);
    expect(wrapper.find('[data-test="drawer"]').attributes("data-size")).toBe("full");
  });
});

// The real OTable: it owns the #empty slot and the cell slots, so a stub would hide a wrong slot.
describe("QueryHistoryDrawer with the real OTable", () => {
  const DrawerStub = {
    props: ["open", "size"],
    emits: ["update:open"],
    template: `<div>
      <span @click="$emit('update:open', true)"><slot name="trigger" /></span>
      <div v-if="open" data-test="drawer"><slot /></div>
    </div>`,
  };
  const mountReal = () =>
    mount(QueryHistoryDrawer, {
      global: { plugins: [i18n, store], stubs: { ODrawer: DrawerStub } },
    });
  const emptyTitle = (wrapper: any) => wrapper.find('[data-test="metrics-history-empty"]').text();

  beforeEach(() => {
    vi.clearAllMocks();
    breakpoint.mobile = false;
    api.list.mockResolvedValue({ data: [] });
  });

  it("says there are no queries yet when nothing filters the list", async () => {
    const wrapper = mountReal();
    await open(wrapper);
    await vi.waitFor(() => expect(emptyTitle(wrapper)).toContain("No queries yet"));
  });

  it("says no queries match when a search finds nothing", async () => {
    const wrapper = mountReal();
    await open(wrapper);
    const search = wrapper.find('[data-test="metrics-history-search"]');
    await (search.element.tagName === "INPUT" ? search : search.find("input")).setValue("nomatch");
    await vi.waitFor(() =>
      expect(api.list).toHaveBeenCalledWith("default", expect.objectContaining({ q: "nomatch" })),
    );
    await vi.waitFor(() =>
      expect(emptyTitle(wrapper)).toContain("No queries match the search or starred filter"),
    );
  });

  it("folds the row actions into a kebab on a phone, so none is clipped", async () => {
    breakpoint.mobile = true;
    api.list.mockResolvedValue({ data: ENTRIES });
    const wrapper = mountReal();
    await open(wrapper);
    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="metrics-history-more-e1"]').exists()).toBe(true),
    );
    expect(wrapper.find('[data-test="metrics-history-more-e1"]').classes()).toContain("md:hidden");
    expect(wrapper.find('[data-test="metrics-history-delete-e1"]').classes()).toContain(
      "max-md:hidden",
    );
    expect(wrapper.find('[data-test="metrics-history-star-e1"]').classes()).toContain(
      "max-md:hidden",
    );
  });
});
