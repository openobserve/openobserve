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

// The Hosts fleet page (design 4.8/§6): onboarding empty state, URL-carried state, banners, tinting.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h, ref } from "vue";
import HostsPage from "./HostsPage.vue";
import i18n from "@/locales";

// Mock factories only dereference these at mount time, so module-scope reactive state is safe.
vi.mock("./useHostsList", () => ({
  useHostsList: () => hostsListState,
  utilizationTint: (v: number | null) =>
    v == null ? "" : v >= 90 ? "critical" : v >= 70 ? "warn" : "",
}));

vi.mock("@/composables/useWorkloadDetection", () => ({
  useWorkloadDetection: () => ({ states: workloadStates, refresh: detectionRefresh }),
}));

const makeRow = (over: any = {}) => ({
  host_name: "web-01",
  os_type: "linux",
  status: "ACTIVE",
  cpu: 95,
  memoryPct: 50,
  memoryUsedBytes: 8_000_000_000,
  memoryTotalBytes: 16_000_000_000,
  disk: 45,
  load: 1.5,
  lastSeen: "2026-09-03 10:00:00",
  // The raw µs the curated drawer badges off (design §7.3) — the formatted
  // string above cannot be compared against a doc_time_max.
  lastSeenUs: 1_700_000_890_000_000,
  ...over,
});

const hostsListState = {
  rows: ref<any[]>([]),
  filteredRows: ref<any[]>([]),
  pagedRows: ref<any[]>([]),
  facets: ref<any>({ status: [], os: [] }),
  fleetCount: ref({ total: 0, active: 0 }),
  banners: ref({ liveness: false, lastSeen: false }),
  pageError: ref<string | null>(null),
  nameFilter: ref(""),
  statusFilter: ref<string[]>([]),
  osFilter: ref<string[]>([]),
  sortBy: ref("cpu"),
  sortDesc: ref(true),
  page: ref(1),
  refresh: vi.fn().mockResolvedValue(undefined),
};

const workloadStates = ref<Record<string, string>>({
  hosts: "detected",
  kubernetes: "undetected",
  aws: "undetected",
});
const detectionRefresh = vi.fn();

// Renders the page's #cell-* templates per row so tint/tooltip markup is real.
const OTableStub = defineComponent({
  name: "OTable",
  props: ["data", "columns", "loading"],
  setup(props: any, { slots }: any) {
    return () =>
      h("div", { "data-test": "hosts-table-stub" }, [
        ...(props.data ?? []).map((row: any) =>
          h(
            "div",
            { class: "row-stub" },
            Object.keys(slots)
              .filter((s) => s.startsWith("cell-"))
              .map((s) => slots[s]?.({ row })),
          ),
        ),
      ]);
  },
});

const passthrough = (name: string) =>
  defineComponent({
    name,
    setup(_p: any, { slots }: any) {
      return () => h("div", {}, [slots.default?.(), slots.actions?.(), slots.header?.()]);
    },
  });

// Mirrors DateTime.vue's exposed refresh(): the page re-anchors a relative
// range by calling it, so the stub has to expose a spy rather than a no-op.
const dateTimeRefreshSpy = vi.fn();
const dateTimeStub = defineComponent({
  name: "DateTime",
  emits: ["on:date-change"],
  setup(_p, { expose }) {
    expose({ refresh: dateTimeRefreshSpy });
    return () => h("div", { "data-test": "hosts-datetime-stub" });
  },
});

const drawerStub = {
  name: "HostDetailDrawer",
  props: ["hostName", "status", "osType", "range", "lastSeenUs"],
  emits: ["close"],
  template:
    "<div data-test='host-drawer-stub' :data-host='hostName' :data-os='osType' :data-last-seen-us='lastSeenUs' />",
};

const setupCardStub = {
  name: "DataSourceSetupCard",
  props: ["slug"],
  emits: ["detected"],
  template: "<div data-test='setup-card-stub' :data-slug='slug' />",
};

function seedFleet() {
  const rows = [
    makeRow({ host_name: "web-01", cpu: 95, memoryPct: 75, disk: 45 }),
    makeRow({ host_name: "web-02", cpu: 42, memoryPct: 30, disk: 20 }),
    makeRow({
      host_name: "db-01",
      status: "INACTIVE",
      cpu: null,
      memoryPct: null,
      memoryUsedBytes: null,
      memoryTotalBytes: null,
      disk: null,
      load: null,
    }),
  ];
  hostsListState.rows.value = rows;
  hostsListState.filteredRows.value = rows;
  hostsListState.pagedRows.value = rows;
  hostsListState.fleetCount.value = { total: 3, active: 2 };
  hostsListState.facets.value = {
    status: [
      { value: "ACTIVE", count: 2 },
      { value: "INACTIVE", count: 1 },
    ],
    os: [{ value: "linux", count: 2 }],
  };
}

describe("HostsPage", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;

  const mountPage = async (query: Record<string, any> = {}) => {
    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        timezone: "UTC",
        theme: "light",
        zoConfig: {},
        organizationData: {},
        userInfo: { email: "t@e.com" },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/infra/hosts", name: "infraHosts", component: { template: "<div />" } },
      ],
    });
    await router.push({ path: "/infra/hosts", query });
    await router.isReady();
    const w = mount(HostsPage, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          OTable: OTableStub,
          OPageLayout: passthrough("OPageLayout"),
          OPageHeader: passthrough("OPageHeader"),
          DateTime: dateTimeStub,
          HostDetailDrawer: drawerStub,
          DataSourceSetupCard: setupCardStub,
        },
      },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so a per-test re-emit would leak.
    dateTimeRefreshSpy.mockReset();
    workloadStates.value = { hosts: "detected", kubernetes: "undetected", aws: "undetected" };
    hostsListState.rows.value = [];
    hostsListState.filteredRows.value = [];
    hostsListState.pagedRows.value = [];
    hostsListState.fleetCount.value = { total: 0, active: 0 };
    hostsListState.banners.value = { liveness: false, lastSeen: false };
    hostsListState.pageError.value = null;
    hostsListState.nameFilter.value = "";
    hostsListState.statusFilter.value = [];
    hostsListState.osFilter.value = [];
    hostsListState.page.value = 1;
    hostsListState.sortBy.value = "cpu";
    hostsListState.sortDesc.value = true;
    seedFleet();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe("empty / first-run state", () => {
    it("mounts the inline agent setup cards instead of the table when undetected", async () => {
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="hosts-table-stub"]').exists()).toBe(false);
      // RBAC-honest copy: detection is permission-filtered (§7 risk 15).
      expect(wrapper.text()).toContain("No host telemetry visible to you yet");
      expect(wrapper.text()).toContain("ask your admin");
    });

    it("switches the embedded setup card's slug through the OS toggle (4.8)", async () => {
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      expect(wrapper.find('[data-test="setup-card-stub"]').attributes("data-slug")).toBe("linux");
      await wrapper.find('[data-test="hosts-os-toggle-windows"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="setup-card-stub"]').attributes("data-slug")).toBe("windows");
      await wrapper.find('[data-test="hosts-os-toggle-macos"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="setup-card-stub"]').attributes("data-slug")).toBe("macos");
    });

    it("re-runs detection when the embedded setup card emits detected (empty→live wiring)", async () => {
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      detectionRefresh.mockClear();
      // The card's own detection state never reaches this page's instance — the emit must.
      wrapper.findComponent({ name: "DataSourceSetupCard" }).vm.$emit("detected", 4);
      await flushPromises();
      // force:true — the stream cache may hold a stale empty list from this page's own mount.
      expect(detectionRefresh).toHaveBeenCalledWith({ force: true });
    });

    it("flips from the embedded setup card to the live table when detection connects", async () => {
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(true);
      workloadStates.value = { ...workloadStates.value, hosts: "detected" };
      await flushPromises();
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="hosts-table-stub"]').exists()).toBe(true);
    });
  });

  describe("instant-value honesty", () => {
    // The utilization columns are instant samples taken at the window's end
    // (/api/v1/query has no start parameter), so the page must never present
    // them as an aggregate over the picked range.
    it("labels the utilization columns as current, not as window aggregates", async () => {
      wrapper = await mountPage();
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      const header = (id: string) => columns.find((c) => c.id === id)?.header;
      expect(header("cpu")).toBe("CPU % (current)");
      expect(header("memory")).toBe("Memory (current)");
      expect(header("disk")).toBe("Disk % (current)");
      expect(header("load")).toBe("Load 15m (current)");
    });

    it("says plainly that utilization is a latest sample while the range drives membership", async () => {
      wrapper = await mountPage();
      const note = wrapper.find('[data-test="hosts-range-note"]');
      expect(note.exists()).toBe(true);
      expect(note.text()).toMatch(/latest sample/i);
    });
  });

  describe("fleet header & cells", () => {
    it("renders 'N hosts, M active' from the fetched fleet, not the filtered view", async () => {
      hostsListState.filteredRows.value = [hostsListState.rows.value[0]];
      wrapper = await mountPage();
      expect(wrapper.text()).toMatch(/3 hosts.*2 active/);
    });

    it("pluralizes the fleet count — '1 host', never '1 hosts'", async () => {
      hostsListState.fleetCount.value = { total: 1, active: 1 };
      wrapper = await mountPage();
      expect(wrapper.text()).toMatch(/1 host, 1 active/);
      expect(wrapper.text()).not.toContain("1 hosts");
    });

    it("tints the % cells by threshold while always printing the value", async () => {
      wrapper = await mountPage();
      const cpuHot = wrapper.find('[data-test="hosts-cell-cpu-web-01"]');
      expect(cpuHot.attributes("data-tint")).toBe("critical");
      expect(cpuHot.text()).toContain("95");
      const memWarn = wrapper.find('[data-test="hosts-cell-memory-web-01"]');
      expect(memWarn.attributes("data-tint")).toBe("warn");
      expect(memWarn.text()).toContain("75");
      const cool = wrapper.find('[data-test="hosts-cell-cpu-web-02"]');
      expect(cool.attributes("data-tint")).toBe("");
      expect(cool.text()).toContain("42");
    });

    it("prints the absolute used/total memory in the cell, not only on hover", async () => {
      wrapper = await mountPage();
      const abs = wrapper.find('[data-test="hosts-memory-absolute-web-01"]');
      expect(abs.exists()).toBe(true);
      // 8e9 / 16e9 through the shared base-1024 byte scaler.
      expect(abs.text()).toBe("7.5GB / 14.9GB");
    });

    it("scales the absolutes per host instead of forcing GB", async () => {
      hostsListState.pagedRows.value = [
        makeRow({ host_name: "tiny", memoryUsedBytes: 300_000_000, memoryTotalBytes: 900_000_000 }),
        makeRow({ host_name: "huge", memoryUsedBytes: 4e12, memoryTotalBytes: 8e12 }),
      ];
      wrapper = await mountPage();
      expect(wrapper.find('[data-test="hosts-memory-absolute-tiny"]').text()).toBe(
        "286.1MB / 858.3MB",
      );
      expect(wrapper.find('[data-test="hosts-memory-absolute-huge"]').text()).toBe("3.6TB / 7.3TB");
    });

    it.each([
      ["used", { memoryUsedBytes: null }],
      ["total", { memoryTotalBytes: null }],
    ])("renders no absolutes when %s bytes is missing", async (_label, over) => {
      hostsListState.pagedRows.value = [makeRow({ host_name: "partial", ...over })];
      wrapper = await mountPage();
      expect(wrapper.find('[data-test="hosts-memory-absolute-partial"]').exists()).toBe(false);
      // The percentage is still a real reading, so the cell must not fall back to the em-dash.
      expect(wrapper.find('[data-test="hosts-cell-memory-partial"]').text()).toContain("50%");
    });

    it("keeps the bar and percentage alongside the absolutes", async () => {
      wrapper = await mountPage();
      const cell = wrapper.find('[data-test="hosts-cell-memory-web-01"]');
      expect(cell.find('[role="progressbar"]').exists()).toBe(true);
      expect(cell.find("span.tabular-nums").text()).toBe("75%");
      expect(cell.find('[data-test="hosts-memory-absolute-web-01"]').exists()).toBe(true);
    });
  });

  describe("utilization bars", () => {
    it.each([
      ["cpu", 95],
      ["memory", 75],
      ["disk", 45],
    ])("renders a bar alongside the %s number", async (column, value) => {
      wrapper = await mountPage();
      const cell = wrapper.find(`[data-test="hosts-cell-${column}-web-01"]`);
      const bar = cell.find('[role="progressbar"]');
      expect(bar.exists()).toBe(true);
      expect(bar.attributes("aria-valuenow")).toBe(String(value));
      // The bar is an addition, never a replacement — the digits stay readable and sortable.
      expect(cell.text()).toContain(`${value}%`);
    });

    it("keeps the numeric value in tabular numerals so columns line up", async () => {
      wrapper = await mountPage();
      const value = wrapper.find('[data-test="hosts-cell-cpu-web-01"] span.tabular-nums');
      expect(value.exists()).toBe(true);
      expect(value.text()).toBe("95%");
    });

    it("gives the bar the same threshold semantics as the number", async () => {
      wrapper = await mountPage();
      const hot = wrapper.findComponent({ name: "OProgressBar" });
      expect(hot.props("variant")).toBe("danger");

      const warnCell = wrapper.find('[data-test="hosts-cell-memory-web-01"]');
      expect(warnCell.findComponent({ name: "OProgressBar" }).props("variant")).toBe("warning");
      expect(warnCell.find("span.tabular-nums").classes()).toContain("text-warning");

      const coolCell = wrapper.find('[data-test="hosts-cell-cpu-web-02"]');
      expect(coolCell.findComponent({ name: "OProgressBar" }).props("variant")).toBe("default");
      expect(coolCell.find("span.tabular-nums").classes()).not.toContain("text-warning");
    });

    it("draws no bar for a null reading but still prints the em-dash", async () => {
      wrapper = await mountPage();
      const cell = wrapper.find('[data-test="hosts-cell-cpu-db-01"]');
      expect(cell.find('[role="progressbar"]').exists()).toBe(false);
      expect(cell.text()).toContain("—");
    });

    it("keeps the % columns sortable on their accessorKey through the custom cell", async () => {
      wrapper = await mountPage();
      const columns = wrapper.findComponent({ name: "OTable" }).props("columns") as any[];
      for (const [id, accessorKey] of [
        ["cpu", "cpu"],
        ["memory", "memoryPct"],
        ["disk", "disk"],
      ]) {
        const col = columns.find((c) => c.id === id);
        expect(col.sortable).toBe(true);
        expect(col.accessorKey).toBe(accessorKey);
        expect(col.meta.align).toBe("right");
      }
    });

    it("routes a sort on a bar column back through the field map", async () => {
      wrapper = await mountPage();
      wrapper
        .findComponent({ name: "OTable" })
        .vm.$emit("sort-change", { column: "memory", order: "asc" });
      await flushPromises();
      expect(hostsListState.sortBy.value).toBe("memoryPct");
      expect(hostsListState.sortDesc.value).toBe(false);
    });
  });

  describe("drawer deep-link", () => {
    it("opens the drawer from ?host= and clears the param on close", async () => {
      wrapper = await mountPage({ host: "web-01" });
      const drawer = wrapper.find('[data-test="host-drawer-stub"]');
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-host")).toBe("web-01");
      // The row's os_type rides along so the drawer header can chip it (design 4.8).
      expect(drawer.attributes("data-os")).toBe("linux");
      wrapper.findComponent({ name: "HostDetailDrawer" }).vm.$emit("close");
      await flushPromises();
      expect(router.currentRoute.value.query.host).toBeUndefined();
      expect(wrapper.find('[data-test="host-drawer-stub"]').exists()).toBe(false);
    });

    it("passes the row's RAW µs last-seen through to the drawer, unchanged", async () => {
      // Stream-level doc_time_max is fleet-wide and would leave a dead host's
      // panels un-badged behind a row that says offline (curated-pages §5.3/§7.3).
      wrapper = await mountPage({ host: "web-01" });
      const drawer = wrapper.find('[data-test="host-drawer-stub"]');
      expect(drawer.attributes("data-last-seen-us")).toBe("1700000890000000");
    });
  });

  describe("URL-carried state", () => {
    it("restores filter/facet/page/sort state from query params on mount", async () => {
      wrapper = await mountPage({
        name: "web",
        status: "ACTIVE",
        os: "linux",
        page: "2",
        sort: "memoryPct",
        desc: "false",
      });
      expect(hostsListState.nameFilter.value).toBe("web");
      expect(hostsListState.statusFilter.value).toContain("ACTIVE");
      expect(hostsListState.osFilter.value).toContain("linux");
      expect(hostsListState.page.value).toBe(2);
      expect(hostsListState.sortBy.value).toBe("memoryPct");
      expect(hostsListState.sortDesc.value).toBe(false);
    });

    it("resets to page 1 (and clears ?page) when a filter changes", async () => {
      wrapper = await mountPage();
      hostsListState.page.value = 3;
      await flushPromises();
      expect(router.currentRoute.value.query.page).toBe("3");
      // A narrowed result set on a stale ?page would render a false-empty table.
      hostsListState.statusFilter.value = ["ACTIVE"];
      await flushPromises();
      await flushPromises();
      expect(hostsListState.page.value).toBe(1);
      expect(router.currentRoute.value.query.page).toBeUndefined();
    });

    it("keeps a URL-restored page across the same-tick filter restore (remount)", async () => {
      wrapper = await mountPage({ name: "web", page: "3" });
      expect(hostsListState.page.value).toBe(3);
    });

    it("writes filter and sort changes back into the URL", async () => {
      wrapper = await mountPage();
      hostsListState.nameFilter.value = "db";
      hostsListState.sortBy.value = "disk";
      hostsListState.osFilter.value = ["windows"];
      await flushPromises();
      expect(router.currentRoute.value.query.name).toBe("db");
      expect(router.currentRoute.value.query.sort).toBe("disk");
      expect([router.currentRoute.value.query.os].flat()).toContain("windows");
    });
  });

  describe("facet rail stability", () => {
    it("keeps ACTIVE, INACTIVE fixed and appends UNKNOWN last only when present", async () => {
      wrapper = await mountPage();
      let values = wrapper
        .findAll('[data-test^="hosts-facet-status-"]')
        .map((el) => el.attributes("data-test"));
      expect(values).toEqual(["hosts-facet-status-ACTIVE", "hosts-facet-status-INACTIVE"]);

      // §4.8: UNKNOWN only exists on total liveness failure ⇒ ALL rows UNKNOWN, zero-count rows kept.
      hostsListState.facets.value = {
        status: [
          { value: "ACTIVE", count: 0 },
          { value: "INACTIVE", count: 0 },
          { value: "UNKNOWN", count: 3 },
        ],
        os: [],
      };
      await flushPromises();
      values = wrapper
        .findAll('[data-test^="hosts-facet-status-"]')
        .map((el) => el.attributes("data-test"));
      // UNKNOWN appended last — the rows above it never shift.
      expect(values).toEqual([
        "hosts-facet-status-ACTIVE",
        "hosts-facet-status-INACTIVE",
        "hosts-facet-status-UNKNOWN",
      ]);
    });

    it("pads every facet row by the same step so the group reads as one column", async () => {
      wrapper = await mountPage();
      const rows = wrapper.findAll(
        '[data-test^="hosts-facet-status-"], [data-test^="hosts-facet-os-"]',
      );
      expect(rows.length).toBeGreaterThan(0);
      // The heading shares this inline padding, so heading and label sit on one edge.
      for (const row of rows) expect(row.classes()).toContain("px-2");
    });

    it("renders each count as a chip in its own row, not a loose right-edge number", async () => {
      wrapper = await mountPage();
      const row = wrapper.find('[data-test="hosts-facet-os-linux"]');
      const chip = row.findComponent({ name: "OTag" });
      expect(chip.exists()).toBe(true);
      expect(chip.props("type")).toBe("countChip");
      expect(row.text()).toContain("linux");
      expect(row.text()).toContain("2");
    });

    it("marks a checked facet row so the selection is visible on the row, not just the box", async () => {
      wrapper = await mountPage();
      const row = () => wrapper.find('[data-test="hosts-facet-status-ACTIVE"]');
      expect(row().classes()).not.toContain("bg-surface-subtle");
      hostsListState.statusFilter.value = ["ACTIVE"];
      await flushPromises();
      expect(row().classes()).toContain("bg-surface-subtle");
    });
  });

  describe("refresh triggers", () => {
    it("refetches when the time picker changes", async () => {
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      wrapper
        .findComponent({ name: "DateTime" })
        .vm.$emit("on:date-change", { startTime: 111, endTime: 222 });
      await flushPromises();
      expect(hostsListState.refresh).toHaveBeenCalled();
    });

    it("does NOT fetch on the picker's mount replay (userChangedValue === false)", async () => {
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      // DateTime.vue contract: the mount emit is stamped programmatic — "do not fetch".
      wrapper
        .findComponent({ name: "DateTime" })
        .vm.$emit("on:date-change", { startTime: 111, endTime: 222, userChangedValue: false });
      await flushPromises();
      expect(hostsListState.refresh).not.toHaveBeenCalled();
    });

    it("does NOT fan out on a date change while the org is undetected", async () => {
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      wrapper
        .findComponent({ name: "DateTime" })
        .vm.$emit("on:date-change", { startTime: 111, endTime: 222, userChangedValue: true });
      await flushPromises();
      expect(hostsListState.refresh).not.toHaveBeenCalled();
    });

    it("re-runs the fan-out from the manual Refresh trigger", async () => {
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      await wrapper.find('[data-test="hosts-refresh"]').trigger("click");
      await flushPromises();
      expect(hostsListState.refresh).toHaveBeenCalledTimes(1);
    });

    it("re-anchors a relative range through the picker instead of replaying the mount window", async () => {
      // The picker defaults to a RELATIVE 3h. Refreshing an hour later must ask
      // the picker for "3h from now" — a captured absolute window would leave a
      // host that died since reading ACTIVE, with last-seen frozen.
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      await wrapper.find('[data-test="hosts-refresh"]').trigger("click");
      await flushPromises();
      expect(dateTimeRefreshSpy).toHaveBeenCalledTimes(1);
    });

    it("still does not fan out on Refresh while the org is undetected", async () => {
      // The re-anchor fallback must not become a second way past the detection gate.
      dateTimeRefreshSpy.mockImplementation(() => {
        wrapper
          .findComponent({ name: "DateTime" })
          .vm.$emit("on:date-change", { startTime: 900, endTime: 1000, userChangedValue: false });
      });
      workloadStates.value = { ...workloadStates.value, hosts: "undetected" };
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      await wrapper.find('[data-test="hosts-refresh"]').trigger("click");
      await flushPromises();
      expect(hostsListState.refresh).not.toHaveBeenCalled();
    });

    it("fetches the window the re-anchored picker reports, not the one captured at mount", async () => {
      // Refresh must fan out with the window the picker recomputes at click
      // time. A page that re-queries its captured absolute window never sees a
      // host that died since mount, and freezes last-seen.
      const advanced = { startTime: 900, endTime: 1000 };
      dateTimeRefreshSpy.mockImplementation(() => {
        wrapper
          .findComponent({ name: "DateTime" })
          .vm.$emit("on:date-change", { ...advanced, userChangedValue: false });
      });
      wrapper = await mountPage();
      hostsListState.refresh.mockClear();
      await wrapper.find('[data-test="hosts-refresh"]').trigger("click");
      await flushPromises();
      expect(hostsListState.refresh).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: 900, end: 1000 }),
      );
    });
  });

  describe("org switching", () => {
    it("clears ?host= and filter/facet/page params, resets state and refetches", async () => {
      wrapper = await mountPage({ host: "web-01", name: "web", page: "2" });
      hostsListState.refresh.mockClear();
      store.state.selectedOrganization = { identifier: "other-org" };
      await flushPromises();
      expect(router.currentRoute.value.query.host).toBeUndefined();
      expect(router.currentRoute.value.query.name).toBeUndefined();
      expect(router.currentRoute.value.query.page).toBeUndefined();
      expect(hostsListState.refresh).toHaveBeenCalled();
    });
  });

  describe("failure surfaces", () => {
    it("shows ONE page-level error with a Retry that re-runs the fan-out when everything failed", async () => {
      hostsListState.pageError.value = "all seven calls failed";
      wrapper = await mountPage();
      const errorSurface = wrapper.find('[data-test="hosts-page-error"]');
      expect(errorSurface.exists()).toBe(true);
      hostsListState.refresh.mockClear();
      await errorSurface.find('[data-test="hosts-retry"]').trigger("click");
      expect(hostsListState.refresh).toHaveBeenCalled();
    });

    it("renders the de-jargonized liveness banner with its own Retry", async () => {
      hostsListState.banners.value = { liveness: true, lastSeen: false };
      wrapper = await mountPage();
      const banner = wrapper.find('[data-test="hosts-liveness-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain("Couldn't determine which hosts are currently reporting");
      hostsListState.refresh.mockClear();
      await banner.find('[data-test="hosts-retry"]').trigger("click");
      expect(hostsListState.refresh).toHaveBeenCalled();
    });

    it("renders the last-seen banner when the SQL side failed", async () => {
      hostsListState.banners.value = { liveness: false, lastSeen: true };
      wrapper = await mountPage();
      const banner = wrapper.find('[data-test="hosts-lastseen-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain("Inactive hosts and last-seen are unavailable");
    });
  });
});
