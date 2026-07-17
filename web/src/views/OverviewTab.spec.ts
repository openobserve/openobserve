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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import mockOverview from "@/test/unit/mockData/overview";

// ── Module mocks (hoisted — the real modules are never loaded) ───────────────
// Data payloads are wired up per-test in beforeEach so each `it()` owns its
// own state; the factories below stay data-free to survive vi.mock hoisting.

vi.mock("@/services/alerts", () => ({
  default: { getHistory: vi.fn() },
}));
vi.mock("@/services/anomaly_detection", () => ({
  default: { list: vi.fn(), getAllHistory: vi.fn(), getHistory: vi.fn() },
}));
vi.mock("@/services/incidents", () => ({
  default: { list: vi.fn() },
}));
vi.mock("@/services/service_graph", () => ({
  default: { getCurrentTopology: vi.fn() },
}));

// Heavy children — stubbed to keep the suite focused on OverviewTab's own
// render gating. OverviewSkeleton and OEmptyState are deliberately left REAL
// so the assertions below exercise the actual rendered output.
vi.mock("@/components/DateTime.vue", () => ({
  default: {
    name: "DateTime",
    props: [
      "autoApply",
      "menuAlign",
      "defaultType",
      "defaultAbsoluteTime",
      "defaultRelativeTime",
    ],
    emits: ["on:date-change"],
    template: '<div data-test="overview-date-time-stub" />',
  },
}));
vi.mock("@/lib/core/RefreshButton/ORefreshButton.vue", () => ({
  default: {
    name: "ORefreshButton",
    props: ["lastRunAt", "loading", "disabled"],
    emits: ["click"],
    template:
      '<button data-test="overview-refresh-btn-stub" @click="$emit(\'click\')" />',
  },
}));
vi.mock("@/plugins/traces/ServiceGraphNodeSidePanel.vue", () => ({
  default: {
    name: "ServiceGraphNodeSidePanel",
    props: ["selectedNode", "graphData", "timeRange", "visible", "streamFilter"],
    emits: ["close", "view-traces"],
    template: '<div data-test="overview-service-panel-stub" />',
  },
}));
vi.mock("@/components/alerts/AlertHistoryDrawer.vue", () => ({
  default: {
    name: "AlertHistoryDrawer",
    props: ["open", "alertDetails", "alertId", "alertType"],
    emits: ["update:open"],
    template: '<div data-test="overview-alert-history-drawer-stub" />',
  },
}));

import alertsService from "@/services/alerts";
import anomalyService from "@/services/anomaly_detection";
import incidentsService from "@/services/incidents";
import serviceGraphService from "@/services/service_graph";
import config from "@/aws-exports";
import OverviewTab from "./OverviewTab.vue";

// No installQuasar() — OverviewTab renders only O2 `lib` components, no q-*.

// ── Local helpers ────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A promise whose settlement the test controls — used to pin `isLoading`. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mountOverviewTab = () =>
  mount(OverviewTab, {
    global: { plugins: [i18n, store, router] },
  });

/**
 * OverviewTab's `hasAnyData` / `isLoading` are `<script setup>` bindings with no
 * public API. Reading them is how we pin the computed itself: a template-only
 * assertion cannot tell "computed returns false" from "identifier was deleted
 * and silently evaluates to undefined".
 */
const internals = (w: VueWrapper) =>
  w.vm as unknown as { hasAnyData: boolean; isLoading: boolean };

describe("OverviewTab", () => {
  let wrapper: VueWrapper;
  let orgSeq = 0;
  let originalZoConfig: Record<string, unknown>;

  const SKELETON = '[data-test="overview-skeleton"]';
  const EMPTY_STATE = '[data-test="overview-all-clear-empty-state"]';
  const RECENT_EVENTS = '[data-test="overview-recent-events-section"]';
  const ANOMALIES = '[data-test="overview-anomalies-section"]';
  const INCIDENTS = '[data-test="overview-incidents-section"]';
  const SERVICES = '[data-test="overview-services-section"]';
  const REFRESH_BTN = '[data-test="overview-refresh-btn-stub"]';

  /** Resolve every loader with an empty payload — the "no data" baseline. */
  const givenNoData = () => {
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: mockOverview.emptyAlertHistory,
    } as never);
    vi.mocked(anomalyService.list).mockResolvedValue({ data: [] } as never);
    vi.mocked(anomalyService.getAllHistory).mockResolvedValue({
      data: { configs: [] },
    } as never);
    vi.mocked(incidentsService.list).mockResolvedValue({
      data: mockOverview.emptyIncidentList,
    } as never);
    vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
      data: mockOverview.emptyServiceGraphTopology,
    } as never);
  };

  /** Recent Events is the one section that renders on OSS and enterprise alike. */
  const givenRecentEvents = () => {
    vi.mocked(alertsService.getHistory).mockResolvedValue({
      data: mockOverview.buildAlertHistory(),
    } as never);
  };

  beforeEach(() => {
    originalZoConfig = { ...store.state.zoConfig };

    // OverviewTab caches anomaly history in a module-level Map keyed by org id.
    // A unique org per test keeps that cache cold, so no test can inherit
    // another's anomalies.
    store.commit("setSelectedOrganization", {
      ...store.state.selectedOrganization,
      identifier: `overview-org-${++orgSeq}`,
    });
    // The time window is persisted to localStorage; drop it so every mount
    // computes the same fresh relative window.
    localStorage.removeItem("o2_overview_time");

    givenNoData();
  });

  afterEach(() => {
    wrapper?.unmount();
    store.commit("setConfig", originalZoConfig);
    vi.clearAllMocks();
  });

  describe("loaded with no data", () => {
    beforeEach(async () => {
      wrapper = mountOverviewTab();
      await flushPromises();
    });

    it("should render the all-clear empty state when loading finished with no data", () => {
      expect(internals(wrapper).isLoading).toBe(false);
      expect(internals(wrapper).hasAnyData).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(true);
    });

    it("should not render the skeleton when loading finished with no data", () => {
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("should not render any content section when there is no data", () => {
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(wrapper.find(ANOMALIES).exists()).toBe(false);
    });
  });

  describe("loading with no data yet (first load)", () => {
    // Recreated per test — a describe-scoped deferred would already be settled
    // by the time the second test mounts.
    let pending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(async () => {
      pending = deferred<{ data: { hits: unknown[] } }>();
      vi.mocked(alertsService.getHistory).mockReturnValue(
        pending.promise as never,
      );
      wrapper = mountOverviewTab();
      await nextTick();
    });

    afterEach(() => {
      pending.resolve({ data: { hits: [] } });
    });

    it("should render the skeleton when loading with no data yet", () => {
      expect(internals(wrapper).isLoading).toBe(true);
      expect(internals(wrapper).hasAnyData).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(true);
    });

    it("should not render the empty state while the first load is in flight", () => {
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
    });
  });

  describe("loaded with data", () => {
    beforeEach(async () => {
      givenRecentEvents();
      wrapper = mountOverviewTab();
      await flushPromises();
    });

    it("should render the recent events section when the alert history returns hits", () => {
      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).text()).toContain("High error rate");
    });

    it("should render neither the skeleton nor the empty state when loaded with data", () => {
      expect(internals(wrapper).isLoading).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
    });
  });

  // ── The regression this suite exists for ──────────────────────────────────
  // The skeleton is a first-load placeholder, not a refresh spinner. When it
  // was gated on `isLoading` alone, refreshing with rows on screen appended the
  // skeleton BELOW them. `hasAnyData` fixed it; deleting the computed while the
  // template still said `!hasAnyData` silently collapsed the gate back — an
  // undefined template identifier that neither ESLint nor vue-tsc reports.
  describe("refreshing with data already on screen", () => {
    let pending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(async () => {
      pending = deferred<{ data: { hits: unknown[] } }>();
      givenRecentEvents();
      wrapper = mountOverviewTab();
      await flushPromises();

      // Second fetch never settles — freezes the component mid-refresh.
      vi.mocked(alertsService.getHistory).mockReturnValue(
        pending.promise as never,
      );
      await wrapper.find(REFRESH_BTN).trigger("click");
      await nextTick();
    });

    afterEach(() => {
      pending.resolve({ data: { hits: [] } });
    });

    it("should not render the skeleton when refreshing with data already on screen", () => {
      expect(internals(wrapper).isLoading).toBe(true);
      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("should keep the existing rows on screen while refreshing", () => {
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).text()).toContain("High error rate");
    });

    it("should not render the empty state while refreshing with data on screen", () => {
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
    });

    it("should pass the refresh loading state to the refresh button instead of the skeleton", () => {
      const refreshBtn = wrapper.findComponent({ name: "ORefreshButton" });
      expect(refreshBtn.exists()).toBe(true);
      expect(refreshBtn.props("loading")).toBe(true);
    });
  });

  describe("placeholder and content are mutually exclusive", () => {
    let pending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(() => {
      pending = deferred<{ data: { hits: unknown[] } }>();
    });

    afterEach(() => {
      pending.resolve({ data: { hits: [] } });
    });

    it("should never render the skeleton or empty state alongside content across the refresh lifecycle", async () => {
      givenRecentEvents();
      wrapper = mountOverviewTab();
      await flushPromises();

      // Phase 1 — loaded with data: content only.
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);

      // Phase 2 — refreshing with data: still content only.
      vi.mocked(alertsService.getHistory).mockReturnValue(
        pending.promise as never,
      );
      await wrapper.find(REFRESH_BTN).trigger("click");
      await nextTick();
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);

      // Phase 3 — refresh returns nothing: empty state replaces the content.
      pending.resolve({ data: { hits: [] } });
      await flushPromises();
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(true);
    });
  });

  describe("hasAnyData sources", () => {
    it("should count anomalies as data when the anomaly history returns hits", async () => {
      vi.mocked(anomalyService.list).mockResolvedValue({
        data: mockOverview.anomalyConfigs,
      } as never);
      vi.mocked(anomalyService.getAllHistory).mockResolvedValue({
        data: mockOverview.buildAnomalyHistory(),
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(ANOMALIES).exists()).toBe(true);
      expect(wrapper.find(ANOMALIES).text()).toContain(
        "Checkout latency anomaly",
      );
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("should not count a failed alert history fetch as data", async () => {
      vi.mocked(alertsService.getHistory).mockRejectedValue(
        new Error("history unavailable"),
      );

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(false);
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(true);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });
  });

  describe("enterprise sections", () => {
    let originalIsEnterprise: string;

    beforeEach(() => {
      // `config` is a plain object read by the `isEnterpriseOrCloud` computed on
      // first render; flipping it before mount is the only way to reach the
      // enterprise-gated branches.
      originalIsEnterprise = config.isEnterprise;
      config.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        incidents_enabled: true,
      });
    });

    afterEach(() => {
      config.isEnterprise = originalIsEnterprise;
    });

    it("should count incidents as data when the incident list returns rows", async () => {
      vi.mocked(incidentsService.list).mockResolvedValue({
        data: mockOverview.buildIncidentList(),
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(INCIDENTS).exists()).toBe(true);
      expect(wrapper.find(INCIDENTS).text()).toContain(
        "Checkout service degraded",
      );
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("should count services as data when the topology returns nodes", async () => {
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: mockOverview.serviceGraphTopology,
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(SERVICES).exists()).toBe(true);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
      expect(wrapper.find(SKELETON).exists()).toBe(false);
    });

    it("should render the enterprise-shaped skeleton when loading with no data yet", async () => {
      const pending = deferred<{ data: { incidents: unknown[] } }>();
      vi.mocked(incidentsService.list).mockReturnValue(pending.promise as never);

      wrapper = mountOverviewTab();
      await nextTick();

      expect(wrapper.find(SKELETON).exists()).toBe(true);
      expect(
        wrapper.find('[data-test="overview-skeleton-incidents"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="overview-skeleton-services"]').exists(),
      ).toBe(true);

      pending.resolve({ data: { incidents: [] } });
      await flushPromises();
    });
  });
});
