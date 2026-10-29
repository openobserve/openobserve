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
import { reactive } from "vue";
import { AUTO_RUN_STORAGE_KEY, useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";

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
    afterEach: vi.fn(() => vi.fn()),
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

const dashboards: Record<string, any> = {};

vi.mock("@/utils/commons.ts", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  getDashboard: vi.fn(async (_store: any, id: string) => dashboards[id]),
  getFoldersList: vi.fn().mockResolvedValue([]),
  updateDashboard: vi.fn(),
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
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import i18n from "@/locales";
import { updateDashboard } from "@/utils/commons.ts";

const makeDashboard = (id: string, defaultRefreshInterval?: number) => ({
  dashboardId: id,
  title: "Dashboard",
  variables: { list: [] },
  tabs: [{ tabId: "t1", name: "Tab 1", panels: [] }],
  ...(defaultRefreshInterval === undefined ? {} : { defaultRefreshInterval }),
});

const PickerStub = {
  name: "DateTimePickerDashboard",
  props: ["modelValue", "autoApplyDashboard", "disable", "initialTimezone"],
  emits: ["update:modelValue", "show", "hide", "timezone-change"],
  methods: { refresh() {}, setCustomDate() {}, setSavedDate() {} },
  template: "<div />",
};

const RenderDashboardChartsStub = {
  name: "RenderDashboardCharts",
  methods: {
    syncAllPanelDateTimePickers: vi.fn(),
    commitAllVariables: vi.fn(),
    getUrlParams: () => ({}),
  },
  template: "<div />",
};

describe("ViewDashboard default auto refresh", () => {
  let wrapper: any;

  const setAutoRun = (on: boolean) => {
    mockState.zoConfig.auto_query_enabled = true;
    localStorage.setItem(AUTO_RUN_STORAGE_KEY, String(on));
    useAutoRunToggle().syncAutoRun();
  };

  const mountDashboard = async () => {
    wrapper = shallowMount(ViewDashboard, {
      global: {
        plugins: [i18n],
        renderStubDefaultSlot: true,
        stubs: {
          OPageLayout: { template: '<div><slot name="actions" /><slot /></div>' },
          ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
          AutoRefreshInterval: false,
          DateTimePickerDashboard: PickerStub,
          RenderDashboardCharts: RenderDashboardChartsStub,
        },
      },
    });
    await flushPromises();
  };

  const toolbarControl = () => wrapper.findComponent(AutoRefreshInterval);

  beforeEach(() => {
    route.query = { dashboard: "d1", folder: "default", tab: "t1", period: "15m" };
    mockState.zoConfig.min_auto_refresh_interval = 5;
    for (const key of Object.keys(dashboards)) delete dashboards[key];
    routerReplace.mockClear();
    vi.mocked(updateDashboard).mockClear();
    setAutoRun(false);
  });

  afterEach(() => {
    wrapper?.unmount();
    localStorage.removeItem(AUTO_RUN_STORAGE_KEY);
  });

  it("applies the saved default to the toolbar control and the URL when the link has no refresh", async () => {
    dashboards.d1 = makeDashboard("d1", 60);
    await mountDashboard();

    expect(wrapper.vm.refreshInterval).toBe(60);
    expect(toolbarControl().props("modelValue")).toBe(60);
    expect(toolbarControl().text()).toContain("1 min");
    expect(route.query.refresh).toBe("1m");
  });

  it("keeps refresh=Off from the URL over the saved default", async () => {
    dashboards.d1 = makeDashboard("d1", 60);
    route.query = { ...route.query, refresh: "Off" };
    await mountDashboard();

    expect(toolbarControl().props("modelValue")).toBe(0);
  });

  it("uses a URL refresh value over the saved default", async () => {
    dashboards.d1 = makeDashboard("d1", 60);
    route.query = { ...route.query, refresh: "5m" };
    await mountDashboard();

    expect(toolbarControl().props("modelValue")).toBe(300);
  });

  it("stays Off when neither the URL nor the dashboard sets an interval", async () => {
    dashboards.d1 = makeDashboard("d1");
    await mountDashboard();

    expect(toolbarControl().props("modelValue")).toBe(0);
  });

  it("raises a saved default below the server minimum to the minimum", async () => {
    mockState.zoConfig.min_auto_refresh_interval = 30;
    dashboards.d1 = makeDashboard("d1", 10);
    await mountDashboard();

    expect(toolbarControl().props("modelValue")).toBe(30);
  });

  it("applies the saved default with Auto Run on as well as off", async () => {
    setAutoRun(true);
    dashboards.d1 = makeDashboard("d1", 300);
    await mountDashboard();

    expect(toolbarControl().props("modelValue")).toBe(300);
  });

  it("treats a toolbar change as view-only: nothing is saved and a reload keeps it", async () => {
    dashboards.d1 = makeDashboard("d1", 60);
    await mountDashboard();

    toolbarControl().vm.$emit("update:modelValue", 0);
    await flushPromises();
    await wrapper.vm.loadDashboard();
    await flushPromises();

    expect(toolbarControl().props("modelValue")).toBe(0);
    expect(route.query.refresh).toBe("Off");
    expect(dashboards.d1.defaultRefreshInterval).toBe(60);
    expect(updateDashboard).not.toHaveBeenCalled();
  });

  it("applies the next dashboard's default when navigating to it without a refresh param", async () => {
    dashboards.d1 = makeDashboard("d1", 60);
    dashboards.d2 = makeDashboard("d2", 900);
    await mountDashboard();

    route.query = { dashboard: "d2", folder: "default", tab: "t1", period: "15m" };
    await flushPromises();

    expect(toolbarControl().props("modelValue")).toBe(900);
  });
});
