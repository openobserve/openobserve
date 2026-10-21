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
import { flushPromises, shallowMount } from "@vue/test-utils";
import { inject, reactive } from "vue";
import { DASHBOARD_FRESH_ON_OPEN } from "@/composables/dashboard/dashboardFreshOnOpen";
import { AUTO_RUN_STORAGE_KEY, useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";

const MINUTE = 60 * 1_000_000;

const route = reactive<{ path: string; params: Record<string, any>; query: Record<string, any> }>({
  path: "/dashboards/view",
  params: {},
  query: {},
});
const routerReplace = vi.fn(async ({ query }: { query: Record<string, any> }) => {
  route.query = { ...query };
});

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    push: vi.fn().mockResolvedValue(undefined),
    replace: routerReplace,
    back: vi.fn(),
    options: { history: { state: { back: null } } },
  }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));

const mockState: Record<string, any> = reactive({
  selectedOrganization: { identifier: "test-org" },
  printMode: false,
  timezone: "UTC",
  organizationData: { folders: [{ folderId: "default", name: "Default" }], allDashboardData: {} },
  zoConfig: { min_auto_refresh_interval: 5, auto_query_enabled: false },
});

vi.mock("vuex", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  useStore: () => ({ state: mockState, commit: vi.fn(), dispatch: vi.fn() }),
}));

const dashboard = {
  dashboardId: "d1",
  title: "Dashboard",
  variables: { list: [] },
  tabs: [
    { tabId: "t1", name: "Tab 1", panels: [{ id: "P2", config: {} }] },
    { tabId: "t2", name: "Tab 2", panels: [] },
  ],
};

vi.mock("@/utils/commons.ts", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  getDashboard: vi.fn(async () => dashboard),
  getFoldersList: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/reports", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: vi.fn(),
    showErrorNotification: vi.fn(),
    showConfictErrorNotificationWithRefreshBtn: vi.fn(),
  }),
}));
vi.mock("@/composables/dashboard/useCancelQuery", () => ({
  default: () => ({
    traceIdRef: { value: null },
    searchRequestTraceIds: vi.fn(),
    cancelQuery: vi.fn(),
  }),
}));
vi.mock("moment-timezone", () => ({
  default: vi.fn(() => ({ tz: vi.fn().mockReturnThis(), format: vi.fn().mockReturnValue("") })),
}));

import ViewDashboard from "@/views/Dashboards/ViewDashboard.vue";
import i18n from "@/locales";

const relative = (period: string) => ({
  valueType: "relative",
  relativeTimePeriod: period,
  startTime: 1,
  endTime: 2,
});
const absolute = (startTime: number, endTime: number) => ({
  valueType: "absolute",
  relativeTimePeriod: null,
  startTime,
  endTime,
});

const pickerCalls = { setSavedDate: vi.fn() };

// Stands in for the real picker: it reports its starting range on mount, and any read of its live value fails.
const PickerStub = {
  name: "DateTimePickerDashboard",
  props: ["modelValue", "autoApplyDashboard", "disable", "initialTimezone"],
  emits: ["update:modelValue", "show", "hide", "timezone-change"],
  data: () => ({ zoomed: null as any }),
  mounted(this: any) {
    this.$emit("update:modelValue", { ...relative("15m"), ...this.modelValue });
  },
  methods: {
    getConsumableDateTime() {
      throw new Error("read the live picker instead of the applied range");
    },
    setCustomDate(this: any, _type: string, range: { start: Date; end: Date }) {
      this.zoomed = absolute(range.start.getTime() * 1000, range.end.getTime() * 1000);
    },
    refresh(this: any) {
      if (this.zoomed) this.$emit("update:modelValue", this.zoomed);
    },
    setSavedDate(value: any) {
      pickerCalls.setSavedDate(value);
    },
  },
  template: "<div data-test='picker-stub' />",
};

const RenderDashboardChartsStub = {
  name: "RenderDashboardCharts",
  props: ["currentTimeObj"],
  methods: {
    syncAllPanelDateTimePickers: vi.fn(),
    commitAllVariables: vi.fn(),
    getUrlParams: () => ({}),
  },
  template: "<div />",
};

describe("ViewDashboard time range gate", () => {
  let wrapper: any;
  let freshOnOpen: any;

  const setAutoRun = (state: "on" | "off" | "unavailable") => {
    mockState.zoConfig.auto_query_enabled = state !== "unavailable";
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, String(state === "on"));
    useAutoRunToggle().syncAutoRun();
  };

  const mountDashboard = async () => {
    wrapper = shallowMount(ViewDashboard, {
      global: {
        plugins: [i18n],
        renderStubDefaultSlot: true,
        stubs: {
          OPageLayout: {
            setup() {
              freshOnOpen = inject(DASHBOARD_FRESH_ON_OPEN, null);
            },
            template: '<div><slot name="actions" /><slot /></div>',
          },
          ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
          DateTimePickerDashboard: PickerStub,
          RenderDashboardCharts: RenderDashboardChartsStub,
        },
      },
    });
    await flushPromises();
    routerReplace.mockClear();
  };

  const picker = () => wrapper.findComponent({ name: "DateTimePickerDashboard" });
  const pick = async (value: any) => {
    picker().vm.$emit("update:modelValue", value);
    await flushPromises();
  };
  const refreshButton = () => wrapper.findComponent('[data-test="dashboard-refresh-btn"]');
  const refreshOptions = () => wrapper.findComponent('[data-test="dashboard-refresh-options-btn"]');
  const refreshTooltip = () =>
    wrapper
      .findAllComponents({ name: "OTooltip" })
      .find((tip) => tip.find('[data-test="dashboard-refresh-btn"]').exists())
      ?.props("content");
  const spanOf = (time: any) => time.end_time.getTime() - time.start_time.getTime();
  const globalSpan = () => spanOf(wrapper.vm.currentTimeObjPerPanel.__global);

  beforeEach(() => {
    route.query = { dashboard: "d1", folder: "default", tab: "t1", period: "15m" };
    mockState.printMode = false;
    pickerCalls.setSavedDate.mockClear();
    setAutoRun("off");
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.removeItem(AUTO_RUN_STORAGE_KEY);
  });

  it("shows the main picker without an Apply button", async () => {
    await mountDashboard();

    expect(picker().props("autoApplyDashboard")).toBe(true);
  });

  describe.each(["off", "unavailable"] as const)("Auto Run %s", (state) => {
    beforeEach(() => setAutoRun(state));

    it("keeps a picked range waiting: panels, URL and Share link stay on the applied range", async () => {
      await mountDashboard();
      const shareBefore = wrapper.vm.dashboardShareURL;

      await pick(relative("1h"));

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("15m");
      expect(picker().props("modelValue").relativeTimePeriod).toBe("1h");
      expect(globalSpan()).toBe(15 * MINUTE);
      expect(routerReplace).not.toHaveBeenCalled();
      expect(route.query.period).toBe("15m");
      expect(wrapper.vm.dashboardShareURL).toBe(shareBefore);
    });

    it("turns Refresh yellow with the time-range tooltip while a range waits", async () => {
      await mountDashboard();
      expect(refreshButton().props("variant")).toBe("primary");
      expect(refreshOptions().props("variant")).toBe("primary");
      expect(refreshButton().text()).toContain("Refresh");

      await pick(relative("1h"));

      expect(refreshButton().props("variant")).toBe("warning");
      expect(refreshOptions().props("variant")).toBe("warning");
      expect(refreshTooltip()).toBe("Refresh to apply the time range");
    });

    it("applies the waiting range on Refresh and only then updates the URL", async () => {
      await mountDashboard();
      await pick(relative("1h"));

      refreshButton().vm.$emit("click");
      await flushPromises();

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
      expect(globalSpan()).toBe(60 * MINUTE);
      expect(route.query.period).toBe("1h");
      expect(refreshButton().props("variant")).toBe("primary");
    });

    it("applies the waiting range on an auto-refresh tick", async () => {
      await mountDashboard();
      await pick(relative("1h"));

      wrapper.findComponent({ name: "AutoRefreshInterval" }).vm.$emit("trigger");
      await flushPromises();

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
    });

    it("clears the signal without a reload when the applied range is picked again", async () => {
      await mountDashboard();
      const appliedBefore = wrapper.vm.currentTimeObjPerPanel.__global;

      await pick(relative("1h"));
      await pick(relative("15m"));

      expect(refreshButton().props("variant")).toBe("primary");
      expect(wrapper.vm.currentTimeObjPerPanel.__global).toBe(appliedBefore);
      expect(routerReplace).not.toHaveBeenCalled();
    });

    it("never applies or signals a broken range", async () => {
      await mountDashboard();

      await pick(absolute(NaN, 200));
      expect(refreshButton().props("variant")).toBe("primary");

      await pick(absolute(300 * MINUTE, 200 * MINUTE));
      expect(refreshButton().props("variant")).toBe("primary");

      refreshButton().vm.$emit("click");
      await flushPromises();
      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("15m");
    });

    it("puts the picker back on the applied range when it closes on a broken range", async () => {
      await mountDashboard();
      picker().vm.$emit("show");
      await pick(absolute(300 * MINUTE, 200 * MINUTE));
      expect(pickerCalls.setSavedDate).not.toHaveBeenCalled();

      picker().vm.$emit("hide");
      await flushPromises();

      expect(pickerCalls.setSavedDate).toHaveBeenCalledWith({
        type: "relative",
        relativeTimePeriod: "15m",
      });
      expect(picker().props("modelValue").relativeTimePeriod).toBe("15m");
      expect(refreshButton().props("variant")).toBe("primary");
      expect(routerReplace).not.toHaveBeenCalled();
    });
  });

  it("keeps the yellow Refresh and applies a waiting range in layout edit mode", async () => {
    await mountDashboard();
    wrapper.vm.enterLayoutEdit();
    await flushPromises();
    expect(wrapper.vm.isEditingLayout).toBe(true);

    await pick(relative("1h"));
    expect(refreshButton().props("variant")).toBe("warning");

    refreshButton().vm.$emit("click");
    await flushPromises();

    expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
    expect(refreshButton().props("variant")).toBe("outline");
    expect(wrapper.vm.isEditingLayout).toBe(true);
  });

  it("names both the time range and variables when both wait", async () => {
    await mountDashboard();
    await wrapper.vm.onVariablesManagerReady({ hasUncommittedChanges: true });
    expect(refreshTooltip()).toBe("Refresh to apply latest variable changes");

    await pick(relative("1h"));

    expect(refreshButton().props("variant")).toBe("warning");
    expect(refreshTooltip()).toBe("Refresh to apply the time range and variable changes");
  });

  describe("everything that loads data reads the applied range", () => {
    it("a tab switch keeps every panel on the applied range", async () => {
      await mountDashboard();
      await pick(relative("1h"));

      route.query = { ...route.query, tab: "t2" };
      await flushPromises();

      expect(globalSpan()).toBe(15 * MINUTE);
    });

    it("a panel's own refresh reloads it on the applied range", async () => {
      await mountDashboard();
      await pick(relative("1h"));

      wrapper.vm.refreshPanelRequest("P2", false);

      expect(spanOf(wrapper.vm.currentTimeObjPerPanel.P2)).toBe(15 * MINUTE);
    });

    it("variables get the applied range when the picker closes", async () => {
      await mountDashboard();
      picker().vm.$emit("show");
      await pick(relative("1h"));

      picker().vm.$emit("hide");
      await flushPromises();

      expect(spanOf(wrapper.vm.currentTimeObjPerPanel.__variables)).toBe(15 * MINUTE);
    });

    it("the fresh-on-open gate follows the applied range type", async () => {
      route.query = { dashboard: "d1", folder: "default", tab: "t1", from: "1", to: "2" };
      await mountDashboard();

      await pick(relative("1h"));

      expect(freshOnOpen.isRelativeRange({ id: "P2", config: {} })).toBe(false);
    });
  });

  it("applies a chart zoom at once even while Auto Run is off", async () => {
    await mountDashboard();

    wrapper.vm.onDataZoom({ start: 1_700_000_000_000, end: 1_700_000_600_000 });
    await flushPromises();

    expect(wrapper.vm.selectedDate.valueType).toBe("absolute");
    expect(globalSpan()).toBe(10 * MINUTE);
    expect(refreshButton().props("variant")).toBe("primary");
  });

  it("shows the labelled Refresh with the plain refresh icon while Auto Run is off", async () => {
    await mountDashboard();

    expect(refreshButton().props("variant")).toBe("primary");
    expect(refreshButton().props("iconLeft")).toBe("refresh");
    expect(refreshButton().text()).toContain("Refresh");
  });

  describe("Auto Run on", () => {
    beforeEach(() => setAutoRun("on"));

    it("keeps the labelled Refresh primary and swaps in the Auto Run icon", async () => {
      await mountDashboard();

      expect(refreshButton().props("variant")).toBe("primary");
      expect(refreshOptions().props("variant")).toBe("primary");
      expect(refreshButton().props("iconLeft")).toBe("autorenew");
      expect(refreshButton().text()).toContain("Refresh");
    });

    it("applies a preset at once and updates the URL", async () => {
      await mountDashboard();

      await pick(relative("1h"));

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
      expect(globalSpan()).toBe(60 * MINUTE);
      expect(route.query.period).toBe("1h");
      expect(refreshButton().props("variant")).toBe("primary");
      expect(refreshTooltip()).toBe("Runs queries on open and on filter/time changes");
    });

    it("holds an absolute edit while the picker is open and applies it when it closes", async () => {
      await mountDashboard();
      const end = 1_700_000_000_000_000;

      picker().vm.$emit("show");
      await pick(absolute(end - 30 * MINUTE, end));
      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("15m");
      expect(refreshButton().props("variant")).toBe("primary");

      picker().vm.$emit("hide");
      await flushPromises();

      expect(wrapper.vm.selectedDate).toEqual(absolute(end - 30 * MINUTE, end));
      expect(route.query.from).toBe(end - 30 * MINUTE);
      expect(globalSpan()).toBe(30 * MINUTE);
    });

    it("applies a range that waited while Auto Run was off once it is turned on", async () => {
      setAutoRun("off");
      await mountDashboard();
      await pick(relative("1h"));

      wrapper.vm.toggleAutoRun();
      await flushPromises();

      expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("1h");
      expect(route.query.period).toBe("1h");
    });
  });

  it("shows a range another dashboard's URL applied in the picker instead of leaving it waiting", async () => {
    await mountDashboard();

    route.query = { ...route.query, period: "6h" };
    await wrapper.vm.loadDashboard();
    await flushPromises();

    expect(pickerCalls.setSavedDate).toHaveBeenCalledWith({
      type: "relative",
      relativeTimePeriod: "6h",
    });
    expect(wrapper.vm.selectedDate.relativeTimePeriod).toBe("6h");
    expect(refreshButton().props("variant")).toBe("primary");
  });

  it("leaves the picker alone when a reload keeps the same range", async () => {
    await mountDashboard();
    await pick(relative("1h"));

    await wrapper.vm.loadDashboard();
    await flushPromises();

    expect(pickerCalls.setSavedDate).not.toHaveBeenCalled();
    expect(refreshButton().props("variant")).toBe("warning");
  });
});
