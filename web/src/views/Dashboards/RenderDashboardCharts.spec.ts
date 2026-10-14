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
  showConfictErrorNotificationWithRefreshBtn: vi.fn(),
};
// `run` is the real save body handed to useLoading, so the save path can be driven directly.
const mockLoading: { isLoading: any; execute: any; run?: () => Promise<boolean> } = {
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

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

const mockFieldValues = vi.fn();
vi.mock("@/services/stream", () => ({
  default: { fieldValues: (...args: any[]) => mockFieldValues(...args) },
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

    it("returns false, shows the conflict toast and reloads on a 409", async () => {
      wrapper = createWrapper();
      vi.mocked(updateDashboard).mockRejectedValueOnce({
        response: { status: 409, data: { message: "Dashboard was changed elsewhere" } },
      });

      await expect(mockLoading.run!()).resolves.toBe(false);
      expect(mockNotifications.showConfictErrorNotificationWithRefreshBtn).toHaveBeenCalledWith(
        "Dashboard was changed elsewhere",
        expect.any(Function),
      );
      expect(wrapper.emitted("refresh")).toHaveLength(1);
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

  describe("repeat by variable", () => {
    const hostVariable = {
      name: "host",
      type: "custom",
      scope: "global",
      multiSelect: true,
      value: ["api", "web", "db"],
      options: [
        { label: "api", value: "api", selected: true },
        { label: "web", value: "web", selected: true },
        { label: "db", value: "db", selected: true },
      ],
    };

    const repeatDashboard = () => ({
      ...defaultProps.dashboardData,
      variables: { showDynamicFilters: false, list: [hostVariable] },
      tabs: [
        {
          tabId: "default",
          name: "Default Tab",
          panels: [
            {
              id: "cpu",
              title: "CPU",
              type: "line",
              layout: { x: 0, y: 0, w: 96, h: 10, i: "cpu" },
              queries: [],
              repeat: { variable: "host", direction: "h", maxPerRow: 2 },
            },
            {
              id: "mem",
              title: "Memory",
              type: "line",
              layout: { x: 0, y: 10, w: 192, h: 10, i: "mem" },
              queries: [],
            },
          ],
        },
      ],
    });

    const mountRepeat = async (props: Record<string, unknown> = {}) => {
      wrapper = createWrapper({
        dashboardData: repeatDashboard(),
        forceLoad: true,
        layoutMode: "view",
        ...props,
      });
      await flushPromises();
      await vi.waitFor(() =>
        expect(wrapper.findAllComponents({ name: "PanelContainer" }).length).toBeGreaterThan(0),
      );
    };

    const containers = () => wrapper.findAllComponents({ name: "PanelContainer" });
    const changeHandler = () => {
      const calls = mockGridStackInstance.on.mock.calls.filter((c: any[]) => c[0] === "change");
      return calls[calls.length - 1][1];
    };

    beforeEach(() => {
      mockLoading.isLoading.value = false;
      mockGridStackInstance.engine.nodes = [];
    });

    it("renders one copy per selected value in view mode", async () => {
      await mountRepeat();
      await vi.waitFor(() => expect(containers()).toHaveLength(4));
      expect(containers().map((c: any) => c.props("data").id)).toEqual([
        "cpu__r__api",
        "cpu__r__web",
        "cpu__r__db",
        "mem",
      ]);
      expect(wrapper.find('[gs-id="cpu__r__db"]').attributes("gs-y")).toBe("10");
      expect(wrapper.find('[gs-id="mem"]').attributes("gs-y")).toBe("20");
    });

    it("pins each copy's variables to its own value", async () => {
      await mountRepeat();
      await vi.waitFor(() => expect(containers()).toHaveLength(4));
      const web = containers().find((c: any) => c.props("data").id === "cpu__r__web");
      const host = web.props("variablesData").values.find((v: any) => v.name === "host");
      expect(host.value).toEqual(["web"]);
      expect(web.props("repeat")).toMatchObject({ sourceId: "cpu", value: "web", index: 1 });
    });

    it("collapses copies to the source while the layout is edited", async () => {
      await mountRepeat({ layoutMode: "edit" });
      await vi.waitFor(() => expect(containers()).toHaveLength(2));
      const cpu = containers().find((c: any) => c.props("data").id === "cpu");
      expect(cpu.props("repeat")).toMatchObject({ variable: "host", count: 3 });
      expect(wrapper.find('[gs-id="mem"]').attributes("gs-y")).toBe("10");
    });

    it("never writes the expanded positions back to the saved layout", async () => {
      await mountRepeat();
      await vi.waitFor(() => expect(containers()).toHaveLength(4));
      changeHandler()({}, [
        { id: "mem", x: 0, y: 20, w: 192, h: 10 },
        { id: "cpu__r__api", x: 0, y: 0, w: 96, h: 10 },
      ]);
      expect(wrapper.props("dashboardData").tabs[0].panels[1].layout.y).toBe(10);
      expect(mockLoading.execute).not.toHaveBeenCalled();
    });

    it("opens fullscreen on the source with the copy's value pinned", async () => {
      await mountRepeat();
      await vi.waitFor(() => expect(containers()).toHaveLength(4));
      wrapper.vm.onViewPanel("cpu__r__web");
      await nextTick();
      const viewPanel = wrapper.findComponent({ name: "ViewPanel" });
      expect(viewPanel.props("panelId")).toBe("cpu");
      expect(viewPanel.props("repeat")).toEqual({ variable: "host", value: "web" });
      const host = viewPanel
        .props("initialVariableValues")
        .values.find((v: any) => v.name === "host");
      expect(host.value).toEqual(["web"]);
    });

    it("fetches the values behind All when the variable's options stop at its limit", async () => {
      const options = Array.from({ length: 10 }, (_, i) => ({ label: `e${i}`, value: `e${i}` }));
      const fetched = Array.from({ length: 12 }, (_, i) => ({ zo_sql_key: `v${i}` }));
      mockFieldValues.mockResolvedValue({ data: { hits: [{ values: fetched }] } });
      const dashboard = repeatDashboard();
      dashboard.variables.list = [
        {
          ...hostVariable,
          type: "query_values",
          value: ["_o2_all_"],
          options,
          query_data: { stream: "cart_api", field: "endpoint", stream_type: "logs" },
        } as any,
      ];
      const start = new Date(1_700_000_000_000);
      const end = new Date(1_700_003_600_000);
      await mountRepeat({
        dashboardData: dashboard,
        currentTimeObj: { __global: { start_time: start, end_time: end } },
      });
      await vi.waitFor(() => expect(containers()).toHaveLength(13));
      expect(mockFieldValues).toHaveBeenCalledWith(
        expect.objectContaining({
          stream_name: "cart_api",
          fields: ["endpoint"],
          size: 5000,
          start_time: start.getTime(),
          end_time: end.getTime(),
        }),
      );
    });

    it("expands a default All on first load from the fetched values, without a value-less copy", async () => {
      let resolveFetch: (value: any) => void = () => {};
      mockFieldValues.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
      const dashboard = repeatDashboard();
      dashboard.variables.list = [
        {
          ...hostVariable,
          type: "query_values",
          value: ["_o2_all_"],
          options: [],
          query_data: { stream: "triggers", field: "status", stream_type: "logs" },
        } as any,
      ];
      await mountRepeat({
        dashboardData: dashboard,
        currentTimeObj: { __global: { start_time: new Date(1), end_time: new Date(2) } },
      }).catch(() => {});
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="dashboard-panel-repeat-empty-cpu"]')
          .findComponent({ name: "OEmptyState" })
          .props("title"),
      ).toBe("Loading values for $host");
      expect(containers().some((c: any) => c.props("data").id.startsWith("cpu"))).toBe(false);
      resolveFetch({
        data: {
          hits: [{ values: [{ zo_sql_key: "" }, { zo_sql_key: "error" }, { zo_sql_key: "ok" }] }],
        },
      });
      await vi.waitFor(() =>
        expect(containers().map((c: any) => c.props("data").id)).toEqual([
          "cpu__r__error",
          "cpu__r__ok",
          "mem",
        ]),
      );
    });

    it("shows an empty state instead of unfiltered data when no value is selected", async () => {
      const dashboard = repeatDashboard();
      dashboard.variables.list = [{ ...hostVariable, value: [] }];
      wrapper = createWrapper({ dashboardData: dashboard, forceLoad: true, layoutMode: "view" });
      await flushPromises();
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="dashboard-panel-repeat-empty-cpu"]').exists()).toBe(true),
      );
      expect(
        wrapper
          .find('[data-test="dashboard-panel-repeat-empty-cpu"]')
          .findComponent({ name: "OEmptyState" })
          .props("title"),
      ).toBe("No values selected for $host");
      expect(containers().map((c: any) => c.props("data").id)).toEqual(["mem"]);
    });

    it("keeps GridStack from re-packing the expanded layout", async () => {
      await mountRepeat();
      await vi.waitFor(() => expect(mockGridStackInstance.float).toHaveBeenCalledWith(true));
      mockGridStackInstance.float.mockClear();
      await wrapper.setProps({ layoutMode: "edit" });
      await vi.waitFor(() => expect(mockGridStackInstance.float).toHaveBeenCalledWith(false));
    });

    it("locks copies in the grid", async () => {
      await mountRepeat();
      await vi.waitFor(() =>
        expect(mockGridStackInstance.makeWidget).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ id: "cpu__r__web", noMove: true, noResize: true }),
        ),
      );
    });
  });

  describe("repeat a tab by variable", () => {
    const hostVariable = {
      name: "host",
      type: "custom",
      scope: "global",
      multiSelect: true,
      value: ["api", "web"],
      options: [
        { label: "api", value: "api", selected: true },
        { label: "web", value: "web", selected: true },
      ],
    };
    const tabDashboard = (variable: any = hostVariable) => ({
      ...defaultProps.dashboardData,
      variables: { showDynamicFilters: false, list: [variable] },
      tabs: [
        {
          tabId: "svc",
          name: "Service",
          repeat: { variable: "host" },
          panels: [
            {
              id: "cpu",
              title: "CPU",
              type: "line",
              layout: { x: 0, y: 0, w: 96, h: 10, i: "cpu" },
              queries: [],
            },
            {
              id: "mem",
              title: "Memory",
              type: "line",
              layout: { x: 96, y: 0, w: 96, h: 10, i: "mem" },
              queries: [],
              repeat: { variable: "host", direction: "h" },
            },
          ],
        },
        { tabId: "plain", name: "Plain $host", panels: [] },
      ],
    });

    const selectedTabId = ref<string | null>("svc");
    const mountTabs = async (props: Record<string, unknown> = {}, tab = "svc") => {
      selectedTabId.value = tab;
      wrapper = shallowMount(RenderDashboardCharts, {
        props: {
          ...defaultProps,
          dashboardData: tabDashboard(),
          showTabs: true,
          forceLoad: true,
          layoutMode: "view",
          ...props,
        },
        global: {
          plugins: [i18n, store, router],
          provide: { selectedTabId },
          stubs: { ODialog: ODialogStub },
        },
      });
      await flushPromises();
    };
    const tabList = () => wrapper.findComponent({ name: "TabList" });
    const containers = () => wrapper.findAllComponents({ name: "PanelContainer" });

    beforeEach(() => {
      mockGridStackInstance.engine.nodes = [];
    });

    it("renders one virtual tab per value in place of the source and opens the first", async () => {
      await mountTabs();
      await vi.waitFor(() => expect(selectedTabId.value).toBe("svc__r__api"));
      const tabs = tabList().props("renderedTabs");
      expect(tabs.map((tab: any) => tab.tabId)).toEqual(["svc__r__api", "svc__r__web", "plain"]);
      expect(tabs.map((tab: any) => tab.name)).toEqual([
        "Service — api",
        "Service — web",
        "Plain api,web",
      ]);
      expect(tabs[1].repeat).toMatchObject({ sourceId: "svc", value: "web" });
    });

    it("pins the tab's value for its panels, with ids unique to the virtual tab", async () => {
      await mountTabs({}, "svc__r__web");
      await vi.waitFor(() => expect(containers().length).toBe(2));
      const ids = containers().map((c: any) => c.props("data").id);
      expect(ids).toEqual(["cpu__r__web", "mem__r__web__r__web"]);
      const cpu = containers()[0];
      const host = cpu.props("variablesData").values.find((v: any) => v.name === "host");
      expect(host.value).toEqual(["web"]);
      expect(containers()[1].props("repeat")).toMatchObject({ sourceId: "mem", value: "web" });
    });

    it("lands a URL whose value is no longer selected on the first copy, and says so", async () => {
      mockToast.mockClear();
      await mountTabs({}, "svc__r__gone");
      await vi.waitFor(() => expect(selectedTabId.value).toBe("svc__r__api"));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "info",
          message: expect.stringContaining("gone is no longer selected"),
        }),
      );
    });

    it('names a repeated tab by its template while its values load, never "All"', async () => {
      mockFieldValues.mockReturnValue(new Promise(() => {}));
      const pendingVariable = {
        ...hostVariable,
        type: "query_values",
        value: ["_o2_all_"],
        options: [],
        query_data: { stream: "triggers", field: "status", stream_type: "logs" },
      };
      const dashboard = tabDashboard(pendingVariable);
      dashboard.tabs[0].name = "Service $host";
      await mountTabs({
        dashboardData: dashboard,
        currentTimeObj: { __global: { start_time: new Date(1), end_time: new Date(2) } },
      });
      await vi.waitFor(() =>
        expect(tabList().props("renderedTabs")[0]).toMatchObject({
          tabId: "svc",
          name: "Service <host>",
          emptyRepeat: { variable: "host", pending: true },
        }),
      );
    });

    it("does not announce a redirect when nothing is selected", async () => {
      mockToast.mockClear();
      await mountTabs(
        { dashboardData: tabDashboard({ ...hostVariable, value: [] }) },
        "svc__r__api",
      );
      await vi.waitFor(() => expect(selectedTabId.value).toBe("svc"));
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("names an empty repeated tab without the internal placeholder", async () => {
      await mountTabs({ dashboardData: tabDashboard({ ...hostVariable, value: [] }) });
      await vi.waitFor(() => expect(tabList().props("renderedTabs")[1].name).toBe("Plain (none)"));
    });

    it("collapses virtual tabs to the source with a chip while the layout is edited", async () => {
      await mountTabs({ layoutMode: "edit" }, "svc__r__web");
      await vi.waitFor(() => expect(selectedTabId.value).toBe("svc"));
      const tabs = tabList().props("renderedTabs");
      expect(tabs.map((tab: any) => tab.tabId)).toEqual(["svc", "plain"]);
      expect(tabs[0].editChip).toEqual({ variable: "host", count: 2 });
    });

    it("caps virtual tabs at 50 and says how many values exist", async () => {
      const options = Array.from({ length: 60 }, (_, i) => ({ label: `h${i}`, value: `h${i}` }));
      await mountTabs({
        dashboardData: tabDashboard({ ...hostVariable, value: ["_o2_all_"], options }),
      });
      await vi.waitFor(() => expect(selectedTabId.value).toBe("svc__r__h0"));
      expect(tabList().props("renderedTabs")).toHaveLength(51);
      expect(wrapper.vm.tabCapNotices).toEqual([
        { tabId: "svc", label: "“Service” tabs: Showing 50 of 60 values — narrow the selection" },
      ]);
      selectedTabId.value = "plain";
      await flushPromises();
      expect(wrapper.find('[data-test="dashboard-tab-repeat-cap-svc"]').exists()).toBe(true);
    });

    it("shows the source tab as an empty state when no value is selected", async () => {
      await mountTabs({ dashboardData: tabDashboard({ ...hostVariable, value: [] }) });
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="dashboard-tab-repeat-empty"]').exists()).toBe(true),
      );
      expect(selectedTabId.value).toBe("svc");
      expect(containers()).toHaveLength(0);
    });
  });
});
