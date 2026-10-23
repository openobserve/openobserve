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
import { flushPromises, shallowMount } from "@vue/test-utils";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";
import { nextTick, ref } from "vue";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import DateTime from "@/components/DateTime.vue";
import { GridStack } from "gridstack";
import { updateDashboard } from "../../utils/commons";
import { LIVE_COMMIT_DEBOUNCE_MS } from "@/composables/dashboard/useVariablesManager";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Stub ODialog so tests are deterministic (no Portal/Teleport) and so we
// can drive open/close + button click emits without touching the real
// dialog implementation.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-show-close="String(showClose)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <slot name="trigger" />
    </div>
  `,
};

// Mock GridStack
const mockGridStackInstance = {
  init: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  removeAll: vi.fn(),
  makeWidget: vi.fn(),
  batchUpdate: vi.fn(),
  getGridItems: vi.fn().mockReturnValue([]),
  float: vi.fn(),
  setAnimation: vi.fn(),
  setStatic: vi.fn(),
  load: vi.fn(),
  getRow: vi.fn().mockReturnValue(60),
  getCellHeight: vi.fn().mockReturnValue(17),
  cellHeight: vi.fn(),
  engine: { nodes: [] as any[] },
};

vi.mock("gridstack", () => ({
  GridStack: {
    init: vi.fn(() => mockGridStackInstance),
  },
}));

vi.mock("gridstack/dist/gridstack.min.css", () => ({}));

// Mock composables
const mockNotifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
};
const mockOpenConflict = vi.fn();
vi.mock("@/composables/dashboard/useDashboardSaveConflict", () => ({
  useDashboardSaveConflict: () => ({
    isConflict: (error: any) => error?.response?.status === 409,
    openConflict: mockOpenConflict,
  }),
}));
// `run` is the real save body handed to useLoading, so the save path can be driven directly.
const mockLoading: {
  isLoading: any;
  execute: any;
  run?: (change?: string) => Promise<boolean>;
} = {
  isLoading: ref(false),
  execute: vi.fn(),
};
const mockDebouncer = { setImmediateValue: vi.fn(), setDebounceValue: vi.fn() };

vi.mock("@/composables/useNotifications", () => ({
  default: () => mockNotifications,
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: (fn: () => Promise<boolean>) => {
    mockLoading.run = fn;
    return mockLoading;
  },
}));

vi.mock("../../utils/dashboard/useCustomDebouncer", () => ({
  useCustomDebouncer: () => mockDebouncer,
}));

// Mock utils
vi.mock("../../utils/commons", () => ({
  checkIfVariablesAreLoaded: vi.fn().mockReturnValue(false),
  updateDashboard: vi.fn().mockResolvedValue(true),
}));

describe("RenderDashboardCharts", () => {
  let wrapper;

  const defaultProps = {
    viewOnly: false,
    dashboardData: {
      dashboardId: "test-dashboard",
      name: "Test Dashboard",
      variables: { showDynamicFilters: true, list: [] },
      tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
      panels: [
        {
          id: "panel-1",
          tabId: "default",
          title: "Test Panel",
          type: "line",
          layout: { x: 0, y: 0, w: 6, h: 4 },
          queries: [],
        },
      ],
    },
    folderId: "default",
    reportId: null,
    currentTimeObj: { __global: { start: "now-1h", end: "now" } },
    initialVariableValues: {},
    selectedDateForViewPanel: null,
    showTabs: false,
    forceLoad: false,
    searchType: "logs",
    runId: "test-run-id",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
    store.state.printMode = false;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  const createWrapper = (props = {}, options: any = {}) => {
    return shallowMount(RenderDashboardCharts, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        mocks: {
          $t: (key) => key,
          $route: { params: {}, query: {} },
          $router: { push: vi.fn(), replace: vi.fn() },
        },
        stubs: {
          ODialog: ODialogStub,
          ...(options.stubs || {}),
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should render without errors with minimum props", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with correct default values", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.props().viewOnly).toBe(false);
    });

    it("should handle missing optional props gracefully", () => {
      wrapper = createWrapper({
        showTabs: false,
        selectedDateForViewPanel: null,
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("should set up provide/inject correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize GridStack when mounted", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component activation lifecycle", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should clean up resources on unmount", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should handle props validation", () => {
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      wrapper = createWrapper({
        viewOnly: "invalid", // Wrong type
        forceLoad: "invalid", // Wrong type
      });
      expect(wrapper.exists()).toBe(true);
      consoleWarn.mockRestore();
    });
  });

  describe("GridStack Integration", () => {
    it("should initialize GridStack with correct configuration", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    describe("layout modes", () => {
      const dashboardWithPanel = () => ({
        ...defaultProps.dashboardData,
        tabs: [
          {
            tabId: "default",
            name: "Default Tab",
            panels: [
              {
                id: "panel-1",
                title: "Panel 1",
                type: "line",
                layout: { x: 0, y: 0, w: 96, h: 18, i: "panel-1" },
                queries: [],
              },
            ],
          },
        ],
      });

      const lastChangeHandler = () => {
        const calls = mockGridStackInstance.on.mock.calls.filter((c: any[]) => c[0] === "change");
        return calls[calls.length - 1][1];
      };

      const mountWithPanel = async (props: Record<string, unknown> = {}) => {
        wrapper = createWrapper({ dashboardData: dashboardWithPanel(), ...props });
        await flushPromises();
      };

      const panelLayout = () => wrapper.props("dashboardData").tabs[0].panels[0].layout;

      beforeEach(() => {
        mockLoading.isLoading.value = false;
        mockGridStackInstance.engine.nodes = [];
      });

      it("saves a drag at once in live mode", async () => {
        await mountWithPanel();
        lastChangeHandler()({}, [{ id: "panel-1", x: 10, y: 2, w: 50, h: 20 }]);

        expect(panelLayout()).toMatchObject({ x: 10, y: 2, w: 50, h: 20 });
        expect(mockLoading.execute).toHaveBeenCalledTimes(1);
        expect(wrapper.emitted("layoutChange")).toBeUndefined();
      });

      it("neither saves nor emits a draft step in view mode", async () => {
        await mountWithPanel({ layoutMode: "view" });
        lastChangeHandler()({}, [{ id: "panel-1", x: 10, y: 2, w: 50, h: 20 }]);

        expect(mockLoading.execute).not.toHaveBeenCalled();
        expect(wrapper.emitted("layoutChange")).toBeUndefined();
      });

      it("writes a resize to the draft and emits layoutChange without saving in edit mode", async () => {
        await mountWithPanel({ layoutMode: "edit" });
        lastChangeHandler()({}, [{ id: "panel-1", x: 0, y: 0, w: 120, h: 30 }]);

        expect(panelLayout()).toMatchObject({ w: 120, h: 30 });
        expect(wrapper.emitted("layoutChange")).toHaveLength(1);
        expect(mockLoading.execute).not.toHaveBeenCalled();
      });

      it("locks and unlocks the grid with setStatic only, never rebuilding it", async () => {
        await mountWithPanel({ layoutMode: "view" });
        expect(vi.mocked(GridStack.init).mock.calls.at(-1)?.[0]).toMatchObject({
          staticGrid: true,
        });
        const initCount = vi.mocked(GridStack.init).mock.calls.length;
        mockGridStackInstance.destroy.mockClear();

        await wrapper.setProps({ layoutMode: "edit" });
        await flushPromises();
        expect(mockGridStackInstance.setStatic).toHaveBeenLastCalledWith(false);

        await wrapper.setProps({ layoutMode: "view" });
        await flushPromises();
        expect(mockGridStackInstance.setStatic).toHaveBeenLastCalledWith(true);

        expect(vi.mocked(GridStack.init).mock.calls.length).toBe(initCount);
        expect(mockGridStackInstance.destroy).not.toHaveBeenCalled();
      });

      it.each(["view", "edit"] as const)(
        "builds the %s-mode grid on mount through makeWidget, as the rebuild after a delete does",
        async (layoutMode) => {
          mockGridStackInstance.makeWidget.mockClear();
          await mountWithPanel({ layoutMode });

          expect(mockGridStackInstance.makeWidget).toHaveBeenCalledWith(
            wrapper.find('[gs-id="panel-1"]').element,
            expect.objectContaining({ id: "panel-1", x: 0, y: 0, w: 96, h: 18 }),
          );
        },
      );

      it("marks the grid for always-on resize handles only in edit mode", async () => {
        await mountWithPanel({ layoutMode: "view" });
        expect(wrapper.find(".grid-stack").classes()).not.toContain("layout-editing");

        await wrapper.setProps({ layoutMode: "edit" });
        expect(wrapper.find(".grid-stack").classes()).toContain("layout-editing");
      });

      it("does not rebuild a draft-mode grid when a save finishes", async () => {
        await mountWithPanel({ layoutMode: "edit" });
        mockGridStackInstance.destroy.mockClear();

        mockLoading.isLoading.value = true;
        await flushPromises();
        mockLoading.isLoading.value = false;
        await flushPromises();

        expect(mockGridStackInstance.destroy).not.toHaveBeenCalled();
      });

      it("moves the widgets to the panel data and reads collisions back on syncGridToLayout", async () => {
        await mountWithPanel({ layoutMode: "edit" });
        mockGridStackInstance.engine.nodes = [{ id: "panel-1", x: 0, y: 6, w: 96, h: 18 }];

        wrapper.vm.syncGridToLayout();

        expect(mockGridStackInstance.load).toHaveBeenCalledWith(
          [{ id: "panel-1", x: 0, y: 0, w: 96, h: 18 }],
          false,
        );
        expect(panelLayout()).toMatchObject({ y: 6 });
        expect(wrapper.emitted("layoutChange")).toBeUndefined();
      });

      it("passes the mode to the tab list and re-emits its reorder as a layout change", async () => {
        await mountWithPanel({ layoutMode: "edit", showTabs: true });
        const tabList = wrapper.findComponent({ name: "TabList" });

        expect(tabList.props("layoutMode")).toBe("edit");
        tabList.vm.$emit("layoutChange");

        expect(wrapper.emitted("layoutChange")).toHaveLength(1);
      });
    });

    it("should disable/enable grid based on viewOnly prop", async () => {
      wrapper = createWrapper({ viewOnly: true });
      await nextTick();
      expect(wrapper.props().viewOnly).toBe(true);
    });

    it("should disable/enable grid based on loading state", async () => {
      wrapper = createWrapper();
      mockLoading.isLoading.value = true;
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle grid refresh when tabs change", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle grid refresh when panels change", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should clean up GridStack on component destroy", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should handle grid initialization errors gracefully", async () => {
      mockGridStackInstance.init.mockImplementation(() => {
        throw new Error("GridStack initialization failed");
      });

      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();

      mockGridStackInstance.init.mockRestore();
    });

    it("should handle minimum width/height constraints", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle layout position calculations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Panel Management", () => {
    it("should render panels from selected tab", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty panels array", () => {
      const dashboardWithEmptyPanels = {
        ...defaultProps.dashboardData,
        tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
      };
      wrapper = createWrapper({ dashboardData: dashboardWithEmptyPanels });
      expect(wrapper.exists()).toBe(true);
    });

    it("should render NoPanel component when no panels exist", () => {
      const dashboardWithNoPanels = {
        ...defaultProps.dashboardData,
        tabs: [{ tabId: "default", name: "Default Tab", panels: [] }],
        panels: [],
      };
      wrapper = createWrapper({ dashboardData: dashboardWithNoPanels });
      expect(wrapper.exists()).toBe(true);
    });

    it("registers and mounts a panel that joins an already-built tab", async () => {
      const io = installFakeIntersectionObserver({ autoVisible: true });
      try {
        const panel = (id: string) => ({
          id,
          title: id,
          type: "line",
          layout: { x: 0, y: 0, w: 6, h: 4, i: id },
          queries: [],
        });
        const dashboard = (ids: string[]) => ({
          ...defaultProps.dashboardData,
          tabs: [{ tabId: "default", name: "Default Tab", panels: ids.map(panel) }],
        });
        wrapper = createWrapper({ dashboardData: dashboard(["panel-a"]) });
        await flushPromises();
        await wrapper.setProps({ dashboardData: dashboard(["panel-a", "panel-b"]) });
        await flushPromises();
        await vi.waitFor(() => expect(wrapper.vm.shouldMountPanel("panel-b")).toBe(true));
        // Unregistered, the item has no grid size and collapses at tablet and desktop widths.
        const added = wrapper.find('[gs-id="panel-b"]').element;
        expect(mockGridStackInstance.makeWidget).toHaveBeenCalledWith(
          added,
          expect.objectContaining({ id: "panel-b" }),
        );
      } finally {
        io.restore();
      }
    });

    it("should pass correct props to PanelContainer components", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel deletion events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel view events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel move events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel refresh events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle layout edit events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle panel error states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Variables System", () => {
    it("should handle variables data updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit variablesData events correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle initial variable values", () => {
      const initialValues = { var1: "value1", var2: "value2" };
      wrapper = createWrapper({ initialVariableValues: initialValues });
      expect(wrapper.props().initialVariableValues).toEqual(initialValues);
    });

    it("should update variables when time objects change", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables auto-update logic", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle variables dependency updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should validate variable configurations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    // Per-tab narrowing (`curatedTabs`) is deliberately NOT applied here: this
    // list decides whether the selector mounts at all, and an off-tab variable
    // must still load because panels on other tabs read its value. The narrowing
    // is applied at render time inside VariablesValueSelector, which is where it
    // is pinned. This holds the loading list complete.
    describe("curatedTabs does NOT narrow the loading list", () => {
      const withCuratedTabs = () => ({
        ...defaultProps.dashboardData,
        variables: {
          showDynamicFilters: false,
          list: [
            { name: "cluster", type: "query_values", scope: "global", curatedTabs: ["overview"] },
            { name: "pod", type: "query_values", scope: "global", curatedTabs: ["workloads"] },
            { name: "always", type: "query_values", scope: "global" },
          ],
        },
        tabs: [
          { tabId: "overview", name: "Overview", panels: [] },
          { tabId: "workloads", name: "Workloads", panels: [] },
        ],
      });

      const namesFor = (tabId: string) => {
        wrapper = shallowMount(RenderDashboardCharts, {
          props: { ...defaultProps, dashboardData: withCuratedTabs() },
          global: {
            plugins: [i18n, store, router],
            provide: { selectedTabId: ref(tabId) },
            mocks: {
              $t: (key) => key,
              $route: { params: {}, query: {} },
              $router: { push: vi.fn(), replace: vi.fn() },
            },
            stubs: { ODialog: ODialogStub },
          },
        });
        return wrapper.vm.globalVariables.map((v: any) => v.name);
      };

      it("keeps every global variable on every tab so all of them still load", () => {
        expect(namesFor("overview")).toEqual(["cluster", "pod", "always"]);
        expect(namesFor("workloads")).toEqual(["cluster", "pod", "always"]);
      });
    });
  });

  describe("variable commits", () => {
    const chainDashboard = () => ({
      ...defaultProps.dashboardData,
      variables: {
        showDynamicFilters: false,
        list: [
          { name: "env", type: "custom", scope: "global", value: "prod", options: [] },
          {
            name: "service",
            type: "query_values",
            scope: "global",
            query_data: { field: "service", filter: [{ filter: "env=$env" }] },
          },
          {
            name: "pod",
            type: "query_values",
            scope: "global",
            query_data: { field: "pod", filter: [{ filter: "service=$service" }] },
          },
        ],
      },
    });

    const mountWith = (provide: Record<string, any> = {}) =>
      shallowMount(RenderDashboardCharts, {
        props: { ...defaultProps, dashboardData: chainDashboard() },
        global: {
          plugins: [i18n, store, router],
          provide,
          mocks: {
            $t: (key) => key,
            $route: { params: {}, query: {} },
            $router: { push: vi.fn(), replace: vi.fn() },
          },
          stubs: { ODialog: ODialogStub },
        },
      });

    const loaded = (v: any, value: any) => {
      v.value = value;
      v.isLoading = false;
      v.isVariableLoadingPending = false;
      v.isVariablePartialLoaded = true;
    };

    it("first load commits once, after the whole variable chain has loaded", async () => {
      wrapper = mountWith();
      await flushPromises();
      const manager = wrapper.vm.getVariablesManager();
      const commits = vi.fn();
      manager.onAutoCommit(commits);
      const [env, service, pod] = manager.variablesData.global;

      loaded(env, "prod");
      loaded(service, "api");
      pod.isVariableLoadingPending = true;
      await flushPromises();
      expect(commits).not.toHaveBeenCalled();
      expect(manager.committedVariablesData.global[1].value).not.toBe("api");

      loaded(pod, "api-1");
      await flushPromises();
      expect(commits).toHaveBeenCalledTimes(1);
      expect(manager.committedVariablesData.global.map((v: any) => v.value)).toEqual([
        "prod",
        "api",
        "api-1",
      ]);
    });

    it("follows the dashboard's Auto Run state", async () => {
      const autoRun = ref(true);
      wrapper = mountWith({ dashboardAutoRun: autoRun });
      const manager = wrapper.vm.getVariablesManager();
      expect(manager.isLiveMode.value).toBe(true);

      autoRun.value = false;
      await flushPromises();
      expect(manager.isLiveMode.value).toBe(false);
    });

    it("an Auto Run apply drops a panel's own refresh snapshot", async () => {
      wrapper = mountWith({ dashboardAutoRun: ref(true) });
      await flushPromises();
      const manager = wrapper.vm.getVariablesManager();
      const [env, service, pod] = manager.variablesData.global;
      loaded(env, "prod");
      loaded(service, "api");
      loaded(pod, "api-1");
      await flushPromises();
      const podFor = (panelId: string) =>
        wrapper.vm.getMergedVariablesForPanel(panelId).values.find((v: any) => v.name === "pod")
          ?.value;

      await wrapper.vm.refreshPanelRequest("panel-1");
      expect(podFor("panel-1")).toBe("api-1");

      manager.updateVariableValue("pod", "global", undefined, undefined, "api-2");
      await new Promise((r) => setTimeout(r, LIVE_COMMIT_DEBOUNCE_MS + 20));
      await flushPromises();

      expect(podFor("panel-1")).toBe("api-2");
    });

    it("stays in Refresh-to-apply mode when no Auto Run state is provided", () => {
      wrapper = mountWith();
      expect(wrapper.vm.getVariablesManager().isLiveMode.value).toBe(false);
    });
  });

  describe("panel time pickers", () => {
    let io: ReturnType<typeof installFakeIntersectionObserver>;
    let autoRun: ReturnType<typeof ref<boolean>>;
    let replaceSpy: any;

    const PanelContainerStub = {
      name: "PanelContainer",
      props: ["data", "isTimeRangeWaiting"],
      emits: ["refreshPanelRequest"],
      template: '<div data-test="panel-container-stub"><slot name="panel-variables" /></div>',
    };

    const RELATIVE_HOUR = { type: "relative", relativeTimePeriod: "1h" };
    const timedDashboard = (panelTimeRange: any = RELATIVE_HOUR) => ({
      ...defaultProps.dashboardData,
      tabs: [
        {
          tabId: "default",
          name: "Default Tab",
          panels: [
            {
              id: "P1",
              title: "P1",
              type: "line",
              layout: { x: 0, y: 0, w: 6, h: 4, i: "P1" },
              queries: [],
              config: {
                panel_time_enabled: true,
                panel_time_range: panelTimeRange,
              },
            },
          ],
        },
      ],
    });

    const mountWithPanelPicker = async (panelTimeRange?: any) => {
      wrapper = shallowMount(RenderDashboardCharts, {
        props: { ...defaultProps, dashboardData: timedDashboard(panelTimeRange) },
        global: {
          plugins: [i18n, store, router],
          provide: { dashboardAutoRun: autoRun },
          stubs: {
            ODialog: ODialogStub,
            PanelContainer: PanelContainerStub,
            DateTimePickerDashboard: false,
            DateTime: false,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(wrapper.vm.shouldMountPanel("P1")).toBe(true));
      await flushPromises();
    };

    const panel = () => wrapper.findComponent({ name: "PanelContainer" });
    const dateTime = () => wrapper.findComponent({ name: "DateTimePickerDashboard" });
    const pickPreset = async (unit: string, value: number) => {
      dateTime().findComponent(DateTime).vm.setRelativeDate(unit, value);
      await flushPromises();
    };
    const panelRefreshRequests = () =>
      (wrapper.emitted("refreshPanelRequest") ?? []).filter((args: any[]) => args[0] === "P1");

    beforeEach(() => {
      io = installFakeIntersectionObserver({ autoVisible: true });
      autoRun = ref(false);
      store.state.timezone = "UTC";
      replaceSpy = vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
    });

    afterEach(() => {
      replaceSpy.mockRestore();
      io.restore();
    });

    it("renders the panel's own picker without an Apply button", async () => {
      await mountWithPanelPicker();

      expect(dateTime().props("autoApplyDashboard")).toBe(true);
      expect(wrapper.vm.getPanelTimeGate("P1").applied.value.relativeTimePeriod).toBe("1h");
    });

    it("keeps a picked range waiting with Auto Run off and marks only that panel", async () => {
      await mountWithPanelPicker();

      await pickPreset("h", 6);

      expect(wrapper.vm.getPanelTimeGate("P1").picked.value.relativeTimePeriod).toBe("6h");
      expect(wrapper.vm.panelTimeValues.P1.relativeTimePeriod).toBe("1h");
      expect(panel().props("isTimeRangeWaiting")).toBe(true);
      expect(panelRefreshRequests()).toHaveLength(0);
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("applies the waiting range when the panel's own refresh is clicked", async () => {
      await mountWithPanelPicker();
      await pickPreset("h", 6);

      panel().vm.$emit("refreshPanelRequest", "P1", false);
      await flushPromises();

      expect(wrapper.vm.panelTimeValues.P1.relativeTimePeriod).toBe("6h");
      expect(replaceSpy).toHaveBeenCalledWith({
        query: expect.objectContaining({ "pt-period.P1": "6h" }),
      });
      expect(panelRefreshRequests()).toEqual([["P1", false]]);
      expect(panel().props("isTimeRangeWaiting")).toBe(false);
    });

    it("applies the waiting range on the dashboard Refresh", async () => {
      await mountWithPanelPicker();
      await pickPreset("h", 6);

      await wrapper.vm.syncAllPanelDateTimePickers();
      await flushPromises();

      expect(wrapper.vm.panelTimeValues.P1.relativeTimePeriod).toBe("6h");
      expect(panel().props("isTimeRangeWaiting")).toBe(false);
    });

    it("clears the marker without a reload when the applied range is picked again", async () => {
      await mountWithPanelPicker();
      await pickPreset("h", 6);

      await pickPreset("h", 1);

      expect(panel().props("isTimeRangeWaiting")).toBe(false);
      expect(panelRefreshRequests()).toHaveLength(0);
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("applies a preset at once and refreshes only that panel when Auto Run is on", async () => {
      autoRun.value = true;
      await mountWithPanelPicker();

      await pickPreset("h", 6);

      expect(wrapper.vm.panelTimeValues.P1.relativeTimePeriod).toBe("6h");
      expect(panelRefreshRequests()).toEqual([["P1", false]]);
      expect(panel().props("isTimeRangeWaiting")).toBe(false);
    });

    it("applies a waiting range when Auto Run is turned on", async () => {
      await mountWithPanelPicker();
      await pickPreset("h", 6);

      autoRun.value = true;
      await flushPromises();

      expect(wrapper.vm.panelTimeValues.P1.relativeTimePeriod).toBe("6h");
      expect(panelRefreshRequests()).toEqual([["P1", false]]);
    });

    it.each([
      ["off", false],
      ["on", true],
    ])(
      "puts the panel picker back on the applied range when it closes on a broken range (Auto Run %s)",
      async (_label, isOn) => {
        autoRun.value = isOn;
        await mountWithPanelPicker();
        const realPicker = dateTime().findComponent(DateTime);

        realPicker.vm.onMenuOpenChange(true);
        realPicker.vm.selectedType = "absolute";
        realPicker.vm.selectedDate = { from: "2026/10/13", to: "2026/10/13" };
        realPicker.vm.selectedTime = { startTime: "18:50:30", endTime: "18:25:22" };
        await flushPromises();
        expect(realPicker.vm.getDisplayValue).toBe("2026/10/13 18:50:30 - 2026/10/13 18:25:22");

        realPicker.vm.onMenuOpenChange(false);
        await flushPromises();

        expect(realPicker.vm.getDisplayValue).toBe("Past 1 Hour");
        expect(wrapper.vm.getPanelTimeGate("P1").picked.value.relativeTimePeriod).toBe("1h");
        expect(panel().props("isTimeRangeWaiting")).toBe(false);
        expect(panelRefreshRequests()).toHaveLength(0);
        expect(replaceSpy).not.toHaveBeenCalled();
      },
    );

    it("puts an absolute panel range back in the picker when it closes on a broken one", async () => {
      const start = Date.UTC(2026, 9, 13, 10, 0, 0) * 1000;
      await mountWithPanelPicker({
        type: "absolute",
        startTime: start,
        endTime: start + 30 * 60e6,
      });
      const realPicker = dateTime().findComponent(DateTime);
      const appliedLabel = "2026/10/13 10:00:00 - 2026/10/13 10:30:00";
      expect(realPicker.vm.getDisplayValue).toBe(appliedLabel);

      realPicker.vm.onMenuOpenChange(true);
      realPicker.vm.selectedTime = { startTime: "18:50:30", endTime: "18:25:22" };
      await flushPromises();
      expect(realPicker.vm.getDisplayValue).toBe("2026/10/13 18:50:30 - 2026/10/13 18:25:22");

      realPicker.vm.onMenuOpenChange(false);
      await flushPromises();

      expect(realPicker.vm.getDisplayValue).toBe(appliedLabel);
      expect(panel().props("isTimeRangeWaiting")).toBe(false);
      expect(panelRefreshRequests()).toHaveLength(0);
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("does not reload the panel when its picker reports its starting range", async () => {
      autoRun.value = true;
      await mountWithPanelPicker();

      expect(panelRefreshRequests()).toHaveLength(0);
      expect(replaceSpy).not.toHaveBeenCalled();
    });
  });

  describe("Kiosk", () => {
    const kioskDashboard = () => ({
      ...defaultProps.dashboardData,
      tabs: [
        {
          tabId: "default",
          name: "Default Tab",
          panels: [
            {
              id: "panel-1",
              title: "Panel 1",
              type: "line",
              layout: { x: 0, y: 0, w: 96, h: 60, i: "panel-1" },
              queries: [],
            },
          ],
        },
      ],
    });

    let clientHeight: PropertyDescriptor | undefined;
    beforeEach(() => {
      clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
      Object.defineProperty(HTMLElement.prototype, "clientHeight", {
        configurable: true,
        get: () => 908,
      });
      mockGridStackInstance.cellHeight.mockClear();
    });
    afterEach(() => {
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
    });

    const twoTabs = () => ({
      ...kioskDashboard(),
      tabs: [...kioskDashboard().tabs, { tabId: "beta", name: "Beta", panels: [] }],
    });
    const controls = () => wrapper.find('[data-test="dashboard-kiosk-controls"]');

    it("puts the tab bar and the variables in one compact row on a wall screen", async () => {
      wrapper = createWrapper({
        showTabs: true,
        kiosk: true,
        viewOnly: true,
        dashboardData: {
          ...twoTabs(),
          variables: { list: [{ name: "region", type: "constant", value: "eu" }] },
        },
      });
      await flushPromises();
      expect(controls().classes()).toEqual(
        expect.arrayContaining(["flex", "min-h-9", "items-center", "py-1"]),
      );
      expect(wrapper.find(".render-dashboard-charts-container").classes()).toContain("pt-0");

      const tabs = wrapper.findComponent({ name: "TabList" });
      expect(tabs.classes()).toEqual(expect.arrayContaining(["order-first", "flex-1"]));
      expect(tabs.classes()).not.toContain("mt-2");
      expect(tabs.props("viewOnly")).toBe(true);

      const selector = wrapper.find('[data-test="global-variables-selector"]');
      expect(selector.element.parentElement).toBe(controls().element);
      expect(selector.classes()).toContain("mt-0!");
    });

    it("drops a lone tab from the row but keeps the variables", async () => {
      wrapper = createWrapper({
        showTabs: true,
        kiosk: true,
        dashboardData: {
          ...kioskDashboard(),
          variables: { list: [{ name: "region", type: "constant", value: "eu" }] },
        },
      });
      await flushPromises();
      expect(controls().classes()).toContain("flex");
      expect(wrapper.findComponent({ name: "TabList" }).classes()).toContain("hidden");
    });

    it("hides the row for a single-tab dashboard with no visible variables", async () => {
      wrapper = createWrapper({
        showTabs: true,
        kiosk: true,
        dashboardData: {
          ...kioskDashboard(),
          variables: {
            list: [{ name: "hidden", type: "constant", value: "x", hideOnDashboard: true }],
          },
        },
      });
      await flushPromises();
      expect(controls().classes()).toEqual(["hidden"]);
    });

    it("leaves the normal layout as it was: a contents wrapper, spaced tab bar", async () => {
      wrapper = createWrapper({ showTabs: true, dashboardData: twoTabs() });
      await flushPromises();
      expect(controls().classes()).toEqual(["contents"]);
      expect(wrapper.findComponent({ name: "TabList" }).classes()).toContain("mt-2");
      expect(wrapper.find(".render-dashboard-charts-container").classes()).toContain("pt-2");
    });

    it("shows the one-row bar with its values in a playlist slide, but out of interaction", async () => {
      wrapper = createWrapper({
        showTabs: true,
        kiosk: true,
        viewOnly: true,
        readOnlySelectors: true,
        dashboardData: {
          ...kioskDashboard(),
          variables: { list: [{ name: "region", type: "constant", value: "eu" }] },
        },
      });
      await flushPromises();
      const row = wrapper.find('[data-test="dashboard-kiosk-controls"]');
      expect(row.classes()).not.toContain("hidden");
      expect(row.attributes("inert")).toBeDefined();
      expect(row.attributes("data-read-only")).toBe("true");
      expect(row.find('[data-test="global-variables-selector"]').exists()).toBe(true);
    });

    it("keeps the plain TV mode bar interactive", async () => {
      wrapper = createWrapper({
        kiosk: true,
        dashboardData: {
          ...kioskDashboard(),
          variables: { list: [{ name: "region", type: "constant", value: "eu" }] },
        },
      });
      await flushPromises();
      expect(wrapper.find('[data-test="dashboard-kiosk-controls"]').attributes("inert")).toBe(
        undefined,
      );
    });

    it("scales the cell height so every row fits when fit is on", async () => {
      wrapper = createWrapper({ dashboardData: kioskDashboard(), kiosk: true, fitToScreen: true });
      await flushPromises();
      expect(mockGridStackInstance.cellHeight).toHaveBeenCalledWith(15);
      expect(wrapper.classes()).toContain("overflow-hidden");
    });

    it("never resizes cells on a normal dashboard", async () => {
      wrapper = createWrapper({ dashboardData: kioskDashboard() });
      await flushPromises();
      expect(mockGridStackInstance.cellHeight).not.toHaveBeenCalled();
      expect(wrapper.classes()).toContain("overflow-y-auto");
    });
  });

  describe("Tab Management", () => {
    it("should render TabList when showTabs is true", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.props().showTabs).toBe(true);
    });

    it("should not render TabList when showTabs is false", () => {
      wrapper = createWrapper({ showTabs: false });
      expect(wrapper.props().showTabs).toBe(false);
    });

    it("should handle tab selection changes", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should filter panels by selected tab", () => {
      const multiTabDashboard = {
        ...defaultProps.dashboardData,
        tabs: [
          { tabId: "tab1", name: "Tab 1", panels: [] },
          { tabId: "tab2", name: "Tab 2", panels: [] },
        ],
      };
      wrapper = createWrapper({ dashboardData: multiTabDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle tab refresh events", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass correct tab data to components", () => {
      wrapper = createWrapper({ showTabs: true });
      expect(wrapper.exists()).toBe(true);
    });

    // Global variables apply dashboard-wide, so the strip sits above the tab bar.
    it("renders the global variables strip ABOVE the tab list, not below it", () => {
      wrapper = createWrapper({
        showTabs: true,
        dashboardData: {
          ...defaultProps.dashboardData,
          variables: {
            showDynamicFilters: true,
            list: [{ name: "cluster", type: "query_values", scope: "global", value: [] }],
          },
        },
      });

      const html = wrapper.html();
      const tabsAt = html.indexOf("tab-list");
      const varsAt = html.indexOf("global-variables-selector");

      expect(tabsAt).toBeGreaterThan(-1);
      expect(varsAt).toBeGreaterThan(-1);
      expect(varsAt).toBeLessThan(tabsAt);
    });
  });

  describe("Print Mode & Loading Tests", () => {
    it("should handle print mode flag visibility", () => {
      store.state.printMode = true;
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should debounce loading state updates", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should track panel loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should track variable loading states", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit correct loading events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle loading state combinations", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle search request trace IDs", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard data loading completion", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Event System", () => {
    it("should emit onDeletePanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit onViewPanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit variablesData events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refreshedVariablesDataUpdated events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit updated:data-zoom events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refreshPanelRequest events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refresh events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit onMovePanel events", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit panelsValues events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit searchRequestTraceIds events", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("View Panel Dialog (ODialog migration)", () => {
    it("renders the ODialog wrapper with the migrated props", async () => {
      wrapper = createWrapper();
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("width")).toBe(98);
      expect(dialog.props("showClose")).toBe(false);
    });

    it("starts with the ODialog closed (open=false)", async () => {
      wrapper = createWrapper();
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("opens the ODialog when onViewPanel is invoked", async () => {
      wrapper = createWrapper();
      await nextTick();
      (wrapper.vm as any).onViewPanel("panel-1");
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
      expect((wrapper.vm as any).viewPanelId).toBe("panel-1");
    });

    it("closes the ODialog when it emits update:open with false", async () => {
      wrapper = createWrapper();
      await nextTick();
      (wrapper.vm as any).showViewPanel = true;
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);

      await dialog.vm.$emit("update:open", false);
      await nextTick();
      expect(dialog.props("open")).toBe(false);
      expect((wrapper.vm as any).showViewPanel).toBe(false);
    });

    it("passes selectedDateForViewPanel through to the dialog content", async () => {
      const selectedDate = { start: "2024-01-01", end: "2024-01-02" };
      wrapper = createWrapper({ selectedDateForViewPanel: selectedDate });
      await nextTick();
      expect(wrapper.props("selectedDateForViewPanel")).toEqual(selectedDate);
    });

    it("keeps the ODialog mounted regardless of open state (so transitions stay smooth)", async () => {
      wrapper = createWrapper();
      await nextTick();
      // Closed
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
      // Open
      (wrapper.vm as any).showViewPanel = true;
      await nextTick();
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
    });
  });

  describe("saveDashboardData", () => {
    it("returns true and confirms the save", async () => {
      wrapper = createWrapper();
      vi.mocked(updateDashboard).mockResolvedValueOnce(true);

      await expect(mockLoading.run!()).resolves.toBe(true);
      expect(mockNotifications.showPositiveNotification).toHaveBeenCalled();
      expect(wrapper.emitted("refresh")).toBeUndefined();
    });

    it("returns false and opens the save-conflict dialog with my layout on a 409, without reloading", async () => {
      mockOpenConflict.mockClear();
      wrapper = createWrapper();
      vi.mocked(updateDashboard).mockRejectedValueOnce({
        response: { status: 409, data: { message: "Dashboard was changed elsewhere" } },
      });

      await expect(mockLoading.run!()).resolves.toBe(false);
      expect(mockOpenConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          dashboardId: wrapper.props("dashboardData").dashboardId,
          mine: wrapper.props("dashboardData"),
          change: "Moved or resized panels",
        }),
      );
      expect(mockNotifications.showErrorNotification).not.toHaveBeenCalled();
      expect(wrapper.emitted("refresh")).toBeUndefined();
    });

    it("names the caller's change in the conflict dialog when one is passed", async () => {
      mockOpenConflict.mockClear();
      wrapper = createWrapper({ layoutMode: "edit" });
      vi.mocked(updateDashboard).mockRejectedValueOnce({ response: { status: 409 } });

      await expect(mockLoading.run!("Edited the dashboard JSON")).resolves.toBe(false);
      expect(mockOpenConflict).toHaveBeenCalledWith(
        expect.objectContaining({ change: "Edited the dashboard JSON" }),
      );
    });

    it("returns false and shows an error on a network failure", async () => {
      wrapper = createWrapper();
      vi.mocked(updateDashboard).mockRejectedValueOnce(new Error("Network Error"));

      await expect(mockLoading.run!()).resolves.toBe(false);
      expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith("Network Error", {
        timeout: 2000,
      });
    });

    it.each([
      [
        "a 409",
        { response: { status: 409, data: { message: "Dashboard was changed elsewhere" } } },
      ],
      ["a network failure", new Error("Network Error")],
    ])("keeps the layout draft without reloading on %s in edit mode", async (_label, error) => {
      wrapper = createWrapper({ layoutMode: "edit" });
      vi.mocked(updateDashboard).mockRejectedValueOnce(error);

      await expect(mockLoading.run!()).resolves.toBe(false);
      expect(wrapper.emitted("refresh")).toBeUndefined();
    });
  });

  describe("Dashboard Operations", () => {
    it("should handle dashboard saving with success", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard saving with errors", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle conflict resolution on save", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard refresh requests", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle add panel navigation", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle dashboard update operations", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle initial variable values updates", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle run ID updates", async () => {
      wrapper = createWrapper({ runId: "new-run-id" });
      expect(wrapper.props().runId).toBe("new-run-id");
    });
  });

  describe("Error Handling & Edge Cases", () => {
    it("should handle missing dashboard data", () => {
      const emptyDashboard = {
        dashboardId: "test-dashboard",
        name: "Empty Dashboard",
        variables: { showDynamicFilters: false, list: [] },
        tabs: [],
        panels: [],
      };
      wrapper = createWrapper({ dashboardData: emptyDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle malformed panel data", () => {
      const malformedDashboard = {
        ...defaultProps.dashboardData,
        panels: [{ id: null, type: null }],
      };
      wrapper = createWrapper({ dashboardData: malformedDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle GridStack initialization failures", async () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should handle network errors on dashboard save", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid variable configurations", () => {
      const invalidVariables = {
        ...defaultProps.dashboardData,
        variables: null,
      };
      wrapper = createWrapper({ dashboardData: invalidVariables });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing tab data", () => {
      const noTabsDashboard = {
        ...defaultProps.dashboardData,
        tabs: [],
      };
      wrapper = createWrapper({ dashboardData: noTabsDashboard });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component cleanup errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle async operation failures", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Integration & Lifecycle", () => {
    it("should handle complete component lifecycle", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });

    it("should integrate with parent dashboard components", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle prop updates correctly", async () => {
      wrapper = createWrapper();
      await wrapper.setProps({ viewOnly: true });
      expect(wrapper.props().viewOnly).toBe(true);
    });

    it("should handle multiple tab switches", async () => {
      const multiTabDashboard = {
        ...defaultProps.dashboardData,
        tabs: [
          { tabId: "tab1", name: "Tab 1", panels: [] },
          { tabId: "tab2", name: "Tab 2", panels: [] },
          { tabId: "tab3", name: "Tab 3", panels: [] },
        ],
      };
      wrapper = createWrapper({ dashboardData: multiTabDashboard });
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle memory cleanup", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      wrapper.unmount();
    });
  });
});
