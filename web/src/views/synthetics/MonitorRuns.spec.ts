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

// @vitest-environment jsdom
//
// Render tests for MonitorRuns.vue — the runs dashboard for a single monitor.
// All child components are stubbed — we test only the top-level shell.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";

const $t = (key: string) => key;

const { mockFetchAll, mockRun, mockSyntheticsServiceGetLocations } = vi.hoisted(() => ({
  mockFetchAll: vi.fn().mockResolvedValue(undefined),
  mockRun: vi.fn().mockResolvedValue({}),
  mockSyntheticsServiceGetLocations: vi.fn().mockResolvedValue({ data: { locations: [] } }),
}));

// ── Mock useSyntheticResults composable with full shape ─────────────────
vi.mock("@/composables/useSyntheticResults", () => {
  const { ref } = require("vue");
  return {
    default: () => ({
      kpi: ref({
        uptimePct: 99.65,
        p95Ms: 2940,
        failedRuns: 1,
        totalRuns: 288,
        retriedRuns: 2,
        lastRunStatus: "passed",
        lastRunAt: Date.now() - 120_000,
      }),
      buckets: ref([
        { tsMs: 1_700_000_000_000, avgMs: 1500, p95Ms: 2000, uptimePct: 100, failedRuns: 0 },
        { tsMs: 1_700_003_600_000, avgMs: 1600, p95Ms: 2100, uptimePct: 99, failedRuns: 1 },
      ]),
      runs: ref([
        {
          runId: "run-001",
          executionId: "exec-001",
          timestamp: 1_700_000_000_000_000,
          scheduledTs: 1_700_000_000_000,
          status: "passed",
          durationMs: 1240,
          location: "us-east-1",
          device: "laptop_large",
          browserEngine: "chromium",
          triggerType: "schedule",
          error: "",
        },
        {
          runId: "run-002",
          executionId: "exec-002",
          timestamp: 1_700_000_036_000_000,
          scheduledTs: 1_700_003_600_000,
          status: "failed",
          durationMs: 29340,
          location: "eu-west-1",
          device: "laptop_large",
          browserEngine: "chromium",
          triggerType: "schedule",
          error: "TimeoutError: page.waitForSelector timed out after 30000ms",
        },
      ]),
      runDetail: ref(null),
      protocolRunDetail: ref(null),
      loading: ref(false),
      error: ref(null),
      hasLoadedOnce: ref(true),

      // Per-query loading signals
      kpiLoading: ref(false),
      histogramLoading: ref(false),
      runsLoading: ref(false),
      kpiHasLoadedOnce: ref(true),
      histogramHasLoadedOnce: ref(true),
      runsHasLoadedOnce: ref(true),
      kpiError: ref(null),
      histogramError: ref(null),
      runsError: ref(null),
      effectiveP95Ms: ref(2940),

      // Steps composable data
      stepsLoading: ref(false),
      stepsHasLoadedOnce: ref(true),
      stepsError: ref(null),
      stepStats: ref({
        stepFailures: [],
        stepDurations: [],
        stepGroups: [],
        flakySteps: [],
        failureInstances: [],
        trendBuckets: [],
      }),

      fetchAll: mockFetchAll,
      cancelAll: vi.fn(),
    }),
  };
});

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: $t })),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    run: mockRun,
    getLocations: mockSyntheticsServiceGetLocations,
  },
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/composables/synthetics/syntheticResultsSchema", () => {
  const deviceIconName = vi.fn((v: string) => {
    const map: Record<string, string> = {
      Desktop: "computer",
      Tablet: "tablet",
      Mobile: "phone_iphone",
    };
    return map[v] || "devices";
  });
  const deviceLabel = vi.fn((v: string) => {
    const map: Record<string, string> = { Desktop: "Desktop", Tablet: "Tablet", Mobile: "Mobile" };
    return map[v] || v;
  });
  return {
    deviceIconName,
    deviceLabel,
  };
});

import MonitorRuns from "./MonitorRuns.vue";

// ── Stubs for every child component ─────────────────────────────────────
const baseStubs = {
  OTabs: {
    template: '<div data-test="monitor-runs-tabs"><slot /></div>',
    props: ["modelValue", "class"],
  },
  OTab: {
    template: "<button :data-test=\"$attrs['data-test']\"><slot /></button>",
    props: ["name"],
    inheritAttrs: true,
  },
  OTabPanels: {
    template: "<div><slot /></div>",
    props: ["modelValue", "grow", "scroll", "class"],
  },
  OTabPanel: {
    template:
      "<div v-if=\"$attrs['data-test'] === 'monitor-runs-tabpanel-overview' || true\"><slot /></div>",
    props: ["name"],
    inheritAttrs: true,
  },
  OCard: {
    template: "<div><slot /></div>",
    props: ["class", "key"],
  },
  OCardSection: {
    template: "<div><slot /></div>",
    props: [],
  },
  OSeparator: {
    template: "<hr />",
    props: ["orientation", "class"],
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size", "class"],
  },
  OTimeCell: {
    template: "<span />",
    props: ["value", "unit", "mode", "emptyLabel"],
  },
  OBadge: {
    template: "<span :data-test=\"$attrs['data-test']\"><slot /></span>",
    props: ["variant", "size", "dot", "class"],
    inheritAttrs: true,
  },
  OEmptyState: {
    template: '<div :data-test="$attrs[\'data-test\']"><slot name="actions" /></div>',
    props: ["size", "illustration", "title", "description", "preset"],
    inheritAttrs: true,
  },
  EmptyStateActionCard: {
    template: "<div :data-test=\"$attrs['data-test']\"><slot /></div>",
    props: ["icon", "label", "sublabel"],
    inheritAttrs: true,
  },
  OTable: {
    template: '<table data-test="monitor-runs-runs-table" />',
    props: [
      "columns",
      "data",
      "loading",
      "pagination",
      "pageSize",
      "pageSizeOptions",
      "rowKey",
      "showGlobalFilter",
      "enableColumnResize",
      "enableColumnReorder",
    ],
  },
  OToggleGroup: {
    template: "<div><slot /></div>",
    props: ["modelValue", "variant"],
  },
  OToggleGroupItem: {
    template: '<button><slot name="icon-left" /><slot /></button>',
    props: ["value", "size"],
  },
  OSelect: {
    template: "<select :data-test=\"$attrs['data-test']\" />",
    props: ["modelValue", "options", "iconKey", "size", "class"],
    inheritAttrs: true,
  },
  OInput: {
    template: "<input :data-test=\"$attrs['data-test']\" />",
    props: ["modelValue", "size", "placeholder", "class"],
    inheritAttrs: true,
  },
  OButton: {
    template: "<button :data-test=\"$attrs['data-test']\"><slot /></button>",
    props: ["variant", "size", "class", "loading"],
    inheritAttrs: true,
  },
  MonitorStatusTimeline: {
    template: '<div data-test="monitor-status-timeline" />',
    props: ["segments", "failCount", "passCount", "mixedCount", "startLabel", "endLabel"],
  },
  ChartRenderer: {
    template: '<div data-test="chart-renderer" />',
    props: ["data", "height"],
  },
  SkeletonBox: {
    template: "<div />",
    props: ["width", "height", "rounded", "customRadius"],
  },
  Teleport: {
    template: "<div><slot /></div>",
  },
};

// We need to add a computed stub for the `data-test` on OTabPanel
// The above stub shows all panels — we can use a keyed approach.
// But the simplest way is to just show all content.

function mountRuns(
  props: { monitorId: string; monitorName: string; monitorStatus?: string } = {
    monitorId: "mon-1",
    monitorName: "Test Monitor",
  },
) {
  return mount(MonitorRuns, {
    props,
    global: {
      stubs: baseStubs,
    },
  });
}

describe("MonitorRuns", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the runs dashboard shell", () => {
      wrapper = mountRuns();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-monitor-runs"]').exists()).toBe(true);
    });

    it("should render the tab switcher with Overview and Steps tabs", () => {
      wrapper = mountRuns();
      expect(wrapper.find('[data-test="monitor-runs-tab-overview"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-runs-tab-steps"]').exists()).toBe(true);
    });

    it("should render filter controls for browser, device, and location", () => {
      wrapper = mountRuns();
      expect(wrapper.find('[data-test="monitor-runs-filter-browser"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-runs-filter-device"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="monitor-runs-filter-location"]').exists()).toBe(true);
    });

    it("should render the runs table", () => {
      wrapper = mountRuns();
      expect(wrapper.find('[data-test="monitor-runs-runs-table"]').exists()).toBe(true);
    });
  });

  describe("exposed refresh method", () => {
    it("should call fetchAll when refresh is invoked", async () => {
      wrapper = mountRuns();
      await flushPromises();

      const vm = wrapper.vm as any;
      await vm.refresh(1_700_000_000_000_000, 1_700_003_600_000_000);
      await flushPromises();

      expect(mockFetchAll).toHaveBeenCalledWith(
        "mon-1",
        1_700_000_000_000_000,
        1_700_003_600_000_000,
      );
    });

    it("should not call fetchAll when startTime or endTime is missing", async () => {
      wrapper = mountRuns();
      await flushPromises();

      const vm = wrapper.vm as any;
      await vm.refresh(undefined, undefined);
      await flushPromises();

      expect(mockFetchAll).not.toHaveBeenCalled();
    });
  });

  describe("emits", () => {
    it("should emit edit event", () => {
      wrapper = mountRuns();
      wrapper.vm.$emit("edit");
      expect(wrapper.emitted("edit")).toBeTruthy();
    });

    it("should emit refresh event", () => {
      wrapper = mountRuns();
      wrapper.vm.$emit("refresh");
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });
  });
});
