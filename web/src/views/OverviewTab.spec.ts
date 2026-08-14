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
    props: ["autoApply", "menuAlign", "defaultType", "defaultAbsoluteTime", "defaultRelativeTime"],
    emits: ["on:date-change"],
    template: '<div data-test="overview-date-time-stub" />',
  },
}));
vi.mock("@/lib/core/RefreshButton/ORefreshButton.vue", () => ({
  default: {
    name: "ORefreshButton",
    props: ["lastRunAt", "loading", "disabled"],
    emits: ["click"],
    template: '<button data-test="overview-refresh-btn-stub" @click="$emit(\'click\')" />',
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

// OverviewTab renders only O2 `lib` components.

// ── Local helpers ────────────────────────────────────────────────────────────

type SectionKey = "incidents" | "services" | "anomalies" | "recentEvents";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A promise whose settlement the test controls — lets one section hang while
 *  the others resolve, which is how the interleaving tests below are staged. */
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
 * `hasAnyData` / `isLoading` / `sectionState` are `<script setup>` bindings with
 * no public API. Reading them is how we pin the state machine itself: a
 * template-only assertion cannot tell "computed returns false" from "identifier
 * was deleted and silently evaluates to undefined".
 */
const internals = (w: VueWrapper) =>
  w.vm as unknown as {
    hasAnyData: boolean;
    isLoading: boolean;
    sectionState: Record<SectionKey, { loading: boolean; loaded: boolean }>;
  };

describe("OverviewTab", () => {
  let wrapper: VueWrapper;
  let orgSeq = 0;
  let originalZoConfig: Record<string, unknown>;
  let originalFlags: { isEnterprise: string; isCloud: string };

  const EMPTY_STATE = '[data-test="overview-all-clear-empty-state"]';
  const RECENT_EVENTS = '[data-test="overview-recent-events-section"]';
  const ANOMALIES = '[data-test="overview-anomalies-section"]';
  const INCIDENTS = '[data-test="overview-incidents-section"]';
  const SERVICES = '[data-test="overview-services-section"]';
  const REFRESH_BTN = '[data-test="overview-refresh-btn-stub"]';

  const skeletonOf = (section: SectionKey) => `[data-test="overview-skeleton-${section}"]`;

  /**
   * Every skeleton currently on screen, by section. Asserted against an exact
   * array rather than `.exists() === false` per selector: a prefix query keeps
   * working if the sections are renamed, so a typo'd selector can't quietly
   * turn a "no skeleton" assertion into a vacuous pass.
   */
  const visibleSkeletons = () =>
    wrapper
      .findAll('[data-test^="overview-skeleton-"]')
      .map((s) => s.attributes("data-test")?.replace("overview-skeleton-", ""));

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

  /** Make the anomalies fetch hang until the returned deferred is resolved. */
  const givenAnomaliesHang = () => {
    const pending = deferred<{ data: unknown[] }>();
    vi.mocked(anomalyService.list).mockReturnValue(pending.promise as never);
    return pending;
  };

  /** Make the recent-events fetch hang until the returned deferred is resolved. */
  const givenRecentEventsHang = () => {
    const pending = deferred<{ data: { hits: unknown[] } }>();
    vi.mocked(alertsService.getHistory).mockReturnValue(pending.promise as never);
    return pending;
  };

  beforeEach(() => {
    originalZoConfig = { ...store.state.zoConfig };

    // Pin the build flags to OSS. `config` is built from import.meta.env, and
    // this repo's .env sets VITE_OPENOBSERVE_ENTERPRISE=true — so without this
    // the suite would inherit whatever the local/CI .env happens to say and
    // silently change which sections exist. The enterprise-gated branches get
    // their own describe below, which opts in explicitly.
    originalFlags = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
    config.isEnterprise = "false";
    config.isCloud = "false";

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
    config.isEnterprise = originalFlags.isEnterprise;
    config.isCloud = originalFlags.isCloud;
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

    it("should not render any skeleton when loading finished with no data", () => {
      expect(visibleSkeletons()).toEqual([]);
    });

    it("should not render any content section when there is no data", () => {
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(wrapper.find(ANOMALIES).exists()).toBe(false);
    });
  });

  describe("first load with every section still in flight", () => {
    let anomaliesPending: Deferred<{ data: unknown[] }>;
    let recentEventsPending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(async () => {
      // Recreated per test — a describe-scoped deferred would already be
      // settled by the time the second test mounts.
      anomaliesPending = givenAnomaliesHang();
      recentEventsPending = givenRecentEventsHang();
      wrapper = mountOverviewTab();
      await nextTick();
    });

    afterEach(() => {
      anomaliesPending.resolve({ data: [] });
      recentEventsPending.resolve({ data: { hits: [] } });
    });

    it("should render a skeleton for each pending section when nothing has landed yet", () => {
      expect(internals(wrapper).isLoading).toBe(true);
      expect(internals(wrapper).hasAnyData).toBe(false);
      // incidents/services are enterprise-gated and absent on OSS.
      expect(visibleSkeletons()).toEqual(["anomalies", "recentEvents"]);
    });

    it("should not render the empty state while the first load is in flight", () => {
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
    });
  });

  // ── The bug this block exists for ─────────────────────────────────────────
  // The four datasets are fetched concurrently and land at different times. A
  // single global placeholder gated on `hasAnyData` dies the moment the FIRST
  // dataset arrives, so the sections still in flight go blank and then pop in.
  // Each section must hold its own placeholder until its own data lands.
  describe("sections resolve independently", () => {
    let anomaliesPending: Deferred<{ data: unknown[] }>;

    beforeEach(async () => {
      // Recent events resolves immediately with rows; anomalies hangs.
      givenRecentEvents();
      anomaliesPending = givenAnomaliesHang();
      wrapper = mountOverviewTab();
      await flushPromises();
    });

    afterEach(() => {
      anomaliesPending.resolve({ data: [] });
    });

    it("should render the anomalies skeleton while anomalies are in flight and recent events have landed", () => {
      // The exact user complaint: content and placeholder coexist. Under a
      // global `isLoading && !hasAnyData` gate the arrival of recentEvents
      // flips hasAnyData true and this skeleton vanishes.
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).text()).toContain("High error rate");
      expect(wrapper.find(skeletonOf("anomalies")).exists()).toBe(true);
    });

    it("should still be loading with data on screen while one section is pending", () => {
      expect(internals(wrapper).isLoading).toBe(true);
      expect(internals(wrapper).hasAnyData).toBe(true);
    });

    it("should not render a skeleton for the section that already landed", () => {
      expect(visibleSkeletons()).toEqual(["anomalies"]);
      expect(internals(wrapper).sectionState.recentEvents).toEqual({
        loading: false,
        loaded: true,
      });
      expect(internals(wrapper).sectionState.anomalies).toEqual({
        loading: true,
        loaded: false,
      });
    });

    it("should swap the anomalies skeleton for its content when the fetch resolves", async () => {
      vi.mocked(anomalyService.list).mockResolvedValue({
        data: mockOverview.anomalyConfigs,
      } as never);
      vi.mocked(anomalyService.getAllHistory).mockResolvedValue({
        data: mockOverview.buildAnomalyHistory(),
      } as never);
      anomaliesPending.resolve({ data: mockOverview.anomalyConfigs });
      await flushPromises();

      expect(visibleSkeletons()).toEqual([]);
      expect(wrapper.find(ANOMALIES).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
    });
  });

  describe("a section that completed with an empty result", () => {
    let anomaliesPending: Deferred<{ data: unknown[] }>;

    beforeEach(async () => {
      givenRecentEvents();
      anomaliesPending = givenAnomaliesHang();
      wrapper = mountOverviewTab();
      await flushPromises();
    });

    afterEach(() => {
      anomaliesPending.resolve({ data: [] });
    });

    it("should not render a skeleton once the section resolves empty", async () => {
      expect(wrapper.find(skeletonOf("anomalies")).exists()).toBe(true);

      anomaliesPending.resolve({ data: [] });
      await flushPromises();

      // Empty is a legitimate answer — `loaded` is true, so it never
      // re-skeletons even though the section renders nothing.
      expect(internals(wrapper).sectionState.anomalies).toEqual({
        loading: false,
        loaded: true,
      });
      expect(wrapper.find(ANOMALIES).exists()).toBe(false);
      expect(visibleSkeletons()).toEqual([]);
    });
  });

  // ── The original regression ───────────────────────────────────────────────
  // The skeleton is a first-load placeholder, not a refresh spinner. When it
  // was gated on `isLoading` alone, refreshing with rows on screen rendered the
  // skeleton BELOW them instead of standing in for them.
  describe("refreshing with data already on screen", () => {
    let pending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(async () => {
      givenRecentEvents();
      wrapper = mountOverviewTab();
      await flushPromises();

      // Second fetch never settles — freezes the component mid-refresh.
      pending = givenRecentEventsHang();
      await wrapper.find(REFRESH_BTN).trigger("click");
      await nextTick();
    });

    afterEach(() => {
      pending.resolve({ data: { hits: [] } });
    });

    it("should not render any skeleton when refreshing with data already on screen", () => {
      expect(internals(wrapper).isLoading).toBe(true);
      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(visibleSkeletons()).toEqual([]);
    });

    it("should keep the existing rows on screen while refreshing", () => {
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).text()).toContain("High error rate");
    });

    it("should not render the empty state while refreshing with data on screen", () => {
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
    });

    it("should pass the refresh loading state to the refresh button instead of a skeleton", () => {
      const refreshBtn = wrapper.findComponent({ name: "ORefreshButton" });
      expect(refreshBtn.exists()).toBe(true);
      expect(refreshBtn.props("loading")).toBe(true);
    });
  });

  // This is the ONLY arrangement that exercises the `!loaded` half of
  // `isSectionPending`. A non-empty section renders its own `v-if` branch, so
  // its `v-else-if` skeleton is unreachable no matter what the flag says — the
  // section must be EMPTY (so the else-if is live) AND re-fetching. Anomalies
  // can't be used: its cache short-circuits an unchanged window on refresh, so
  // it never re-enters `loading`.
  describe("refreshing a section that previously resolved empty", () => {
    let recentEventsPending: Deferred<{ data: { hits: unknown[] } }>;

    beforeEach(async () => {
      // First load: anomalies has rows (so content is on screen), recent events
      // legitimately empty.
      vi.mocked(anomalyService.list).mockResolvedValue({
        data: mockOverview.anomalyConfigs,
      } as never);
      vi.mocked(anomalyService.getAllHistory).mockResolvedValue({
        data: mockOverview.buildAnomalyHistory(),
      } as never);
      wrapper = mountOverviewTab();
      await flushPromises();

      // Refresh: the recent-events fetch hangs, leaving that empty section
      // loading-but-already-loaded.
      recentEventsPending = givenRecentEventsHang();
      await wrapper.find(REFRESH_BTN).trigger("click");
      await nextTick();
    });

    afterEach(() => {
      recentEventsPending.resolve({ data: { hits: [] } });
    });

    it("should not re-render a skeleton for a section that already resolved empty", () => {
      // Preconditions: anomalies holds content, recent events is empty.
      expect(wrapper.find(ANOMALIES).exists()).toBe(true);
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);

      // Empty is a legitimate answer, so `loaded` stays true and the section
      // must not fall back to its placeholder while re-fetching.
      expect(internals(wrapper).sectionState.recentEvents).toEqual({
        loading: true,
        loaded: true,
      });
      expect(visibleSkeletons()).toEqual([]);
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

    it("should never render a skeleton or the empty state alongside content across the refresh lifecycle", async () => {
      givenRecentEvents();
      wrapper = mountOverviewTab();
      await flushPromises();

      // Phase 1 — loaded with data: content only.
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(visibleSkeletons()).toEqual([]);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);

      // Phase 2 — refreshing with data: still content only.
      vi.mocked(alertsService.getHistory).mockReturnValue(pending.promise as never);
      await wrapper.find(REFRESH_BTN).trigger("click");
      await nextTick();
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(true);
      expect(visibleSkeletons()).toEqual([]);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);

      // Phase 3 — refresh returns nothing: empty state replaces the content.
      pending.resolve({ data: { hits: [] } });
      await flushPromises();
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(visibleSkeletons()).toEqual([]);
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
      expect(wrapper.find(ANOMALIES).text()).toContain("Checkout latency anomaly");
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
      expect(visibleSkeletons()).toEqual([]);
    });

    it("should not count a failed alert history fetch as data", async () => {
      vi.mocked(alertsService.getHistory).mockRejectedValue(new Error("history unavailable"));

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(false);
      expect(wrapper.find(RECENT_EVENTS).exists()).toBe(false);
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(true);
      // A rejected fetch must still mark the section loaded, or it skeletons
      // forever.
      expect(internals(wrapper).sectionState.recentEvents).toEqual({
        loading: false,
        loaded: true,
      });
      expect(visibleSkeletons()).toEqual([]);
    });
  });

  describe("enterprise sections", () => {
    beforeEach(() => {
      // `config` is a plain object read by the `isEnterpriseOrCloud` computed on
      // first render; flipping it before mount is the only way to reach the
      // enterprise-gated branches. The outer afterEach restores it.
      config.isEnterprise = "true";
      store.commit("setConfig", {
        ...store.state.zoConfig,
        incidents_enabled: true,
      });
    });

    it("should count incidents as data when the incident list returns rows", async () => {
      vi.mocked(incidentsService.list).mockResolvedValue({
        data: mockOverview.buildIncidentList(),
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(internals(wrapper).hasAnyData).toBe(true);
      expect(wrapper.find(INCIDENTS).exists()).toBe(true);
      expect(wrapper.find(INCIDENTS).text()).toContain("Checkout service degraded");
      expect(wrapper.find(EMPTY_STATE).exists()).toBe(false);
      expect(visibleSkeletons()).toEqual([]);
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
      expect(visibleSkeletons()).toEqual([]);
    });

    it("should render only the incidents skeleton when the incident list alone is in flight", async () => {
      const pending = deferred<{ data: { incidents: unknown[] } }>();
      vi.mocked(incidentsService.list).mockReturnValue(pending.promise as never);
      vi.mocked(serviceGraphService.getCurrentTopology).mockResolvedValue({
        data: mockOverview.serviceGraphTopology,
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      // Services landed and render content; incidents still holds its shape.
      expect(visibleSkeletons()).toEqual(["incidents"]);
      expect(wrapper.find(SERVICES).exists()).toBe(true);

      pending.resolve({ data: { incidents: [] } });
      await flushPromises();
      expect(visibleSkeletons()).toEqual([]);
    });

    it("should render only the services skeleton when the topology alone is in flight", async () => {
      const pending = deferred<{ data: { nodes: unknown[]; edges: unknown[] } }>();
      vi.mocked(serviceGraphService.getCurrentTopology).mockReturnValue(pending.promise as never);
      vi.mocked(incidentsService.list).mockResolvedValue({
        data: mockOverview.buildIncidentList(),
      } as never);

      wrapper = mountOverviewTab();
      await flushPromises();

      expect(visibleSkeletons()).toEqual(["services"]);
      expect(wrapper.find(INCIDENTS).exists()).toBe(true);

      pending.resolve({ data: { nodes: [], edges: [] } });
      await flushPromises();
      expect(visibleSkeletons()).toEqual([]);
    });
  });
});
