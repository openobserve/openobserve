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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { reactive } from "vue";
import store from "@/test/unit/helpers/store";
import config from "@/aws-exports";

// Stable spy references — must be declared before vi.mock() factories reference them.
// vi.mock is hoisted so these plain vi.fn() declarations are fine here.
// BUT when vi.mock references them, they must be in hoisted scope too.
const {
  notifyMock,
  toastMock,
  routerPushMock,
  deploysQueryMock,
  routeQuery,
  panelVersions,
  panelDeploys,
} = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  toastMock: vi.fn(),
  routerPushMock: vi.fn(),
  deploysQueryMock: vi.fn(),
  routeQuery: {} as Record<string, string>,
  panelVersions: [] as unknown[],
  panelDeploys: [] as unknown[],
}));

// vi.mock calls are hoisted — must come before component import
vi.mock("@/services/service_versions.queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/service_versions.queries")>();
  return {
    ...actual,
    deploysQuery: (...args: Parameters<typeof actual.deploysQuery>) => {
      deploysQueryMock(...args);
      return { ...actual.deploysQuery(...args), queryFn: async () => ({ deploys: panelDeploys }) };
    },
    versionsQuery: (...args: Parameters<typeof actual.versionsQuery>) => ({
      ...actual.versionsQuery(...args),
      queryFn: async () => ({ versions: panelVersions, total: panelVersions.length }),
    }),
  };
});
// Identity colours let marker tests read which badge colour each chart picked.
vi.mock("@/utils/chartTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/chartTheme")>()),
  chartColor: (token: string) => token,
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      search: vi.fn().mockResolvedValue({ data: { hits: [] } }),
    },
  });
});

vi.mock("@/services/service_streams", () => ({
  correlate: vi.fn().mockResolvedValue({
    data: {
      service_name: "frontend",
      matched_dimensions: {},
      additional_dimensions: {},
      related_streams: { logs: [], metrics: [], traces: [], profiles: [] },
    },
  }),
  getSemanticGroups: vi.fn().mockResolvedValue({ data: [] }),
  getDimensionAnalytics: vi.fn().mockResolvedValue({ data: { available_groups: [] } }),
  buildChipDimensionsFromFilters: vi.fn().mockReturnValue({}),
}));

// resolveStreamSchema calls useStreams(t).getStream() to fetch and cache the
// stream schema. Mock it so those calls complete instantly instead of making
// real HTTP requests that hang in tests.
const { getStreamMock } = vi.hoisted(() => ({
  getStreamMock: vi.fn().mockResolvedValue({ schema: [] }),
}));

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStream: getStreamMock,
    getStreams: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((d: any) => d),
}));

vi.mock("vue-i18n", async () => {
  // Resolve keys against the real English locale so migrated t("...") calls
  // render the actual translated text (badges, caller column, "No operations
  // found", etc.), instead of the raw key paths the old identity mock returned.
  const enLocaleFull = (await import("@/locales/languages/en-US.json")).default;
  // A few tests assert on the raw i18n key (locale-independent), matching the
  // original identity-mock behavior. Keep those keys mapping to themselves so
  // those assertions still hold.
  const identityKeys = new Set<string>(["traces.noLogsAvailableForService"]);
  const resolve = (key: string): string => {
    if (identityKeys.has(key)) return key;
    const val = key
      .split(".")
      .reduce<any>((acc, part) => (acc == null ? undefined : acc[part]), enLocaleFull);
    return typeof val === "string" ? val : key;
  };
  return {
    useI18n: vi.fn(() => ({
      t: (key: string) => resolve(key),
    })),
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const { reactive: toReactive } = await import("vue");
  const route = toReactive({ path: "/", query: routeQuery, params: {} });
  return {
    ...actual,
    useRouter: () => ({
      push: routerPushMock,
      replace: vi.fn(),
      currentRoute: { value: { path: "/", query: {} } },
    }),
    useRoute: () => route,
  };
});

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: toastMock,
}));

import ServiceGraphNodeSidePanel from "./ServiceGraphNodeSidePanel.vue";
import searchService from "@/services/search";
import { correlate as correlateStreams, getDimensionAnalytics } from "@/services/service_streams";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000_000; // microseconds

const baseNode = {
  id: "frontend",
  name: "frontend",
  label: "frontend",
  value: 1200,
  errors: 60,
  error_rate: 5,
};

const healthyNode = { ...baseNode, error_rate: 0, errors: 0 };
const warningNode = { ...baseNode, error_rate: 8 };
const criticalNode = { ...baseNode, error_rate: 15 };

const baseGraphData = {
  nodes: [baseNode],
  edges: [
    {
      from: "gateway",
      to: "frontend",
      total_requests: 1200,
      p50_latency_ns: 5_000_000,
      p95_latency_ns: 120_000_000,
      p99_latency_ns: 250_000_000,
    },
  ],
};

const baseTimeRange = {
  startTime: NOW - 3_600_000_000,
  endTime: NOW,
};

// ODrawer stub — renders slots inline so internal data-test selectors are
// queryable (real ODrawer teleports its content to <body> via DialogPortal,
// which puts it outside the test wrapper's element tree).
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "width",
    "seamless",
    "modal",
    "portalTarget",
    "title",
    "subTitle",
    "size",
    "showClose",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      v-if="open"
      :data-test="$attrs['data-test'] || 'o-drawer-stub'"
      :data-title="title"
    >
      <div class="o-drawer-stub-header">
        <slot name="header" />
        <slot name="header-left" />
        <slot name="header-right" />
        <button
          type="button"
          data-test="o-drawer-close-btn"
          @click="$emit('update:open', false)"
        >Close</button>
      </div>
      <div class="o-drawer-stub-body"><slot /></div>
      <div class="o-drawer-stub-footer"><slot name="footer" /></div>
    </div>
  `,
};

function mountPanel(props: Partial<InstanceType<typeof ServiceGraphNodeSidePanel>["$props"]> = {}) {
  return mount(ServiceGraphNodeSidePanel, {
    global: {
      plugins: [store, VueQueryPlugin],
      stubs: {
        RenderDashboardCharts: { template: '<div data-test="stub-charts" />' },
        OTable: { template: '<div data-test="stub-table" />' },
        TelemetryCorrelationDashboard: {
          template: '<div data-test="stub-telemetry" />',
        },
        ODrawer: ODrawerStub,
        // Render ODropdown content inline so data-test items are always queryable
        ODropdown: {
          name: "ODropdown",
          template:
            '<div class="o-dropdown-stub" v-bind="$attrs"><slot name="trigger" /><slot /></div>',
          emits: ["update:open"],
          props: ["open", "side", "align", "sideOffset"],
        },
        ODropdownItem: {
          name: "ODropdownItem",
          template:
            '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /></div>',
          emits: ["select"],
        },
        // OTabs stub — Reka UI-based, needs stub to avoid context errors
        OTabs: {
          name: "OTabs",
          template: '<div class="o-tabs-stub" v-bind="$attrs"><slot /></div>',
          props: ["modelValue", "dense", "align"],
          emits: ["update:modelValue"],
        },
        OTab: {
          name: "OTab",
          template:
            '<div class="o-tab-stub" v-bind="$attrs" @click="$parent.$emit(\'update:modelValue\', name)"><slot /></div>',
          props: ["name", "label", "style"],
        },
        // OTabPanels: provide reactive context via setup()
        OTabPanels: {
          name: "OTabPanels",
          template: '<div class="o-tab-panels-stub"><slot /></div>',
          props: ["modelValue", "animated", "keepAlive"],
          emits: ["update:modelValue"],
          setup(props) {
            const { computed, provide } = require("vue");
            const ctx = computed(() => ({ modelValue: props.modelValue }));
            provide("tabPanelsCtx", ctx);
            return {};
          },
        },
        OTabPanel: {
          name: "OTabPanel",
          // v-bind="$attrs" forwards data-test; renders only when active
          template: '<div v-if="isActive" v-bind="$attrs" class="o-tab-panel-stub"><slot /></div>',
          props: ["name", "padding", "layout", "stretch"],
          setup(props) {
            const { inject, computed } = require("vue");
            const ctx = inject("tabPanelsCtx", { value: { modelValue: null } });
            const isActive = computed(() => {
              const mv = ctx?.value?.modelValue ?? ctx?.modelValue ?? null;
              return mv === props.name;
            });
            return { isActive };
          },
        },
      },
    },
    props: {
      selectedNode: baseNode,
      graphData: baseGraphData,
      timeRange: baseTimeRange,
      visible: true,
      streamFilter: "default",
      ...props,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ServiceGraphNodeSidePanel", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial render
  // -------------------------------------------------------------------------

  describe("initial render", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should render the panel when visible is true", () => {
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(true);
    });

    it("should not render the panel when visible is false", () => {
      wrapper = mountPanel({ visible: false });
      expect(wrapper.find('[data-test="service-graph-side-panel"]').exists()).toBe(false);
    });

    it("should render the close button", () => {
      expect(wrapper.find('[data-test="o-drawer-close-btn"]').exists()).toBe(true);
    });
  });

  describe("drawer behaviour", () => {
    it("renders a non-modal drawer so the page behind stays interactive", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("modal")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Service name display
  // -------------------------------------------------------------------------

  describe("service name display", () => {
    it("should pass the node name to the drawer title when name is set", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, name: "checkout-service" },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("checkout-service");
    });

    it("should fall back to label when name is absent", () => {
      wrapper = mountPanel({
        selectedNode: {
          id: "payment",
          label: "payment-svc",
          value: 100,
          errors: 0,
          error_rate: 0,
        },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("payment-svc");
    });

    it("should fall back to id when name and label are absent", () => {
      wrapper = mountPanel({
        selectedNode: {
          id: "bare-id-service",
          value: 50,
          errors: 0,
          error_rate: 0,
        },
      });
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("bare-id-service");
    });
  });

  // -------------------------------------------------------------------------
  // Health badge
  // -------------------------------------------------------------------------

  describe("health badge", () => {
    it("should show Healthy badge when error_rate is 0", () => {
      wrapper = mountPanel({ selectedNode: healthyNode });
      const badge = wrapper.find('[data-test="service-health-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Healthy");
    });

    it("should show Warning badge when error_rate is above 5", () => {
      wrapper = mountPanel({ selectedNode: warningNode });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Warning");
    });

    it("should show Critical badge when error_rate is above 10", () => {
      wrapper = mountPanel({ selectedNode: criticalNode });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Critical");
    });

    it("should show Degraded badge when error_rate is exactly 5", () => {
      wrapper = mountPanel({ selectedNode: { ...baseNode, error_rate: 5 } });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Degraded");
    });

    it("should show Warning badge when error_rate is exactly 10", () => {
      wrapper = mountPanel({ selectedNode: { ...baseNode, error_rate: 10 } });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Warning");
    });

    it("should show Degraded badge when error_rate is exactly 1, as the legend's 1 – 5% band says", () => {
      wrapper = mountPanel({ selectedNode: { ...baseNode, error_rate: 1 } });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Degraded");
    });

    it("control: should show Healthy badge when error_rate is just under 1", () => {
      wrapper = mountPanel({ selectedNode: { ...baseNode, error_rate: 0.99 } });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Healthy");
    });

    // o2-enterprise#3126: Graph View chart nodes carry errors and value but no error_rate.
    it("should derive Critical from errors over value when the node has no error_rate", () => {
      wrapper = mountPanel({
        selectedNode: { id: "database", name: "database", value: 2, errors: 1 },
      });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Critical");
    });

    it("should derive the badge from errors over requests when the node has no error_rate", () => {
      wrapper = mountPanel({
        selectedNode: { id: "db", name: "db", requests: 100, errors: 7 },
      });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Warning");
    });

    it("control: should prefer the node's error_rate over errors and requests", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, error_rate: 0, value: 10, errors: 9 },
      });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Healthy");
    });

    it("shows the catalog's muted mark, not a Health badge, when the catalog row withholds Health", () => {
      wrapper = mountPanel({
        selectedNode: {
          ...baseNode,
          error_rate: 0,
          health_status: "healthy",
          health_withheld: true,
        },
      });
      expect(wrapper.find('[data-test="service-health-badge"]').exists()).toBe(false);
      expect(wrapper.get('[data-test="service-health-none"]').text()).toContain("—");
    });

    it("shows the catalog row's Health of the serving version over the range error rate", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, error_rate: 12.5, health_status: "healthy" },
      });
      expect(wrapper.find('[data-test="service-health-badge"]').text()).toBe("Healthy");
    });
  });

  // -------------------------------------------------------------------------
  // RED charts section (streamFilter !== 'all')
  // -------------------------------------------------------------------------

  describe("RED charts section", () => {
    it("should render the red-charts section when streamFilter is not 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();
      expect(wrapper.find('[data-test="service-graph-side-panel-red-charts"]').exists()).toBe(true);
    });

    it("should NOT render the red-charts section when streamFilter is 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(wrapper.find('[data-test="service-graph-side-panel-red-charts"]').exists()).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tabs (operations / nodes / pods) — only visible when streamFilter !== 'all'
  // -------------------------------------------------------------------------

  describe("tabs section", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should render the tabs when streamFilter is not 'all'", async () => {
      await flushPromises();
      expect(wrapper.find('[data-test="service-graph-node-panel-tabs"]').exists()).toBe(true);
    });

    it("should NOT render the tabs when streamFilter is 'all'", async () => {
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(wrapper.find('[data-test="service-graph-node-panel-tabs"]').exists()).toBe(false);
    });

    it("should default to the operations tab panel", async () => {
      await flushPromises();
      expect(
        wrapper.find('[data-test="service-graph-side-panel-recent-operations"]').exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Close button
  // -------------------------------------------------------------------------

  describe("close button", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should emit close when the close button is clicked", async () => {
      const closeBtn = wrapper.find('[data-test="o-drawer-close-btn"]');
      expect(closeBtn.exists()).toBe(true);
      await closeBtn.trigger("click");
      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Metrics tab
  // -------------------------------------------------------------------------

  describe("metrics tab", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should render the metrics tab", async () => {
      await flushPromises();
      expect(wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]').exists()).toBe(
        true,
      );
    });

    it("should show loading state when metricsCorrelationLoading is true", async () => {
      // Delay the correlate response so the loading state is visible
      vi.mocked(correlateStreams).mockImplementationOnce(() => new Promise(() => {}));

      // Activate the metrics tab to trigger fetchMetricsCorrelation
      const metricsTab = wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]');
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="service-graph-side-panel-metrics-loading"]').exists()).toBe(
        true,
      );
    });

    it("should show error state when metricsCorrelationError is set", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(new Error("Network failure"));

      const metricsTab = wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]');
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      const errorEl = wrapper.find('[data-test="service-graph-side-panel-metrics-error"]');
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toContain("Network failure");
    });

    it("should call fetchMetricsCorrelation with true when retry button is clicked", async () => {
      // First call fails to put the component into error state
      vi.mocked(correlateStreams).mockRejectedValueOnce(new Error("Server error"));

      const metricsTab = wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]');
      expect(metricsTab.exists()).toBe(true);
      await metricsTab.trigger("click");
      await flushPromises();

      const retryBtn = wrapper.find('[data-test="service-graph-side-panel-metrics-retry-btn"]');
      expect(retryBtn.exists()).toBe(true);

      // Second call succeeds
      vi.mocked(correlateStreams).mockResolvedValueOnce({
        data: {
          service_name: "frontend",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: { logs: [], metrics: ["prom-stream"], traces: [], profiles: [] },
        },
      } as any);

      await retryBtn.trigger("click");
      await flushPromises();

      // After retry succeeds the error state should be gone
      expect(wrapper.find('[data-test="service-graph-side-panel-metrics-error"]').exists()).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Operations fetch — triggered on mount with visible=true + stream != 'all'
  // -------------------------------------------------------------------------

  describe("operations data fetch", () => {
    it("should call searchService.search for operations on mount", async () => {
      wrapper = mountPanel({ streamFilter: "traces-stream" });
      await flushPromises();
      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          page_type: "traces",
          org_identifier: "default",
        }),
      );
    });

    it("should NOT call searchService.search when streamFilter is 'all'", async () => {
      vi.mocked(searchService.search).mockClear();
      wrapper = mountPanel({ streamFilter: "all" });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should NOT call searchService.search when visible is false", async () => {
      vi.mocked(searchService.search).mockClear();
      wrapper = mountPanel({ visible: false });
      await flushPromises();
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should show 'No operations found' when search returns empty hits", async () => {
      vi.mocked(searchService.search).mockResolvedValue({
        data: { hits: [] },
      } as any);
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();
      const panel = wrapper.find('[data-test="service-graph-side-panel-recent-operations"]');
      expect(panel.exists()).toBe(true);
      expect(panel.text()).toContain("No operations found");
    });

    // A tool node's caller is its OWNING AGENT, which sits on an ancestor span —
    // the operations query must climb the parent chain (COALESCE + chained LEFT
    // JOINs) exactly like the graph edge, so the panel and the graph agree. The
    // bug: it used raw service_name, showing the host app as the caller while the
    // graph correctly showed the agent.
    it("climbs the parent chain for a TOOL node's caller (matches the graph)", async () => {
      vi.mocked(searchService.search).mockClear();
      vi.mocked(searchService.search).mockResolvedValue({
        data: { hits: [] },
      } as any);
      wrapper = mountPanel({
        streamFilter: "sre_agent_v2",
        selectedNode: { ...baseNode, name: "load_skill", service_type: "tool" },
      });
      await flushPromises();
      const sql = vi.mocked(searchService.search).mock.calls[0][0].query.query.sql;
      // Nearest-ancestor-agent caller, not raw service_name.
      expect(sql).toContain("COALESCE(c.gen_ai_agent_name, p1.gen_ai_agent_name");
      expect(sql).toContain("c.service_name)");
      // Chained ancestor joins, one per level, keyed on parent span + trace.
      expect(sql).toContain(
        'LEFT JOIN "sre_agent_v2" AS p1 ON c.reference_parent_span_id = p1.span_id',
      );
      expect(sql).toContain("p1.reference_parent_span_id = p2.span_id");
      expect((sql.match(/LEFT JOIN/g) || []).length).toBe(4);
      // Filters the tool's own spans (child-qualified identity field).
      expect(sql).toContain("c.gen_ai_tool_name = 'load_skill'");
      // NOT the old raw-service_name caller.
      expect(sql).not.toContain("service_name as caller_service");
    });

    it("keeps raw service_name as caller for an INFERRED dependency node", async () => {
      vi.mocked(searchService.search).mockClear();
      vi.mocked(searchService.search).mockResolvedValue({
        data: { hits: [] },
      } as any);
      wrapper = mountPanel({
        streamFilter: "default",
        selectedNode: { ...baseNode, name: "postgres", service_type: "database" },
      });
      await flushPromises();
      const sql = vi.mocked(searchService.search).mock.calls[0][0].query.query.sql;
      // Inferred deps genuinely have the caller on service_name — no agent climb.
      expect(sql).toContain("service_name as caller_service");
      expect(sql).not.toContain("LEFT JOIN");
    });

    it("filters catalog-origin inferred dependencies by type and system", async () => {
      vi.mocked(searchService.search).mockClear();
      vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as any);
      wrapper = mountPanel({
        streamFilter: "default",
        selectedNode: {
          ...baseNode,
          id: '["sso","sso","database","mysql"]',
          name: "sso",
          service_type: "database",
          service_system: "mysql",
        },
      });
      await flushPromises();

      const sql = vi.mocked(searchService.search).mock.calls[0][0].query.query.sql;
      expect(sql).toContain("infer_service_name = 'sso'");
      expect(sql).toContain("infer_service_type = 'database'");
      expect(sql).toContain("infer_service_system = 'mysql'");
    });

    it("does not add a catalog system to graph-origin navigation", async () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, name: "postgres", service_type: "database" },
      });

      await wrapper.vm.viewRelatedTraces();

      const payload = wrapper.emitted("view-traces")?.[0]?.[0] as Record<string, any>;
      expect(payload).not.toHaveProperty("serviceSystem");
    });

    it("adds the catalog system to catalog-origin navigation", async () => {
      wrapper = mountPanel({
        selectedNode: {
          ...baseNode,
          name: "sso",
          service_type: "database",
          service_system: "mysql",
        },
      });

      await wrapper.vm.viewRelatedTraces();

      expect(wrapper.emitted("view-traces")?.[0]?.[0]).toMatchObject({
        serviceName: "sso",
        serviceType: "database",
        serviceSystem: "mysql",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Edge-case: selectedNode changes reset tabs and correlation data
  // -------------------------------------------------------------------------

  describe("node change side-effects", () => {
    it("should re-fetch operations when selectedNode id changes", async () => {
      wrapper = mountPanel({ streamFilter: "default" });
      await flushPromises();

      const initialCallCount = vi.mocked(searchService.search).mock.calls.length;

      await wrapper.setProps({
        selectedNode: { ...baseNode, id: "new-service", name: "new-service" },
      });
      await flushPromises();

      expect(vi.mocked(searchService.search).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  // -------------------------------------------------------------------------
  // "View Related Logs" navigation
  // -------------------------------------------------------------------------

  describe("viewRelatedLogs — no logs stream found", () => {
    beforeEach(() => {
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should show a warning notification when correlate returns an empty logs array", async () => {
      // Default mock already returns logs: [] — no override needed
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: "traces.noLogsAvailableForService",
        }),
      );
    });

    it("should NOT navigate to /logs when no logs stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).not.toHaveBeenCalled();
    });

    it("should show a warning notification when correlate throws an error", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(new Error("Network failure"));

      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: "traces.noLogsAvailableForService",
        }),
      );
    });

    it("should NOT navigate to /logs when correlate throws an error", async () => {
      vi.mocked(correlateStreams).mockRejectedValueOnce(new Error("Network failure"));

      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // metricGroupResources ref
  // -------------------------------------------------------------------------

  describe("metricGroupResources", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should expose exactly 2 top-level metric group entries (Pods/Nodes)", () => {
      expect(wrapper.vm.metricGroupResources).toHaveLength(2);
    });

    it("should have top-level IDs in order: pods, nodes", () => {
      const ids = wrapper.vm.metricGroupResources.map((g: { id: string }) => g.id);
      expect(ids).toEqual(["pods", "nodes"]);
    });

    it("should have the expected id and label for each top-level group", () => {
      const groups = wrapper.vm.metricGroupResources;
      expect(groups[0]).toMatchObject({ id: "pods", labelKey: "metrics.groups.pods" });
      expect(groups[1]).toMatchObject({ id: "nodes", labelKey: "metrics.groups.nodes" });
    });

    it("should nest compute/memory/network/storage/others under each top-level group", () => {
      const groups = wrapper.vm.metricGroupResources;
      const childIds = (g: { children?: { id: string }[] }) => (g.children ?? []).map((c) => c.id);
      expect(childIds(groups[0])).toEqual(["compute", "memory", "network", "storage", "others"]);
      expect(childIds(groups[1])).toEqual(["compute", "memory", "network", "storage", "others"]);
    });
  });

  describe("viewRelatedLogs — valid logs stream found", () => {
    beforeEach(() => {
      vi.mocked(correlateStreams).mockResolvedValue({
        data: {
          service_name: "frontend",
          matched_dimensions: {},
          additional_dimensions: {},
          related_streams: {
            logs: [
              {
                stream_name: "k8s-logs",
                filters: { service_name: "frontend" },
              },
            ],
            metrics: [],
            traces: [],
            profiles: [],
          },
        },
      } as any);
      wrapper = mountPanel({ streamFilter: "default" });
    });

    it("should navigate to /logs when a valid log stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(routerPushMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.objectContaining({
            stream_type: "logs",
            // `stream` (not `stream_value`) — restoreUrlQueryParams only reads `stream`,
            // and `type` routes the Logs page through its trace-explorer restore branch.
            stream: "k8s-logs",
            type: "trace_explorer",
          }),
        }),
      );
    });

    it("should clear the logs isInitialized flag so the URL params win over the previous session", async () => {
      const dispatchSpy = vi.spyOn(store, "dispatch");

      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      // Without this the Logs page restores its stored session and silently drops
      // the stream, time range and filter carried in the pushed URL.
      expect(dispatchSpy).toHaveBeenCalledWith("logs/setIsInitialized", false);

      dispatchSpy.mockRestore();
    });

    it("should NOT show a warning notification when a valid log stream is found", async () => {
      const viewRelatedLogsBtn = wrapper.find(
        '[data-test="service-graph-node-panel-view-related-logs-btn"]',
      );
      expect(viewRelatedLogsBtn.exists()).toBe(true);
      await viewRelatedLogsBtn.trigger("click");
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    });
  });

  // -------------------------------------------------------------------------
  // isDurationColumn helper
  // -------------------------------------------------------------------------

  describe("isDurationColumn helper", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should return true for p99", () => {
      expect(wrapper.vm.isDurationColumn("p99")).toBe(true);
    });

    it("should return true for p95", () => {
      expect(wrapper.vm.isDurationColumn("p95")).toBe(true);
    });

    it("should return true for p75", () => {
      expect(wrapper.vm.isDurationColumn("p75")).toBe(true);
    });

    it("should return false for p50", () => {
      expect(wrapper.vm.isDurationColumn("p50")).toBe(false);
    });

    it("should return false for requests", () => {
      expect(wrapper.vm.isDurationColumn("requests")).toBe(false);
    });

    it("should return false for operation", () => {
      expect(wrapper.vm.isDurationColumn("operation")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(wrapper.vm.isDurationColumn("")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // sortBy / sortOrder initial state
  // -------------------------------------------------------------------------

  describe("sort state initial defaults", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should default sortBy to empty string", () => {
      expect(wrapper.vm.sortBy).toBe("");
    });

    it("should default sortOrder to empty string", () => {
      expect(wrapper.vm.sortOrder).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // handleSortChange
  // -------------------------------------------------------------------------

  describe("handleSortChange", () => {
    beforeEach(() => {
      wrapper = mountPanel();
    });

    it("should set sortBy to the field and sortOrder to asc on first click", () => {
      wrapper.vm.handleSortChange("p99");
      expect(wrapper.vm.sortBy).toBe("p99");
      expect(wrapper.vm.sortOrder).toBe("asc");
    });

    it("should toggle sortOrder to desc when the same field is clicked twice", () => {
      wrapper.vm.handleSortChange("requests");
      expect(wrapper.vm.sortBy).toBe("requests");
      expect(wrapper.vm.sortOrder).toBe("asc");

      wrapper.vm.handleSortChange("requests");
      expect(wrapper.vm.sortBy).toBe("requests");
      expect(wrapper.vm.sortOrder).toBe("desc");
    });

    it("should clear sorting on the third click of the same field", () => {
      wrapper.vm.handleSortChange("operation");
      expect(wrapper.vm.sortOrder).toBe("asc");

      wrapper.vm.handleSortChange("operation");
      expect(wrapper.vm.sortOrder).toBe("desc");

      wrapper.vm.handleSortChange("operation");
      expect(wrapper.vm.sortBy).toBe("");
      expect(wrapper.vm.sortOrder).toBe("");
    });

    it("should reset sortOrder to asc when switching to a different field", () => {
      wrapper.vm.handleSortChange("operation");
      wrapper.vm.handleSortChange("operation");
      expect(wrapper.vm.sortBy).toBe("operation");
      expect(wrapper.vm.sortOrder).toBe("desc");

      wrapper.vm.handleSortChange("p95");
      expect(wrapper.vm.sortBy).toBe("p95");
      expect(wrapper.vm.sortOrder).toBe("asc");
    });
  });

  // -------------------------------------------------------------------------
  // sortedOperationsTableRows
  // -------------------------------------------------------------------------

  describe("sortedOperationsTableRows", () => {
    const mockOperationsHits = [
      {
        operation_name: "GET /api/users",
        request_count: 100,
        error_count: 5,
        p50_latency: 10000,
        p75_latency: 20000,
        p95_latency: 50000,
        p99_latency: 80000,
      },
      {
        operation_name: "POST /api/orders",
        request_count: 200,
        error_count: 10,
        p50_latency: 5000,
        p75_latency: 15000,
        p95_latency: 30000,
        p99_latency: 120000,
      },
      {
        operation_name: "GET /api/products",
        request_count: 50,
        error_count: 0,
        p50_latency: 20000,
        p75_latency: 40000,
        p95_latency: 80000,
        p99_latency: 150000,
      },
    ];

    describe("when operations are loaded", () => {
      beforeEach(async () => {
        vi.mocked(searchService.search).mockResolvedValue({
          data: { hits: mockOperationsHits },
        } as any);
        wrapper = mountPanel({ streamFilter: "default" });
        await flushPromises();
      });

      it("should return unsorted rows when sortBy is empty", () => {
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows).toHaveLength(3);
        expect(rows[0].operation).toBe("GET /api/users");
        expect(rows[1].operation).toBe("POST /api/orders");
        expect(rows[2].operation).toBe("GET /api/products");
      });

      it("should sort by p99 ascending when sortBy is p99 and sortOrder is asc", () => {
        wrapper.vm.handleSortChange("p99");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].p99).toBe(80000);
        expect(rows[1].p99).toBe(120000);
        expect(rows[2].p99).toBe(150000);
      });

      it("should sort by p99 descending when sortBy is p99 and sortOrder is desc", () => {
        wrapper.vm.handleSortChange("p99"); // asc
        wrapper.vm.handleSortChange("p99"); // toggle to desc
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].p99).toBe(150000);
        expect(rows[1].p99).toBe(120000);
        expect(rows[2].p99).toBe(80000);
      });

      it("should sort by operation alphabetically ascending", () => {
        wrapper.vm.handleSortChange("operation");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].operation).toBe("GET /api/products");
        expect(rows[1].operation).toBe("GET /api/users");
        expect(rows[2].operation).toBe("POST /api/orders");
      });

      it("should sort by requests numerically descending", () => {
        wrapper.vm.handleSortChange("requests"); // asc
        wrapper.vm.handleSortChange("requests"); // toggle to desc
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].requests).toBe(200);
        expect(rows[1].requests).toBe(100);
        expect(rows[2].requests).toBe(50);
      });

      it("should sort by errors numerically ascending", () => {
        wrapper.vm.handleSortChange("errors");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows[0].errors).toBe(0);
        expect(rows[1].errors).toBe(5);
        expect(rows[2].errors).toBe(10);
      });
    });

    describe("when operations are empty", () => {
      beforeEach(async () => {
        vi.mocked(searchService.search).mockResolvedValue({
          data: { hits: [] },
        } as any);
        wrapper = mountPanel({ streamFilter: "default" });
        await flushPromises();
      });

      it("should return an empty array without error when sortBy is set", () => {
        wrapper.vm.handleSortChange("p99");
        const rows = wrapper.vm.sortedOperationsTableRows;
        expect(rows).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // isInferred computed
  // ---------------------------------------------------------------------------

  describe("isInferred", () => {
    it("should return false when service_type is undefined", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      expect(wrapper.vm.isInferred).toBe(false);
    });

    it("should return false when service_type is null", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: null },
      });
      expect(wrapper.vm.isInferred).toBe(false);
    });

    it("should return true when service_type is 'database'", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
      });
      expect(wrapper.vm.isInferred).toBe(true);
    });

    it("should return true for all supported inferred service types", () => {
      for (const st of ["database", "queue", "rpc", "external"]) {
        wrapper = mountPanel({
          selectedNode: { ...baseNode, service_type: st },
        });
        expect(wrapper.vm.isInferred).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // serviceNameField — column the panel filters on, per node family
  // ---------------------------------------------------------------------------

  describe("serviceNameField", () => {
    it("uses service_name for an instrumented service (no service_type)", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      expect(wrapper.vm.serviceNameField).toBe("service_name");
    });

    it("uses infer_service_name for inferred dependency kinds", () => {
      for (const st of ["database", "queue", "rpc", "external"]) {
        wrapper = mountPanel({
          selectedNode: { ...baseNode, service_type: st },
        });
        expect(wrapper.vm.serviceNameField).toBe("infer_service_name");
      }
    });

    it("uses the gen_ai_* column for agent and tool kinds (not infer_service_name)", () => {
      for (const [st, col] of Object.entries({
        agent: "gen_ai_agent_name",
        tool: "gen_ai_tool_name",
      })) {
        wrapper = mountPanel({
          selectedNode: { ...baseNode, service_type: st },
        });
        // regression: previously returned "infer_service_name" → "field not found"
        expect(wrapper.vm.serviceNameField).toBe(col);
      }
    });

    it("model defaults to gen_ai_request_model before schema resolves", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "model" },
      });
      // streamFieldSet is empty until the schema fetch settles
      expect(wrapper.vm.serviceNameField).toBe("gen_ai_request_model");
    });

    it("model COALESCEs request/response when the schema has both", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [
          { name: "gen_ai_request_model", type: "keyword" },
          { name: "gen_ai_response_model", type: "keyword" },
        ],
      });
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "model" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();
      expect(wrapper.vm.serviceNameField).toBe(
        "COALESCE(gen_ai_request_model, gen_ai_response_model)",
      );
    });

    it("model falls back to response_model when the schema has only that (Langfuse/OpenInference)", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [{ name: "gen_ai_response_model", type: "keyword" }],
      });
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "model" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();
      // regression: response-only vendors would otherwise hit "field not found"
      expect(wrapper.vm.serviceNameField).toBe("gen_ai_response_model");
    });
  });

  // ---------------------------------------------------------------------------
  // operationsTableColumns — Caller column for inferred services
  // ---------------------------------------------------------------------------

  describe("operationsTableColumns", () => {
    it("should NOT include a caller column when service_type is unset", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      const cols = wrapper.vm.operationsTableColumns;
      const callerCol = cols.find((c: any) => c.id === "caller");
      expect(callerCol).toBeUndefined();
    });

    it("should include a caller column as the first column when service_type is 'database'", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
      });
      const cols = wrapper.vm.operationsTableColumns;
      expect(cols[0].id).toBe("caller");
      expect(cols[0].header).toBe("Caller");
      expect(cols[0].accessorKey).toBe("caller");
    });

    it("should include a caller column for all inferred service types", () => {
      for (const st of ["database", "queue", "rpc", "external"]) {
        wrapper = mountPanel({
          selectedNode: { ...baseNode, service_type: st },
        });
        const cols = wrapper.vm.operationsTableColumns;
        expect(cols[0].id).toBe("caller");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // activeResourceTabConfigs for inferred services
  // ---------------------------------------------------------------------------

  describe("activeResourceTabConfigs for inferred services", () => {
    it("should return empty array when schema is not yet resolved", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
      });
      // Schema hasn't resolved yet, so inferredTabConfigs should be empty
      // and activeResourceTabConfigs falls back through inferredTabConfigs
      const configs = wrapper.vm.activeResourceTabConfigs;
      expect(configs).toEqual([]);
    });

    it("should return inferred tabs when schema is resolved with matching fields", async () => {
      // Override schema mock to return database-related fields
      getStreamMock.mockResolvedValueOnce({
        schema: [
          { name: "server_address", type: "keyword" },
          { name: "net_peer_name", type: "keyword" },
          { name: "db_name", type: "keyword" },
          { name: "db_operation", type: "keyword" },
        ],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      expect(configs.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty when schema has none of the fallback fields", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [{ name: "unrelated_field", type: "keyword" }],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      expect(configs).toEqual([]);
    });

    it("should return empty array when service_type is not set", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      // Without service_type, inferredTabConfigs returns []
      // and availableResourceTabConfigs (user-selected) defaults to []
      // because no workload fields are selected
      expect(wrapper.vm.isInferred).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // INFERRED_SERVICE_TABS registry (test through component)
  // ---------------------------------------------------------------------------

  describe("default resource groups", () => {
    const givenGroups = (namespaceField: string, versionField: string) => {
      getStreamMock.mockResolvedValueOnce({
        schema: [
          { name: namespaceField, type: "keyword" },
          { name: versionField, type: "keyword" },
        ],
      });
      vi.mocked(getDimensionAnalytics).mockResolvedValueOnce({
        data: {
          available_groups: [
            {
              group_id: "service-namespace",
              display: "Service Namespace",
              stream_types: ["traces"],
              aliases: { traces: namespaceField },
              recommended: true,
            },
            {
              group_id: "version",
              display: "Version",
              stream_types: ["traces"],
              aliases: { traces: versionField },
              recommended: true,
            },
          ],
        },
      } as never);
    };

    it("puts stamped service version first even when platform priority selects other fields", async () => {
      givenGroups("service_k8s_namespace_name", "o2_service_version");
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      expect(wrapper.vm.availableResourceTabConfigs[0].groupField).toBe("o2_service_version");
      expect(wrapper.vm.selectedWorkloadFields[0]).toBe("service-version");
    });

    it("names the version breakdown tab apart from the Versions tab", async () => {
      givenGroups("service_k8s_namespace_name", "o2_service_version");
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      const tab = wrapper.vm.availableResourceTabConfigs[0];
      expect(String(tab.label)).toBe("By version");
      expect(String(tab.colLabel)).toBe("Version");
    });

    it("pre-selects the namespace and version groups stored as service_service_* fields", async () => {
      givenGroups("service_service_namespace", "service_service_version");

      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();

      expect(wrapper.vm.availableResourceTabConfigs.map((c: { id: string }) => c.id)).toEqual([
        "service-namespace",
        "version",
      ]);
      expect(wrapper.vm.selectedWorkloadFields).toEqual(["service-namespace", "version"]);
    });
  });

  describe("INFERRED_SERVICE_TABS registry", () => {
    it("should generate hosts tab for database when server_address exists in schema", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [{ name: "server_address", type: "keyword" }],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      const hostsTab = configs.find((c: any) => c.id === "hosts");
      expect(hostsTab).toBeDefined();
      expect(hostsTab.label).toBe("Hosts");
      expect(hostsTab.colLabel).toBe("Host");
      expect(hostsTab.groupField).toContain("COALESCE");
      expect(hostsTab.groupField).toContain("server_address");
    });

    it("should generate hosts tab with COALESCE when multiple host fields exist", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [
          { name: "server_address", type: "keyword" },
          { name: "net_peer_name", type: "keyword" },
          { name: "net_peer_ip", type: "keyword" },
        ],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      const hostsTab = configs.find((c: any) => c.id === "hosts");
      expect(hostsTab).toBeDefined();
      // COALESCE should include all three fields
      expect(hostsTab.groupField).toContain("server_address");
      expect(hostsTab.groupField).toContain("net_peer_name");
      expect(hostsTab.groupField).toContain("net_peer_ip");
      // network_peer_address is not in schema, so it should NOT be in COALESCE
      expect(hostsTab.groupField).not.toContain("network_peer_address");
    });

    it("should NOT generate databases tab when db fields are absent from schema", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [{ name: "server_address", type: "keyword" }],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      const databasesTab = configs.find((c: any) => c.id === "databases");
      expect(databasesTab).toBeUndefined();
    });

    it("should generate queries tab when db_operations exists in schema", async () => {
      getStreamMock.mockResolvedValueOnce({
        schema: [
          { name: "server_address", type: "keyword" },
          { name: "db_operations", type: "keyword" },
        ],
      });

      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
        streamFilter: "default",
      });
      await flushPromises();
      await flushPromises();

      const configs = wrapper.vm.activeResourceTabConfigs;
      const queriesTab = configs.find((c: any) => c.id === "queries");
      expect(queriesTab).toBeDefined();
      expect(queriesTab.colLabel).toBe("DB Operation");
      expect(queriesTab.groupField).toContain("db_operations");
    });
  });

  // ---------------------------------------------------------------------------
  // Template: Metrics tab hidden for inferred services
  // ---------------------------------------------------------------------------

  describe("metrics tab visibility for inferred services", () => {
    it("should render metrics tab for regular (non-inferred) services", () => {
      wrapper = mountPanel({ selectedNode: baseNode });
      const metricsTab = wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]');
      expect(metricsTab.exists()).toBe(true);
    });

    it("should NOT render metrics tab for inferred services", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
      });
      const metricsTab = wrapper.find('[data-test="service-graph-node-panel-tab-metrics"]');
      expect(metricsTab.exists()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Template: Resource dropdown hidden for inferred services
  // ---------------------------------------------------------------------------

  describe("resource dropdown visibility for inferred services", () => {
    it("should NOT render resource dropdown for inferred services", () => {
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database" },
      });
      const dropdownBtn = wrapper.find(
        '[data-test="service-graph-node-panel-workload-fields-btn"]',
      );
      expect(dropdownBtn.exists()).toBe(false);
    });
  });
  // ---------------------------------------------------------------------------
  // RED charts: per-second Rate on an explicit interval
  // ---------------------------------------------------------------------------

  describe("RED chart queries", () => {
    const panels = (w: VueWrapper) => (w.vm as any).dashboardData?.tabs?.[0]?.panels ?? [];
    const rate = (w: VueWrapper) => panels(w).find((p: any) => p.title === "Rate");
    // The traces datetime this panel receives is in microseconds, like the metrics dashboard's.
    const rangeOf = (seconds: number) => ({ startTime: NOW - seconds * 1_000_000, endTime: NOW });

    it("leaves no interval placeholder in any panel query", async () => {
      wrapper = mountPanel();
      await flushPromises();
      expect(panels(wrapper).length).toBeGreaterThan(0);
      for (const panel of panels(wrapper)) {
        expect(panel.queries[0].query).not.toContain("[INTERVAL");
      }
    });

    it("plots Rate as spans per second over a 30-minute range", async () => {
      wrapper = mountPanel({ timeRange: rangeOf(30 * 60) });
      await flushPromises();
      expect(rate(wrapper).queries[0].query).toContain("histogram(_timestamp, '15 second')");
      expect(rate(wrapper).queries[0].query).toContain("count(*) / 15.0");
    });

    it("plots Rate per second on hourly buckets over 6 hours", async () => {
      wrapper = mountPanel({ timeRange: rangeOf(6 * 3600) });
      await flushPromises();
      expect(rate(wrapper).queries[0].query).toContain("histogram(_timestamp, '1 hour')");
      expect(rate(wrapper).queries[0].query).toContain("count(*) / 3600.0");
    });

    it("labels Rate in spans/s", async () => {
      wrapper = mountPanel();
      await flushPromises();
      expect(rate(wrapper).config.unit).toBe("custom");
      expect(rate(wrapper).config.unit_custom).toBe("spans/s");
    });

    it("adds Duration p95 in ms from the same service-scoped trace search", async () => {
      wrapper = mountPanel({ timeRange: rangeOf(30 * 60) });
      await flushPromises();
      const p95 = panels(wrapper).find((p: any) => p.title === "Duration p95");
      const query = p95.queries[0].query;
      expect(query).toContain("approx_percentile_cont(duration, 0.95) / 1000.0 AS p95_duration");
      expect(query).toContain("histogram(_timestamp, '15 second')");
      expect(query).toContain(
        rate(wrapper).queries[0].query.split(" GROUP BY")[0].split("FROM")[1],
      );
      expect(query).not.toContain("span_status = 'ERROR'");
      expect(p95.type).toBe("line");
      expect(p95.config.unit).toBe("milliseconds");
      expect(p95.queries[0].fields.y.map((y: any) => y.alias)).toEqual(["p95_duration"]);
    });
  });

  describe("version deploy markers", () => {
    it("names each build of an image rebuild in the marker legend, as the chart labels do", async () => {
      const previous = config.isEnterprise;
      config.isEnterprise = "true";
      const deploy = (key: string, extra: Record<string, unknown>) => ({
        at: baseTimeRange.startTime + 1_000_000,
        deploy_key: key,
        where_key: "k8s:c1/web",
        provisional: false,
        ...extra,
      });
      panelDeploys.splice(
        0,
        panelDeploys.length,
        deploy("d1", {
          version: "2.4.0",
          image: "f167103",
          from_version: "2.4.0",
          from_image: "1f08369",
        }),
        deploy("d2", {
          version: "2.5.0",
          image: "aaaaaaa",
          from_version: "2.4.0",
          from_image: "f167103",
        }),
      );
      try {
        wrapper = mountPanel();
        await flushPromises();
        await flushPromises();
        // This spec's t returns the bare message, so the image short itself is covered in deployMarkers.spec.
        expect(wrapper.get('[data-test="svcver-marker-d1"]').text()).toMatch(/^2\.4\.0 · img /);
        expect(wrapper.get('[data-test="svcver-marker-d2"]').text()).toBe("2.5.0");
      } finally {
        config.isEnterprise = previous;
        panelDeploys.splice(0);
      }
    });

    it("requests markers with the panel's microsecond bounds", async () => {
      const previous = config.isEnterprise;
      config.isEnterprise = "true";
      try {
        wrapper = mountPanel();
        await flushPromises();
        expect(deploysQueryMock.mock.calls.at(-1)?.[2]).toMatchObject({
          start_time: baseTimeRange.startTime,
          end_time: baseTimeRange.endTime,
        });
      } finally {
        config.isEnterprise = previous;
      }
    });
  });

  describe("versions tab placement and identity header", () => {
    it("orders Operations, Versions with its count, then Metrics and shows the current identity", async () => {
      const previous = config.isEnterprise;
      config.isEnterprise = "true";
      Object.assign(routeQuery, { panel: "operations", panelSvc: "svc", panelWhere: "k8s:c1/web" });
      panelVersions.splice(
        0,
        panelVersions.length,
        ...[
          { version: "2.0", active: true, first_seen: 2 },
          { version: "1.0", active: false, first_seen: 1 },
          { version: "9.9", active: true, first_seen: 3, where_key: "k8s:c2/web" },
        ].map((row) => ({
          version_key: row.version,
          where_key: "k8s:c1/web",
          where: { kind: "k8s", k8s_cluster: "c1", k8s_namespace: "web" },
          env: "prod",
          env_source: "attribute",
          signals: {},
          deploys: [],
          ...row,
        })),
      );
      try {
        wrapper = mountPanel();
        await flushPromises();
        await flushPromises();
        const tabs = wrapper
          .findAll('[data-test="service-graph-node-panel-tabs"] [data-test]')
          .map((tab) => tab.attributes("data-test"))
          .filter((id) => /tab-operations|svcver-versions-tab|tab-metrics/.test(id || ""));
        expect(tabs).toEqual([
          "service-graph-node-panel-tab-operations",
          "svcver-versions-tab",
          "service-graph-node-panel-tab-metrics",
        ]);
        expect(wrapper.find('[data-test="svcver-versions-count"]').text()).toBe("2");
        const identity = wrapper.find('[data-test="svcver-panel-identity"]').text();
        expect(identity).toContain("c1 · web");
        expect(identity).toContain("2.0");
      } finally {
        config.isEnterprise = previous;
        for (const key of Object.keys(routeQuery)) delete routeQuery[key];
        panelVersions.splice(0);
      }
    });

    it("keeps the Versions tab when the same service's row refreshes, and resets it for another service", async () => {
      const previous = config.isEnterprise;
      config.isEnterprise = "true";
      Object.assign(routeQuery, {
        panel: "versions",
        panelSvc: "frontend",
        panelWhere: "k8s:c1/web",
      });
      try {
        wrapper = mountPanel();
        await flushPromises();
        expect((wrapper.vm as any).activeTab).toBe("versions");
        await wrapper.setProps({ selectedNode: { ...baseNode, health_status: "healthy" } });
        await flushPromises();
        expect((wrapper.vm as any).activeTab).toBe("versions");
        await wrapper.setProps({ selectedNode: { ...baseNode, id: "cart", name: "cart" } });
        await flushPromises();
        expect((wrapper.vm as any).activeTab).toBe("operations");
      } finally {
        config.isEnterprise = previous;
        for (const key of Object.keys(routeQuery)) delete routeQuery[key];
      }
    });
  });
  describe("selected where scopes the panel's source queries", () => {
    const WHERE_A = "k8s:c1/o'shop";
    const WHERE_B = "k8s:c2/shop";
    const sqls = () =>
      vi.mocked(searchService.search).mock.calls.map((call: any) => call[0].query.query.sql);
    const redQueries = (w: VueWrapper) =>
      ((w.vm as any).dashboardData?.tabs?.[0]?.panels ?? []).map((p: any) => p.queries[0].query);
    const givenSchema = (fields: string[]) => {
      getStreamMock.mockResolvedValueOnce({
        schema: fields.map((name) => ({ name, type: "keyword" })),
      });
      vi.mocked(getDimensionAnalytics).mockResolvedValueOnce({
        data: {
          available_groups: [
            {
              group_id: "version",
              display: "Version",
              stream_types: ["traces"],
              aliases: { traces: "o2_service_version" },
              recommended: true,
            },
          ],
        },
      } as never);
    };
    const openAt = (where: string) =>
      Object.assign(reactive(routeQuery), {
        panel: "versions",
        panelSvc: "frontend",
        panelWhere: where,
      });

    afterEach(() => {
      for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    });

    it("filters RED charts, Operations, recent spans and resource tables by the escaped where", async () => {
      givenSchema(["service_name", "o2_service_where", "o2_service_version"]);
      openAt(WHERE_A);
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      const predicate = "o2_service_where = 'k8s:c1/o''shop'";

      expect(redQueries(wrapper).length).toBe(3);
      for (const query of redQueries(wrapper)) expect(query).toContain(predicate);
      expect(sqls().find((sql) => sql.includes("GROUP BY operation_name"))).toContain(predicate);

      const tabId = (wrapper.vm as any).activeResourceTabConfigs[0].id;
      (wrapper.vm as any).onTabChange(tabId);
      await flushPromises();
      expect(sqls().find((sql) => sql.includes("o2_service_version as"))).toContain(predicate);

      vi.mocked(searchService.search).mockClear();
      (wrapper.vm as any).operationsViewMode = "spans";
      await flushPromises();
      const spanSqls = sqls().filter((sql) => sql.includes("SELECT operation_name, duration"));
      expect(spanSqls).toHaveLength(2);
      for (const sql of spanSqls) expect(sql).toContain(predicate);
    });

    it("reloads every source query when the where picker moves to a second where", async () => {
      givenSchema(["service_name", "o2_service_where", "o2_service_version"]);
      openAt(WHERE_A);
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      const tabId = (wrapper.vm as any).activeResourceTabConfigs[0].id;
      (wrapper.vm as any).onTabChange(tabId);
      await flushPromises();
      expect((wrapper.vm as any).resourceTabData[tabId]).toEqual([]);
      vi.mocked(searchService.search).mockClear();

      reactive(routeQuery).panelWhere = WHERE_B;
      await flushPromises();

      const predicate = `o2_service_where = '${WHERE_B}'`;
      for (const query of redQueries(wrapper)) {
        expect(query).toContain(predicate);
        expect(query).not.toContain("k8s:c1/");
      }
      expect(sqls().find((sql) => sql.includes("GROUP BY operation_name"))).toContain(predicate);
      expect(sqls().find((sql) => sql.includes("o2_service_version as"))).toContain(predicate);
      expect(sqls().join("\n")).not.toContain("k8s:c1/");
    });

    it("drops a response that lands after the where changed", async () => {
      givenSchema(["service_name", "o2_service_where"]);
      openAt(WHERE_A);
      let release: (value: unknown) => void = () => {};
      vi.mocked(searchService.search).mockImplementation(((req: any) =>
        req.query.query.sql.includes("k8s:c1/")
          ? new Promise((resolve) => (release = resolve))
          : Promise.resolve({
              data: { hits: [{ operation_name: "b-op", request_count: 2 }] },
            })) as never);
      try {
        wrapper = mountPanel();
        await flushPromises();
        await flushPromises();
        reactive(routeQuery).panelWhere = WHERE_B;
        await flushPromises();
        expect(
          sqls().some((sql) => sql.includes("k8s:c1/") && sql.includes("GROUP BY operation_name")),
        ).toBe(true);
        release({ data: { hits: [{ operation_name: "a-op", request_count: 1 }] } });
        await flushPromises();
        expect((wrapper.vm as any).recentOperations.map((op: any) => op.name)).toEqual(["b-op"]);
      } finally {
        vi.mocked(searchService.search).mockReset();
        vi.mocked(searchService.search).mockResolvedValue({ data: { hits: [] } } as never);
      }
    });

    it("holds source queries until the schema settles, then filters", async () => {
      let settle: (value: unknown) => void = () => {};
      getStreamMock.mockImplementationOnce(() => new Promise((resolve) => (settle = resolve)));
      openAt(WHERE_B);
      wrapper = mountPanel();
      await flushPromises();
      expect(sqls().filter((sql) => sql.includes("service_name = 'frontend'"))).toEqual([]);
      expect(redQueries(wrapper)).toEqual([]);

      settle({ schema: [{ name: "o2_service_where", type: "keyword" }] });
      await flushPromises();
      await flushPromises();
      expect(sqls().find((sql) => sql.includes("GROUP BY operation_name"))).toContain(
        `o2_service_where = '${WHERE_B}'`,
      );
      for (const query of redQueries(wrapper)) expect(query).toContain("o2_service_where");
    });

    it("skips the predicate on a stream without o2_service_where", async () => {
      givenSchema(["service_name"]);
      openAt(WHERE_B);
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      const ops = sqls().find((sql) => sql.includes("GROUP BY operation_name"));
      expect(ops).toContain("service_name = 'frontend'");
      expect(ops).not.toContain("o2_service_where");
      expect(redQueries(wrapper).length).toBe(3);
    });

    it("drops the where on a failed schema read and says the view is not scoped", async () => {
      getStreamMock.mockRejectedValueOnce(new Error("schema down"));
      openAt(WHERE_B);
      wrapper = mountPanel();
      await flushPromises();
      await flushPromises();
      const ops = sqls().find((sql) => sql.includes("GROUP BY operation_name"));
      expect(ops).toContain("service_name = 'frontend'");
      expect(sqls().join("\n")).not.toContain("o2_service_where");
      expect(redQueries(wrapper).length).toBe(3);
      for (const query of redQueries(wrapper)) expect(query).not.toContain("o2_service_where");
      const notice = wrapper.find('[data-test="svcver-panel-where-unscoped"]');
      expect(notice.exists()).toBe(true);
      expect(notice.text()).toContain("are not scoped to");
    });

    it("keeps loading scoped queries after switching to another node", async () => {
      getStreamMock.mockResolvedValue({ schema: [{ name: "o2_service_where", type: "keyword" }] });
      openAt(WHERE_B);
      try {
        wrapper = mountPanel();
        await flushPromises();
        await flushPromises();
        vi.mocked(searchService.search).mockClear();
        await wrapper.setProps({
          selectedNode: { ...baseNode, id: "cart", name: "cart", label: "cart" },
        });
        await flushPromises();
        await flushPromises();
        const ops = sqls().find((sql) => sql.includes("GROUP BY operation_name"));
        expect(ops).toContain("service_name = 'cart'");
        expect(ops).toContain(`o2_service_where = '${WHERE_B}'`);
        expect(redQueries(wrapper)[0]).toContain("service_name = 'cart'");
        expect(getStreamMock.mock.calls.length).toBeGreaterThan(1);
      } finally {
        getStreamMock.mockResolvedValue({ schema: [] });
      }
    });

    it("ignores a late schema read for the previous stream", async () => {
      let settleA: (value: unknown) => void = () => {};
      getStreamMock.mockImplementation((name: string) =>
        name === "stream_a"
          ? new Promise((resolve) => (settleA = resolve))
          : Promise.resolve({ schema: [{ name: "o2_service_where", type: "keyword" }] }),
      );
      openAt(WHERE_B);
      try {
        wrapper = mountPanel({ streamFilter: "stream_a" });
        await flushPromises();
        await wrapper.setProps({ streamFilter: "stream_b" });
        await flushPromises();
        await flushPromises();
        for (const query of redQueries(wrapper)) expect(query).toContain(WHERE_B);
        vi.mocked(searchService.search).mockClear();

        settleA({ schema: [{ name: "service_name", type: "keyword" }] });
        await flushPromises();
        await flushPromises();
        expect((wrapper.vm as any).streamFieldSet.has("o2_service_where")).toBe(true);
        for (const sql of sqls().filter((sql) => sql.includes("service_name = 'frontend'")))
          expect(sql).toContain(`o2_service_where = '${WHERE_B}'`);
        expect(redQueries(wrapper).length).toBe(3);
        for (const query of redQueries(wrapper)) expect(query).toContain(WHERE_B);
      } finally {
        getStreamMock.mockReset();
        getStreamMock.mockResolvedValue({ schema: [] });
      }
    });

    it("ignores a late schema failure for the previous stream", async () => {
      let failA: (reason: unknown) => void = () => {};
      getStreamMock.mockImplementation((name: string) =>
        name === "stream_a"
          ? new Promise((_resolve, reject) => (failA = reject))
          : Promise.resolve({ schema: [{ name: "o2_service_where", type: "keyword" }] }),
      );
      openAt(WHERE_B);
      try {
        wrapper = mountPanel({ streamFilter: "stream_a" });
        await flushPromises();
        await wrapper.setProps({ streamFilter: "stream_b" });
        await flushPromises();
        await flushPromises();
        failA(new Error("schema down"));
        await flushPromises();
        await flushPromises();
        expect(wrapper.find('[data-test="svcver-panel-where-unscoped"]').exists()).toBe(false);
        expect(redQueries(wrapper).length).toBe(3);
        for (const query of redQueries(wrapper)) expect(query).toContain(WHERE_B);
      } finally {
        getStreamMock.mockReset();
        getStreamMock.mockResolvedValue({ schema: [] });
      }
    });

    it("re-reads the schema on an org switch and ignores the old org's late read", async () => {
      const orgState = store.state.selectedOrganization as { identifier: string };
      const firstOrg = orgState.identifier;
      let settleFirst: (value: unknown) => void = () => {};
      getStreamMock.mockImplementation(() =>
        orgState.identifier === firstOrg
          ? new Promise((resolve) => (settleFirst = resolve))
          : Promise.resolve({ schema: [{ name: "o2_service_where", type: "keyword" }] }),
      );
      openAt(WHERE_B);
      try {
        wrapper = mountPanel();
        await flushPromises();
        orgState.identifier = `${firstOrg}-other`;
        await flushPromises();
        await flushPromises();
        settleFirst({ schema: [{ name: "service_name", type: "keyword" }] });
        await flushPromises();
        await flushPromises();
        expect((wrapper.vm as any).streamFieldSet.has("o2_service_where")).toBe(true);
        for (const query of redQueries(wrapper)) expect(query).toContain(WHERE_B);
      } finally {
        orgState.identifier = firstOrg;
        getStreamMock.mockReset();
        getStreamMock.mockResolvedValue({ schema: [] });
      }
    });

    it("leaves inferred nodes unscoped", async () => {
      openAt(WHERE_B);
      wrapper = mountPanel({
        selectedNode: { ...baseNode, service_type: "database", service_system: "mysql" },
      });
      await flushPromises();
      await flushPromises();
      expect(sqls().join("\n")).not.toContain("o2_service_where");
    });
  });
});

describe("ServiceGraphNodeSidePanel — license locks", () => {
  let wrapper: VueWrapper;
  const LOGS_ITEM = '[data-test="service-graph-node-panel-view-related-logs-btn"]';
  const DB_ITEM = '[data-test="service-graph-node-panel-view-related-databases-btn"]';
  const TRACES_ITEM = '[data-test="service-graph-node-panel-view-related-traces-btn"]';
  const METRICS_TAB = '[data-test="service-graph-node-panel-tab-metrics"]';

  afterEach(() => {
    wrapper?.unmount();
    delete store.state.zoConfig.features;
    vi.clearAllMocks();
  });

  it("locks the metrics tab and related logs without any correlation call when correlation is locked", async () => {
    getStreamMock.mockResolvedValueOnce({ schema: [{ name: "service_name", type: "keyword" }] });
    store.state.zoConfig.features = { correlation: "locked" };
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    await wrapper.find(METRICS_TAB).trigger("click");
    await flushPromises();
    expect(wrapper.find(METRICS_TAB).attributes("suffix-icon")).toBe("lock");
    expect(
      wrapper.find('[data-test="service-graph-side-panel-metrics-license-denied"]').exists(),
    ).toBe(true);
    expect(wrapper.find(LOGS_ITEM).attributes("disabled")).toBeDefined();
    await wrapper.find(LOGS_ITEM).trigger("click");
    await flushPromises();
    expect(correlateStreams).not.toHaveBeenCalled();
    expect(getDimensionAnalytics).not.toHaveBeenCalled();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("keeps the correlation calls when correlation is enabled", async () => {
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    await wrapper.find(METRICS_TAB).trigger("click");
    await flushPromises();
    expect(wrapper.find(METRICS_TAB).attributes("suffix-icon")).toBeUndefined();
    expect(correlateStreams).toHaveBeenCalled();
  });

  it("shows the related-databases item locked and does not navigate when db_monitoring is locked", async () => {
    store.state.zoConfig.features = { db_monitoring: "locked" };
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    expect(wrapper.find(DB_ITEM).attributes("disabled")).toBeDefined();
    await wrapper.find(DB_ITEM).trigger("click");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("locks the related-logs item and does not navigate when logs is locked", async () => {
    store.state.zoConfig.features = { logs: "locked" };
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    expect(wrapper.find(LOGS_ITEM).attributes("disabled")).toBeDefined();
    await wrapper.find(LOGS_ITEM).trigger("click");
    await flushPromises();
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("locks the related-traces item when traces is locked and leaves it live otherwise", async () => {
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    expect(wrapper.find(TRACES_ITEM).attributes("disabled")).toBe("false");
    wrapper.unmount();
    store.state.zoConfig.features = { traces: "locked" };
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    expect(wrapper.find(TRACES_ITEM).attributes("disabled")).toBe("true");
    await wrapper.find(TRACES_ITEM).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("view-traces")).toBeUndefined();
  });

  it("emits view-traces from View traces and row clicks only while traces is licensed", async () => {
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    const vm = wrapper.vm as any;
    vm.viewInTraces();
    vm.navigateToTraces({ operationName: "GET /" });
    expect(wrapper.emitted("view-traces")).toHaveLength(2);
    wrapper.unmount();

    store.state.zoConfig.features = { traces: "locked" };
    wrapper = mountPanel({ streamFilter: "default" });
    await flushPromises();
    (wrapper.vm as any).viewInTraces();
    (wrapper.vm as any).navigateToTraces({ operationName: "GET /" });
    expect(wrapper.emitted("view-traces")).toBeUndefined();
  });
});
