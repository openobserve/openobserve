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
import { defineComponent, inject, ref, watchEffect, type Ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";

// Records every value the injected `selectedTabId` settles on, so a test can
// assert the parent (PinnedDashboardTab) provided it and set it correctly.
// A plain stub template reads the ref at the wrong render tick under VTU;
// watchEffect observes the settled reactive value instead.
const injectedTabIds: string[] = [];
// Captures the dashboardData prop that actually reaches RenderDashboardCharts,
// so a test can assert it is the PROCESSED dashboard (tabs[].panels present),
// not the raw versioned API envelope.
let lastDashboardData: any = null;
import PinnedDashboardTab from "@/views/PinnedDashboardTab.vue";
import store from "./helpers/store";
import i18n from "@/locales";

// PinnedDashboardTab must load through the shared getDashboard util (same as
// ViewDashboard): it unwraps the versioned envelope (data.v5), runs schema
// conversion, and ensures variables. Mock it — NOT the raw service — so tests
// exercise the real data path.
vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn(),
}));
import { getDashboard } from "@/utils/commons";

// Stub heavy children so we test PinnedDashboardTab logic, not the grid.
const globalStubs = {
  RenderDashboardCharts: defineComponent({
    name: "RenderDashboardCharts",
    props: ["dashboardData", "currentTimeObj", "viewOnly", "showTabs", "initialVariableValues"],
    setup() {
      // Inject selectedTabId exactly as the real component does (inject with a
      // ref("default") fallback), and record every settled value so tests can
      // assert the parent provides it and sets it to the first tab id.
      const selectedTabId = inject<Ref<string | null>>(
        "selectedTabId",
        ref("default"),
      );
      watchEffect(() => {
        if (selectedTabId.value != null) injectedTabIds.push(selectedTabId.value);
      });
      return { selectedTabId };
    },
    created() {
      lastDashboardData = (this as any).dashboardData;
    },
    updated() {
      lastDashboardData = (this as any).dashboardData;
    },
    template: "<div class='render-stub' />",
  }),
  // Stub exposes getConsumableDateTime() (via ref) and can emit @hide so the
  // component's setTime() runs and we can assert the currentTimeObj it builds.
  DateTimePickerDashboard: {
    name: "DateTimePickerDashboard",
    template: "<div class='date-time-picker-stub' @click=\"$emit('hide')\" />",
    emits: ["hide", "update:modelValue"],
    methods: {
      getConsumableDateTime() {
        // Fixed epoch-ms window so the assertion is deterministic.
        return { startTime: 1_700_000_000_000, endTime: 1_700_000_900_000 };
      },
    },
  },
  AutoRefreshInterval: { template: "<div class='auto-refresh-stub' />" },
  OSkeleton: { template: "<div class='skeleton-stub' />" },
};

const factory = () =>
  mount(PinnedDashboardTab, {
    props: { dashboardId: "abc", folderId: "default" },
    global: {
      plugins: [i18n, store],
      stubs: globalStubs,
      mocks: { $t: (k: string) => k },
    },
  });

describe("PinnedDashboardTab", () => {
  let wrapper: any;

  // Shape returned by the real getDashboard util: a PROCESSED dashboard —
  // unwrapped from the versioned envelope, schema-converted, with tabs[].panels.
  const processedDashboard = (overrides: any = {}) => ({
    title: "Payments Health",
    version: 5,
    variables: { list: [] },
    tabs: [
      { tabId: "gen-tab-1", name: "Default", panels: [{ id: "p1" }] },
    ],
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    injectedTabIds.length = 0;
    lastDashboardData = null;
    store.state.selectedOrganization = {
      label: "Test Organization",
      id: 159,
      identifier: "test-org",
      user_email: "test@example.com",
      subscription_type: "premium",
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    localStorage.clear();
  });

  it("loads via getDashboard and renders RenderDashboardCharts with view-only", async () => {
    (getDashboard as any).mockResolvedValue(processedDashboard({ title: "Payments Health" }));
    wrapper = factory();
    await flushPromises();
    const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
    expect(render.exists()).toBe(true);
    expect(render.props("viewOnly")).toBe(true);
    // Loaded through the shared util (unwraps version envelope + converts schema),
    // NOT the raw service.
    expect(getDashboard).toHaveBeenCalledWith(expect.anything(), "abc", "default");
  });

  it("passes a processed dashboard (tabs[].panels present) to RenderDashboardCharts", async () => {
    // ROOT-CAUSE REGRESSION: the raw service returns a versioned envelope
    // ({version, v5:{...}}) whose top level has no `tabs`, so panels resolved
    // empty ("No panels here yet"). getDashboard returns the unwrapped, converted
    // dashboard. Assert the object reaching the grid actually has tabs[].panels.
    (getDashboard as any).mockResolvedValue(processedDashboard());
    wrapper = factory();
    await flushPromises();
    expect(lastDashboardData).toBeTruthy();
    expect(Array.isArray(lastDashboardData.tabs)).toBe(true);
    expect(lastDashboardData.tabs[0].panels).toHaveLength(1);
    // Must NOT be the raw versioned envelope.
    expect(lastDashboardData).not.toHaveProperty("v5");
  });

  it("provides selectedTabId set to the dashboard's first tab id", async () => {
    // RenderDashboardCharts filters panels by the injected selectedTabId.
    // Assert the provided value settles on the first tab's id (not "default").
    (getDashboard as any).mockResolvedValue(
      processedDashboard({
        tabs: [{ tabId: "gen-tab-1", name: "Nodes", panels: [{ id: "p1" }] }],
      }),
    );
    wrapper = factory();
    await flushPromises();
    expect(injectedTabIds).toContain("gen-tab-1");
    expect(injectedTabIds[injectedTabIds.length - 1]).toBe("gen-tab-1");
  });

  it("provides selectedTabId 'default' when the dashboard has no tabs", async () => {
    (getDashboard as any).mockResolvedValue(processedDashboard({ tabs: [] }));
    wrapper = factory();
    await flushPromises();
    expect(injectedTabIds[injectedTabIds.length - 1]).toBe("default");
  });

  it("emits update-label with the live title", async () => {
    (getDashboard as any).mockResolvedValue(processedDashboard({ title: "Payments Health" }));
    wrapper = factory();
    await flushPromises();
    expect(wrapper.emitted("update-label")?.[0]).toEqual(["Payments Health"]);
  });

  it("emits unavailable when getDashboard rejects", async () => {
    (getDashboard as any).mockRejectedValue({ response: { status: 404 } });
    wrapper = factory();
    await flushPromises();
    expect(wrapper.emitted("unavailable")?.[0]).toEqual(["abc"]);
  });

  it("emits unavailable when getDashboard returns an empty object (deleted)", async () => {
    // getDashboard returns {} (not a throw) for a missing/deleted dashboard.
    (getDashboard as any).mockResolvedValue({});
    wrapper = factory();
    await flushPromises();
    expect(wrapper.emitted("unavailable")?.[0]).toEqual(["abc"]);
  });

  it("shows skeleton while loading", async () => {
    (getDashboard as any).mockReturnValue(new Promise(() => {}));
    wrapper = factory();
    expect(wrapper.find(".skeleton-stub").exists()).toBe(true);
  });

  it("passes __global time to RenderDashboardCharts on load (no picker interaction)", async () => {
    // RenderDashboardCharts reads currentTimeObj['__global'] (never a flat
    // start_time/end_time). The __global entry must be present IMMEDIATELY on
    // load — the DateTimePickerDashboard ref is null on first render, so the
    // window is resolved from selectedDate (default relative 15m), not the
    // picker. If it weren't, currentTimeObj stayed {} and panels never queried.
    (getDashboard as any).mockResolvedValue(processedDashboard());
    wrapper = factory();
    await flushPromises();

    const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
    const cto = render.props("currentTimeObj");
    expect(cto).toHaveProperty("__global");
    expect(cto.__global.start_time).toBeInstanceOf(Date);
    expect(cto.__global.end_time).toBeInstanceOf(Date);
  });

  it("builds __global Dates from MICROSECOND values (matches panel pipeline)", async () => {
    // ROOT-CAUSE REGRESSION: the panel pipeline treats __global Dates as
    // microsecond carriers — it does new Date(consumableTime.startTime) where
    // startTime is epoch-µs, and later reads .getTime() expecting that µs
    // magnitude. If PinnedDashboardTab builds the Date from milliseconds
    // (µs/1000), .getTime() is 1000× too small, the query window lands ≈1970,
    // and the panel shows "No Data" despite firing the query. Assert the Date's
    // getTime() is µs-magnitude for a 15-minute relative window: end-start must
    // be ~15min in MICROSECONDS (900_000_000 µs), not ms (900_000).
    (getDashboard as any).mockResolvedValue(processedDashboard());
    wrapper = factory();
    await flushPromises();

    const cto = wrapper
      .findComponent({ name: "RenderDashboardCharts" })
      .props("currentTimeObj");
    const spanUs = cto.__global.end_time.getTime() - cto.__global.start_time.getTime();
    // 15 minutes = 900 seconds. In µs that's 900_000_000. Allow slack for the
    // few ms of wall-clock drift during the async load.
    expect(spanUs).toBeGreaterThan(890_000_000);
    expect(spanUs).toBeLessThan(910_000_000);
  });

  it("recomputes __global when the selected range changes (Apply reloads panels)", async () => {
    // REGRESSION: the picker only emitted @hide on dropdown close, so clicking
    // Apply (which updates selectedDate's v-model) did not rebuild currentTimeObj
    // and panels never re-queried for the new range. A watcher on selectedDate
    // must recompute __global on any range change. Simulate switching from a 15m
    // relative window to a 1h one and assert the __global span grows accordingly.
    (getDashboard as any).mockResolvedValue(processedDashboard());
    wrapper = factory();
    await flushPromises();

    const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
    const before = render.props("currentTimeObj").__global;
    const beforeSpan = before.end_time.getTime() - before.start_time.getTime();
    expect(beforeSpan).toBeGreaterThan(890_000_000); // ~15m in µs

    // Change the range: the DateTimePickerDashboard's v-model is selectedDate.
    (wrapper.vm as any).selectedDate = {
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    };
    await flushPromises();

    const after = wrapper
      .findComponent({ name: "RenderDashboardCharts" })
      .props("currentTimeObj").__global;
    const afterSpan = after.end_time.getTime() - after.start_time.getTime();
    // 1 hour = 3600s → 3_600_000_000 µs. Must have grown from the 15m window.
    expect(afterSpan).toBeGreaterThan(3_500_000_000);
    expect(afterSpan).toBeLessThan(3_700_000_000);
  });
});
