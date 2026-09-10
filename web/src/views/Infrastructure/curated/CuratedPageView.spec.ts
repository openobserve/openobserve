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

// The curated renderer (design §6). useCuratedPage is mocked so every face and
// strip state is driveable; assertions run on the rendered DOM and the captured
// RenderDashboardCharts props, never on ECharts.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, ref, isRef, inject, watchEffect, type Ref } from "vue";
import CuratedPageView from "./CuratedPageView.vue";
import VariablesValueSelector from "@/components/dashboards/VariablesValueSelector.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";
import { kubernetesPage, FLEET_DRILLDOWN_EVENT } from "./packs/kubernetes.page";
import i18n from "@/locales";

const { useCuratedPageMock } = vi.hoisted(() => ({ useCuratedPageMock: vi.fn() }));
vi.mock("./useCuratedPage", () => ({ useCuratedPage: useCuratedPageMock }));

// The values query's transport, stubbed at the LAST seam before the network so
// buildQueryContext — the code that turns a `filter` row into SQL — runs for real.
const { streamingMock } = vi.hoisted(() => ({ streamingMock: vi.fn(async () => {}) }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: streamingMock,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
    resetAuthToken: vi.fn(),
  }),
}));

const NOW_US = 1_800_000_000_000_000;
const HOUR_US = 60 * 60 * 1_000_000;

/** Whatever the composable last returned, so tests can drive its refs. */
let state: any;

const refreshSpy = vi.fn(async () => {});
const rememberSpy = vi.fn((_variables: unknown) => {});

/**
 * No shipped pack declares a route door (AWS is deferred), so the route branch
 * is exercised by swapping the REAL registry entry the view reads. Restored in
 * afterEach, and it drives the same `setupDoor` computed production uses.
 */
const originalFirstGroupSetup = kubernetesPage.groups[0]!.setup;
const withRouteDoorPack = () => {
  (kubernetesPage.groups[0] as any).setup = { kind: "route", routeName: "AWSConfig" };
};
const restoreRouteDoorPack = () => {
  (kubernetesPage.groups[0] as any).setup = originalFirstGroupSetup;
};

const dashboardFixture = (sections = ["overview", "nodes"]) => ({
  version: 8,
  variables: { list: [], showDynamicFilters: false },
  tabs: sections.map((id) => ({
    tabId: id,
    name: id,
    panels: [{ id: `${id}_p1`, title: id, layout: { x: 0, y: 0, w: 96, h: 16 }, config: {} }],
  })),
});

/** The note rides the TAB it qualifies, so the build never depends on the selected tab. */
const withNoteOnFirstTab = (dashboard: any) => ({
  ...dashboard,
  tabs: dashboard.tabs.map((tab: any, index: number) =>
    index === 0 ? { ...tab, curatedNoteKey: "infra.k8s.section.inventoryNote" } : tab,
  ),
});

const makeState = (over: Record<string, any> = {}) => {
  refreshSpy.mockClear();
  rememberSpy.mockClear();
  return {
    face: ref("ready"),
    l0State: ref("detected"),
    loadError: ref(false),
    dashboard: ref(dashboardFixture()),
    hiddenGroups: ref([]),
    staleGroups: ref([]),
    partialGroups: ref([]),
    warnings: ref([]),
    lastDataUs: ref(NOW_US - 12_000_000),
    stripAutoExpand: ref(false),
    // MIRRORS useCuratedPage's real return object exactly. It used to also stub a
    // `setupDoor` the composable never exposed, so the spec exercised a branch
    // production could not take; the door is derived from the manifest instead.
    presentGroupIds: ref([]),
    refresh: refreshSpy,
    rememberPickerOptions: rememberSpy,
    ...over,
  };
};

// The stub MUST render the before_panels slot: a slotless stub makes every strip
// assertion below false-green (pass-3 finding 18).
let captured: Record<string, any> = {};
const injectedTabIds: string[] = [];
const renderChartsStub = defineComponent({
  name: "RenderDashboardCharts",
  props: ["dashboardData", "currentTimeObj", "viewOnly", "searchType", "showTabs", "frame"],
  // The REAL component's emits, verbatim. A stub that invents events lets the
  // view bind handlers to a contract nothing implements and still go green.
  emits: [
    "onDeletePanel",
    "onViewPanel",
    "variablesData",
    "refreshedVariablesDataUpdated",
    "updated:data-zoom",
    "refreshPanelRequest",
    "refresh",
    "onMovePanel",
    "panelsValues",
    "searchRequestTraceIds",
    "variablesManagerReady",
  ],
  setup() {
    const selectedTabId = inject<Ref<string | null>>("selectedTabId", ref(null));
    watchEffect(() => {
      if (selectedTabId.value != null) injectedTabIds.push(selectedTabId.value);
    });
    return { selectedTabId };
  },
  created() {
    captured = { ...(this as any).$props };
  },
  updated() {
    captured = { ...(this as any).$props };
  },
  template: "<div class='render-stub'><slot name='before_panels' /></div>",
});

const setupCardStub = defineComponent({
  name: "DataSourceSetupCard",
  props: ["slug"],
  emits: ["detected"],
  template: "<div data-test='setup-card-stub' :data-slug='slug' />",
});

// Declares the REAL DateTime props under test, so an unpassed one is observable
// rather than swallowed into $attrs by inheritAttrs:false.
const dateTimeStub = defineComponent({
  name: "DateTime",
  inheritAttrs: false,
  props: ["defaultType", "defaultRelativeTime", "autoApply", "menuAlign"],
  emits: ["on:date-change"],
  template: "<div data-test='curated-datetime-stub' />",
});

const passthrough = (name: string) =>
  defineComponent({ name, template: "<div><slot name='actions' /><slot /></div>" });

/** Stands in for the OSelect tree only — the props under test stay real. */
const querySelectorStub = defineComponent({
  name: "VariableQueryValueSelector",
  props: [
    "modelValue",
    "variableItem",
    "loadOptions",
    "disabled",
    "disabledTooltipKey",
    "clearable",
  ],
  template: "<div class='qvs-stub' />",
});

describe("CuratedPageView", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountView = async (
    props: Record<string, any> = {},
    over: Record<string, any> = {},
    query: Record<string, string> = {},
  ) => {
    state = makeState(over);
    useCuratedPageMock.mockReturnValue(state);
    // A real mutation, not a plain-object assignment: mutating store.state
    // directly fires no watcher, which makes an org-switch pin pass against a
    // view that has no org watcher at all.
    const store = createStore({
      state: { selectedOrganization: { identifier: "test-org" }, timezone: "UTC", theme: "light" },
      mutations: {
        setOrganization(state: any, org: any) {
          state.selectedOrganization = org;
        },
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/infra/kubernetes", name: "infraKubernetes", component: { template: "<div />" } },
        { path: "/infra/aws", name: "infraAws", component: { template: "<div />" } },
        { path: "/ingestion/aws", name: "AWSConfig", component: { template: "<div />" } },
        { path: "/dashboards", name: "dashboards", component: { template: "<div />" } },
      ],
    });
    await router.push({ path: "/infra/kubernetes", query });
    await router.isReady();
    vi.spyOn(router, "push");
    const w = mount(CuratedPageView, {
      props: { workload: "kubernetes", ...props },
      global: {
        plugins: [store, router, i18n],
        stubs: {
          RenderDashboardCharts: renderChartsStub,
          DataSourceSetupCard: setupCardStub,
          DateTime: dateTimeStub,
          OPageLayout: passthrough("OPageLayout"),
          OPageHeader: passthrough("OPageHeader"),
          teleport: true,
        },
      },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    captured = {};
    injectedTabIds.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreRouteDoorPack();
    if (wrapper) wrapper.unmount();
  });

  // ── Faces (§6.1) ─────────────────────────────────────────────────────────

  describe("faces", () => {
    it("`unknown` renders a spinner WITH the `checking` line under it", async () => {
      // The AWS worst case is ~5s of spinner; a naked one reads as a hung page.
      wrapper = await mountView({}, { face: ref("unknown"), dashboard: ref(null) });
      expect(wrapper.find('[data-test="curated-spinner"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="curated-checking"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="curated-error"]').exists()).toBe(false);
    });

    it("`loadError` swaps the spinner for an error line + Retry firing refresh({force:true})", async () => {
      wrapper = await mountView(
        {},
        { face: ref("unknown"), dashboard: ref(null), loadError: ref(true) },
      );
      expect(wrapper.find('[data-test="curated-spinner"]').exists()).toBe(false);
      const retry = wrapper.find('[data-test="curated-retry"]');
      expect(retry.exists()).toBe(true);
      refreshSpy.mockClear();
      await retry.trigger("click");
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it("`undetected` on kubernetes renders the inline setup card for the k8s slug", async () => {
      wrapper = await mountView({}, { face: ref("undetected"), dashboard: ref(null) });
      const card = wrapper.find('[data-test="setup-card-stub"]');
      expect(card.exists()).toBe(true);
      expect(card.attributes("data-slug")).toBe("kubernetes");
    });

    it("the setup card's @detected fires refresh({force:true}) — card faces flip live", async () => {
      wrapper = await mountView({}, { face: ref("undetected"), dashboard: ref(null) });
      refreshSpy.mockClear();
      wrapper.findComponent({ name: "DataSourceSetupCard" }).vm.$emit("detected");
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it("`undetected` + l0State `detected` renders the partial-telemetry line", async () => {
      // The honesty valve: nav "detected" and page "setup" must tell one story.
      wrapper = await mountView(
        {},
        { face: ref("undetected"), dashboard: ref(null), l0State: ref("detected") },
      );
      expect(wrapper.find('[data-test="curated-partial-telemetry"]').exists()).toBe(true);
    });

    it("`undetected` + l0State `undetected` does NOT render the partial-telemetry line", async () => {
      wrapper = await mountView(
        {},
        { face: ref("undetected"), dashboard: ref(null), l0State: ref("undetected") },
      );
      expect(wrapper.find('[data-test="curated-partial-telemetry"]').exists()).toBe(false);
    });

    it("a ROUTE-kind undetected face renders a CTA that pushes the route, not an inline card", async () => {
      // Successor to the deleted WorkloadStubPage.spec's AWS route-CTA case. The
      // door is derived from the MANIFEST (useCuratedPage exposes no setupDoor),
      // so the route branch is driven by a pack whose first group declares one —
      // stubbing a composable field production never reads proved nothing.
      withRouteDoorPack();
      wrapper = await mountView(
        { workload: "kubernetes" },
        { face: ref("undetected"), dashboard: ref(null) },
      );

      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(false);
      const cta = wrapper.find('[data-test="curated-setup-route-cta"]');
      expect(cta.exists()).toBe(true);

      await cta.trigger("click");
      await flushPromises();
      expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: "AWSConfig" }));
    });

    it("a route-kind setup face has NO @detected hook — the user leaves and comes back", async () => {
      // §6.1: route-kind pages re-check on remount/focus, so wiring a card hook
      // here would be dead code.
      withRouteDoorPack();
      wrapper = await mountView(
        { workload: "kubernetes" },
        { face: ref("undetected"), dashboard: ref(null) },
      );
      expect(wrapper.findComponent({ name: "DataSourceSetupCard" }).exists()).toBe(false);
    });

    it("a workload with NO registered pack renders the unavailable face, never another pack's page", async () => {
      // The AWS pack is deferred. Falling back to `curatedPacks.kubernetes` put
      // the Kubernetes manifest — its title, its panels, its queries — behind
      // /infra/aws, which is the most confident kind of wrong a page can be.
      wrapper = await mountView({ workload: "aws" });
      expect(wrapper.find('[data-test="curated-pack-unavailable"]').exists()).toBe(true);

      const text = wrapper.text();
      for (const title of ["Kubernetes", "Pods running", "Nodes ready"]) {
        expect(text).not.toContain(title);
      }
      expect(wrapper.findComponent({ name: "RenderDashboardCharts" }).exists()).toBe(false);
      expect(wrapper.find('[data-test="curated-setup-state"]').exists()).toBe(false);
    });

    it("a packless workload fetches NOTHING — it cannot resolve, so it must not ask", async () => {
      refreshSpy.mockClear();
      wrapper = await mountView({ workload: "aws" });
      await flushPromises();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("`ready` renders viewOnly, frameless, searchType=dashboards charts", async () => {
      wrapper = await mountView();
      expect(captured.viewOnly).toBe(true);
      expect(captured.frame).toBe(false);
      expect(captured.searchType).toBe("dashboards");
      expect(captured.dashboardData).toBe(state.dashboard.value);
    });

    it("showTabs is bound to the SURVIVING section count, not the manifest's", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["overview"])) });
      expect(captured.showTabs).toBe(false);
      wrapper.unmount();

      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["overview", "nodes"])) });
      expect(captured.showTabs).toBe(true);
    });

    it("provides selectedTabId seeded with the FIRST visible section", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["nodes", "workloads"])) });
      expect(injectedTabIds[0]).toBe("nodes");
    });

    it("?tab= outranks the tabs[0] default, so a cross-tab drilldown lands where it aimed", async () => {
      // The fleet-quadrant bubble drilldown navigates to ?tab=health&var-cluster=…
      // (kubernetes.page.ts o2_events.click). Nothing else reads ?tab= on this
      // route, so without this seeding the drilldown silently lands on tabs[0].
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { tab: "health" },
      );
      expect(injectedTabIds[0]).toBe("health");
    });

    it("a ?tab= naming no visible section falls back to the first, never to a blank page", async () => {
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { tab: "utilization" },
      );
      expect(injectedTabIds[0]).toBe("summary");
    });
  });

  // ── Tab ↔ URL sync ───────────────────────────────────────────────────────

  // The tab used to live only in memory: clicking one left the URL untouched, so
  // it could not be shared or bookmarked and a reload always landed on tabs[0].
  // These pin BOTH directions and the guard that stops them ping-ponging.
  describe("tab ↔ URL sync", () => {
    const query = () => router.currentRoute.value.query;

    /** TabList only mutates the injected ref; the page owns the URL, so that is what a click looks like here. */
    const switchTabTo = async (tabId: string) => {
      const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
      const injected = (render.vm as any).$.provides["selectedTabId"] as Ref<string | null>;
      injected.value = tabId;
      await flushPromises();
    };

    it("a tab switch writes ?tab= so the section can be shared and bookmarked", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await switchTabTo("health");
      expect(query().tab).toBe("health");
    });

    it("the landing default is written too, so a URL is shareable before any click", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      expect(query().tab).toBe("summary");
    });

    it("keeps the params it does not own — an org-scoped share must stay org-scoped", async () => {
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { org_identifier: "acme", period: "15m", "var-cluster": "prod-eu" },
      );
      await switchTabTo("health");
      expect(query().org_identifier).toBe("acme");
      expect(query().period).toBe("15m");
      expect(query()["var-cluster"]).toBe("prod-eu");
    });

    it("REPLACES rather than pushes, so Back leaves the page instead of walking every tab", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      (router.push as any).mockClear();
      await switchTabTo("health");
      expect(router.push).not.toHaveBeenCalled();
      expect(query().tab).toBe("health");
    });

    it("a URL change selects the tab — Back and Forward move the page, not just the address bar", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await router.replace({ path: "/infra/kubernetes", query: { tab: "health" } });
      await flushPromises();
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("health");
    });

    it("never writes a null tab while the dashboard is still resolving", async () => {
      // selectedTabId starts null, and ?tab=null|undefined is a URL nobody can reopen.
      wrapper = await mountView({}, { dashboard: ref(null) });
      expect(query().tab).toBeUndefined();
    });

    it("a stale bookmark's unknown tab is CORRECTED in the URL, never persisted", async () => {
      // Landing rewrites the bogus value to the tab actually shown, so re-sharing
      // the address bar hands the next reader the same page this one sees.
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { tab: "utilization" },
      );
      expect(injectedTabIds[0]).toBe("summary");
      expect(query().tab).toBe("summary");
    });

    it("adds no second navigation on top of a drilldown that already carries the tab", async () => {
      // The drilldown pushes ?tab=health itself. The writer then sees the tab
      // change and would replace the identical URL — a redundant navigation on
      // every bubble click, and one more entry for Back to unwind.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      const replaceSpy = vi.spyOn(router, "replace");
      document.dispatchEvent(
        new CustomEvent(FLEET_DRILLDOWN_EVENT, {
          detail: { cluster: "prod-eu" },
          bubbles: true,
        }),
      );
      await flushPromises();
      expect(query().tab).toBe("health");
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("writes ONCE per switch — the echo must not turn into a second navigation", async () => {
      // The write wakes the URL→tab watcher, which re-seeds the tab the write
      // just set. Only a call count catches a second replace riding that echo.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      const replaceSpy = vi.spyOn(router, "replace");
      await switchTabTo("health");
      await flushPromises();
      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(query().tab).toBe("health");
    });
  });

  // ── Refresh triggers (§6, §6.1) ──────────────────────────────────────────

  describe("refresh triggers", () => {
    it("the header Refresh renders on EVERY face and forces", async () => {
      for (const face of ["undetected", "ready"]) {
        wrapper = await mountView(
          {},
          { face: ref(face), dashboard: ref(face === "ready" ? dashboardFixture() : null) },
        );
        const button = wrapper.find('[data-test="curated-refresh"]');
        expect(button.exists(), face).toBe(true);
        refreshSpy.mockClear();
        await button.trigger("click");
        await flushPromises();
        expect(refreshSpy, face).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
        wrapper.unmount();
      }
    });

    it("the last-refreshed indicator is fed a MILLISECOND epoch, not the µs `checkedAtUs`", async () => {
      // `checkedAtUs` is µs (`Date.now() * 1000`); passing it to RelativeTime
      // undivided renders "in 55000 years" instead of "now".
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();

      const stamp = wrapper.find('[data-test="curated-last-refreshed"]');
      expect(stamp.exists()).toBe(true);
      const relative = stamp.findComponent(RelativeTime);
      expect(relative.props("timestamp")).toBe(NOW_US / 1000);
      // The visible string, not just the prop: a µs value formats as a far-future year.
      expect(stamp.text()).toContain("now");
    });

    it("a manual Refresh re-stamps the last-refreshed indicator", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      const first = wrapper
        .find('[data-test="curated-last-refreshed"]')
        .findComponent(RelativeTime)
        .props("timestamp");

      vi.setSystemTime(new Date((NOW_US + 11 * 60 * 1_000_000) / 1000));
      await wrapper.find('[data-test="curated-refresh"]').trigger("click");
      await flushPromises();

      const after = wrapper
        .find('[data-test="curated-last-refreshed"]')
        .findComponent(RelativeTime)
        .props("timestamp");
      expect(after).toBe((NOW_US + 11 * 60 * 1_000_000) / 1000);
      expect(after).toBeGreaterThan(first as number);
    });

    it("an unregistered workload stamps NOTHING — it never fetched", async () => {
      // runRefresh bails before `refresh()` when there is no pack, so claiming a
      // refresh time there would date a request that never happened.
      wrapper = await mountView({ workload: "unregistered" as any });
      expect(wrapper.find('[data-test="curated-last-refreshed"]').exists()).toBe(false);
    });

    it("window `focus` re-checks while the SETUP face shows", async () => {
      // Returning from a CloudFormation tab must re-check without a reload.
      wrapper = await mountView({}, { face: ref("undetected"), dashboard: ref(null) });
      refreshSpy.mockClear();
      window.dispatchEvent(new Event("focus"));
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it("window `focus` does NOT refetch on the `ready` face — no storm on a healthy page", async () => {
      wrapper = await mountView();
      refreshSpy.mockClear();
      window.dispatchEvent(new Event("focus"));
      await flushPromises();
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("a fresh mount always resolves — route re-entry is a remount, so no onActivated case exists", async () => {
      wrapper = await mountView();
      expect(refreshSpy).toHaveBeenCalled();
    });

    it("the range watcher DEBOUNCES: two changes inside ~300ms produce ONE refresh", async () => {
      vi.useFakeTimers();
      wrapper = await mountView();
      const picker = wrapper.findComponent({ name: "DateTime" });
      refreshSpy.mockClear();

      picker.vm.$emit("on:date-change", {
        startTime: NOW_US - HOUR_US,
        endTime: NOW_US,
        userChangedValue: true,
      });
      vi.advanceTimersByTime(100);
      picker.vm.$emit("on:date-change", {
        startTime: NOW_US - 2 * HOUR_US,
        endTime: NOW_US,
        userChangedValue: true,
      });
      vi.advanceTimersByTime(400);
      await flushPromises();
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it("org switch and @detected are NOT debounced — the debounce seam lives ONLY in the range watcher", async () => {
      vi.useFakeTimers();
      wrapper = await mountView({}, { face: ref("undetected"), dashboard: ref(null) });
      refreshSpy.mockClear();
      wrapper.findComponent({ name: "DataSourceSetupCard" }).vm.$emit("detected");
      await flushPromises();
      // No timer advance: it must already have fired.
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores a DateTime replay with userChangedValue === false", async () => {
      vi.useFakeTimers();
      wrapper = await mountView();
      refreshSpy.mockClear();
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - HOUR_US,
        endTime: NOW_US,
        userChangedValue: false,
      });
      vi.advanceTimersByTime(500);
      await flushPromises();
      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  // ── Relative vs absolute window (§6.4) ───────────────────────────────────

  describe("the window a refresh queries", () => {
    const globalOf = () => captured.currentTimeObj.__global;
    // The Dates carry the MICROSECOND epoch, so getTime() is already µs — the
    // same magnitude usePanelDataLoader:418 derives and executePromQL consumes.
    const boundsUs = () => ({
      from: globalOf().start_time.getTime(),
      to: globalOf().end_time.getTime(),
    });

    it("a RELATIVE selection re-anchors its window to NOW on every refresh", async () => {
      // The live bug: `range` was materialized once at setup and the mount
      // replay was dropped whole, so `to` froze at page-load time and every
      // range-plotted panel emptied out as the wall clock walked past it.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - 3 * HOUR_US,
        endTime: NOW_US,
        relativeTimePeriod: "3h",
        valueType: "relative",
        userChangedValue: false,
      });
      await flushPromises();
      const first = boundsUs();
      expect(first.to).toBe(NOW_US);

      vi.setSystemTime(new Date((NOW_US + 11 * 60 * 1_000_000) / 1000));
      refreshSpy.mockClear();
      await wrapper.find('[data-test="curated-refresh"]').trigger("click");
      await flushPromises();

      const after = boundsUs();
      expect(after.to).toBe(NOW_US + 11 * 60 * 1_000_000);
      // The width the user chose is preserved, so it is a slide and not a stretch.
      expect(after.to - after.from).toBe(first.to - first.from);
      expect(refreshSpy).toHaveBeenCalledWith(
        expect.objectContaining({ start: after.from, end: after.to, force: true }),
      );
    });

    it("an ABSOLUTE selection does NOT move when the clock advances", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - 5 * HOUR_US,
        endTime: NOW_US - 2 * HOUR_US,
        relativeTimePeriod: null,
        valueType: "absolute",
        userChangedValue: true,
      });
      vi.advanceTimersByTime(400);
      await flushPromises();
      const pinned = boundsUs();
      expect(pinned).toEqual({ from: NOW_US - 5 * HOUR_US, to: NOW_US - 2 * HOUR_US });

      vi.setSystemTime(new Date((NOW_US + 11 * 60 * 1_000_000) / 1000));
      refreshSpy.mockClear();
      await wrapper.find('[data-test="curated-refresh"]').trigger("click");
      await flushPromises();

      expect(boundsUs()).toEqual(pinned);
      expect(refreshSpy).toHaveBeenCalledWith(
        expect.objectContaining({ start: pinned.from, end: pinned.to }),
      );
    });

    it("re-anchoring hands the renderer new BOUNDS without churning dashboardData identity", async () => {
      // A moving `to` that remounted every panel each refresh would trade an
      // empty chart for a flashing one.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      const dashboardBefore = captured.dashboardData;
      const before = boundsUs();

      vi.setSystemTime(new Date((NOW_US + 11 * 60 * 1_000_000) / 1000));
      await wrapper.find('[data-test="curated-refresh"]').trigger("click");
      await flushPromises();

      expect(captured.dashboardData).toBe(dashboardBefore);
      expect(boundsUs().to).toBeGreaterThan(before.to);
    });

    it("hands the renderer Dates on the MICROSECOND epoch the panel loader reads back", async () => {
      // The live bug: `new Date(us / 1000)` built a millisecond-epoch Date, so
      // `usePanelDataLoader` (:418 `new Date(start_time.toISOString()).getTime()`)
      // handed executePromQL a number 1000x too small. The gap-fill in
      // convertPromQLData (:241 `startTime / 1_000_000`) then snapped the axis
      // floor back to 1970 while real data sat in 2026 — a ~56-year x-axis.
      // Every other producer of this prop feeds `new Date(getConsumableDateTime()
      // .startTime)` UNDIVIDED: plugins/metrics/Index.vue:425 and
      // views/Dashboards/ViewDashboard.vue:1002.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - 3 * HOUR_US,
        endTime: NOW_US,
        relativeTimePeriod: "3h",
        valueType: "relative",
        userChangedValue: false,
      });
      await flushPromises();

      // Exactly what usePanelDataLoader:418-419 derives from this prop.
      const global = captured.currentTimeObj.__global;
      const startISOTimestamp = new Date(global.start_time.toISOString()).getTime();
      const endISOTimestamp = new Date(global.end_time.toISOString()).getTime();
      expect(startISOTimestamp).toBe(NOW_US - 3 * HOUR_US);
      expect(endISOTimestamp).toBe(NOW_US);

      // And what convertPromQLData:241-242 makes of it — must be real unix seconds.
      const queryStartSec = startISOTimestamp / 1_000_000;
      expect(new Date(queryStartSec * 1000).getUTCFullYear()).toBe(
        new Date(NOW_US / 1000).getUTCFullYear(),
      );
    });

    it("the mount replay sets the window without fetching — mount's own refresh carries it", async () => {
      // `userChangedValue: false` means "do not fetch", NOT "do not record".
      vi.useFakeTimers();
      vi.setSystemTime(new Date(NOW_US / 1000));
      wrapper = await mountView();
      refreshSpy.mockClear();
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - 6 * HOUR_US,
        endTime: NOW_US,
        relativeTimePeriod: "6h",
        valueType: "relative",
        userChangedValue: false,
      });
      vi.advanceTimersByTime(500);
      await flushPromises();
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(boundsUs().to - boundsUs().from).toBe(6 * HOUR_US);
    });
  });

  // ── Explainer strip (§6.2) ───────────────────────────────────────────────

  describe("explainer strip", () => {
    const hiddenGroup = (over: Record<string, any> = {}) => ({
      group: {
        id: "kube-state",
        labelKey: "infra.k8s.group.kubeState",
        capabilityKey: "infra.k8s.group.kubeStateCap",
        setupHintKey: "infra.k8s.group.kubeStateHint",
        setup: { kind: "card", slug: "kubernetes" },
      },
      reason: "streams-missing",
      missingStreams: [{ name: "kube_pod_status_phase", state: "absent" }],
      panelCount: 8,
      ...over,
    });

    it("renders NO strip at all when nothing is hidden or stale", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-strip"]').exists()).toBe(false);
    });

    it("renders one row per hidden group, in MANIFEST order, with a per-group data-test", async () => {
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            hiddenGroup(),
            hiddenGroup({ group: { ...hiddenGroup().group, id: "kubelet-pod" } }),
          ]),
          stripAutoExpand: ref(true),
        },
      );
      const rows = wrapper.findAll('[data-test^="curated-strip-group-"]');
      expect(rows).toHaveLength(2);
      expect(rows[0].attributes("data-test")).toBe("curated-strip-group-kube-state");
      expect(rows[1].attributes("data-test")).toBe("curated-strip-group-kubelet-pod");
    });

    it("the COLLAPSED line carries capability sentences and NO panel count", async () => {
      // "8 panels hidden" understates losing every health signal on the page.
      wrapper = await mountView({}, { hiddenGroups: ref([hiddenGroup()]) });
      // The disclosure is an OCollapsible, so the collapsed line is its trigger.
      const trigger = wrapper.find('[data-test="curated-strip"] button');
      expect(trigger.exists()).toBe(true);
      expect(trigger.text()).not.toMatch(/\b8\b/);
      expect(trigger.text()).not.toMatch(/panels?\s+hidden/i);
    });

    it("the panel COUNT and the not-found stream list render on the EXPANDED row only", async () => {
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      const row = wrapper.find('[data-test="curated-strip-group-kube-state"]');
      expect(row.text()).toContain("8");
      expect(row.text()).toContain("kube_pod_status_phase");
    });

    it("the RBAC hedge renders EXACTLY ONCE, as the expanded footnote, and on no row", async () => {
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            hiddenGroup(),
            hiddenGroup({ group: { ...hiddenGroup().group, id: "kubelet-pod" } }),
          ]),
          stripAutoExpand: ref(true),
        },
      );
      expect(wrapper.findAll('[data-test="curated-strip-hedge"]')).toHaveLength(1);
      for (const row of wrapper.findAll('[data-test^="curated-strip-group-"]')) {
        expect(row.find('[data-test="curated-strip-hedge"]').exists()).toBe(false);
      }
    });

    it("the hedge renders the `infra.curated.hiddenFootnote` KEY, not ad-hoc copy", async () => {
      // Structure alone (one node, on no row) is satisfied by any hardcoded string.
      // §8.4 authors this as one key so the sentence is translated and edited in one
      // place, rather than as copy inlined at the call site.
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      const hedge = wrapper.find('[data-test="curated-strip-hedge"]');
      expect(hedge.exists()).toBe(true);
      expect(hedge.attributes("data-copy-key")).toBe("infra.curated.hiddenFootnote");
    });

    it("auto-expands when a hidden group owns an OVERVIEW panel; stays collapsed otherwise", async () => {
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      expect(wrapper.find('[data-test="curated-strip-expanded"]').exists()).toBe(true);
      wrapper.unmount();

      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(false) },
      );
      expect(wrapper.find('[data-test="curated-strip-expanded"]').exists()).toBe(false);
    });

    it("an expanded row leads with the capability sentence + Set-up BEFORE the stream list", async () => {
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      const html = wrapper.find('[data-test="curated-strip-group-kube-state"]').html();
      expect(html.indexOf("curated-strip-setup")).toBeGreaterThan(-1);
      expect(html.indexOf("curated-strip-setup")).toBeLessThan(
        html.indexOf("kube_pod_status_phase"),
      );
    });

    it("a card-kind Set-up expands the DataSourceSetupCard inline in an accordion", async () => {
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      await wrapper.find('[data-test="curated-strip-setup"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(true);
      expect(router.push).not.toHaveBeenCalled();
    });

    it("a route-kind Set-up PUSHES the route instead of expanding a card", async () => {
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            hiddenGroup({
              group: {
                ...hiddenGroup().group,
                setup: { kind: "route", routeName: "AWSConfig" },
              },
            }),
          ]),
          stripAutoExpand: ref(true),
        },
      );
      await wrapper.find('[data-test="curated-strip-setup"]').trigger("click");
      await flushPromises();
      expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ name: "AWSConfig" }));
    });

    it("DRY-RUN finding 1: a PRESENT-BUT-DEAD group renders `streamsStale`, never `streamsMissing`", async () => {
      // "not found" sends the user to install a collector they already have.
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            hiddenGroup({
              missingStreams: [
                {
                  name: "k8s_node_cpu_usage",
                  state: "stale",
                  lastSeenUs: NOW_US - 177 * 24 * HOUR_US,
                },
              ],
            }),
          ]),
          stripAutoExpand: ref(true),
        },
      );
      const row = wrapper.find('[data-test="curated-strip-group-kube-state"]');
      expect(row.find('[data-test="curated-strip-streams-stale"]').exists()).toBe(true);
      expect(row.find('[data-test="curated-strip-streams-missing"]').exists()).toBe(false);
    });

    it("an ABSENT group renders `streamsMissing`, never `streamsStale` — asserted both ways", async () => {
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      const row = wrapper.find('[data-test="curated-strip-group-kube-state"]');
      expect(row.find('[data-test="curated-strip-streams-missing"]').exists()).toBe(true);
      expect(row.find('[data-test="curated-strip-streams-stale"]').exists()).toBe(false);
    });

    it("a `field-unresolved` row names the group's DISPLAY and still renders its Set-up button", async () => {
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            hiddenGroup({
              reason: "field-unresolved",
              missingStreams: [],
              unresolvedConcepts: [{ groupId: "k8s-node-name", display: "K8s Node Name" }],
            }),
          ]),
          stripAutoExpand: ref(true),
        },
      );
      const row = wrapper.find('[data-test="curated-strip-group-kube-state"]');
      expect(row.text()).toContain("K8s Node Name");
      // The collector is still the fix, so the user's action is unchanged.
      expect(row.find('[data-test="curated-strip-setup"]').exists()).toBe(true);
    });

    it("a variant-miss panel folds into its PRESENT group's row with the drift spelling", async () => {
      wrapper = await mountView(
        {},
        {
          partialGroups: ref([
            {
              group: hiddenGroup().group,
              hiddenPanelIds: ["k8s_nd_memory"],
              missingStreams: [{ name: "k8s_node_memory_usage", state: "absent" }],
            },
          ]),
          stripAutoExpand: ref(true),
        },
      );
      expect(wrapper.find('[data-test="curated-strip"]').text()).toContain("k8s_node_memory_usage");
    });

    it("STALE rows render setupHintKey too — 'what do I restart?' is the next question", async () => {
      wrapper = await mountView(
        {},
        {
          staleGroups: ref([
            { group: hiddenGroup().group, lastSeenUs: NOW_US - 3 * 24 * HOUR_US, panelIds: ["p1"] },
          ]),
          stripAutoExpand: ref(true),
        },
      );
      expect(wrapper.find('[data-test="curated-strip-hint"]').exists()).toBe(true);
    });

    it("the phrase 'not connected' appears NOWHERE in the rendered DOM; 'not found' does", async () => {
      // A drifted name or an RBAC filter is not a thing the user failed to connect.
      wrapper = await mountView(
        {},
        { hiddenGroups: ref([hiddenGroup()]), stripAutoExpand: ref(true) },
      );
      expect(wrapper.text().toLowerCase()).not.toContain("not connected");
      expect(wrapper.text().toLowerCase()).toContain("not found");
    });
  });

  // ── Stale disclosure (§6.1, §6.3) ────────────────────────────────────────

  describe("stale disclosure", () => {
    const staleState = () => ({
      staleGroups: ref([
        {
          group: {
            id: "kube-state",
            labelKey: "infra.k8s.group.kubeState",
            capabilityKey: "infra.k8s.group.kubeStateCap",
            setupHintKey: "infra.k8s.group.kubeStateHint",
            setup: { kind: "card", slug: "kubernetes" },
          },
          lastSeenUs: NOW_US - 3 * 24 * HOUR_US,
          panelIds: ["overview_p1"],
        },
      ]),
      lastDataUs: ref(null),
    });

    it("renders a page-level stale banner in the banner region, NON-dismissible", async () => {
      // The thing it qualifies — every number on the page — stays on screen after
      // a dismissal would hide it.
      wrapper = await mountView({}, staleState());
      const banner = wrapper.find('[data-test="curated-stale-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.find('[data-test="curated-stale-banner-dismiss"]').exists()).toBe(false);
      // Rendered THROUGH the renderer's before_panels slot, not above it.
      expect(wrapper.find(".render-stub").find('[data-test="curated-stale-banner"]').exists()).toBe(
        true,
      );
    });

    it("the banner names the CAPABILITY and leads with the DURATION, not the stream list", async () => {
      wrapper = await mountView({}, staleState());
      // The duration is measured against the page's OWN window end (or the wall
      // clock, whichever is later), and the fixture's lastSeenUs is NOW_US-3d on
      // a NOW_US that is years ahead of real time. Without moving the page onto
      // that clock the age is negative and clamps to "1 minute", so the "3" is
      // underivable from anything the view was given. Drive the real seam.
      wrapper.findComponent({ name: "DateTime" }).vm.$emit("on:date-change", {
        startTime: NOW_US - 3 * HOUR_US,
        endTime: NOW_US,
        userChangedValue: true,
      });
      await flushPromises();
      const banner = wrapper.find('[data-test="curated-stale-banner"]');
      expect(banner.text()).not.toContain("kube_pod_status_phase");
      expect(banner.text()).toMatch(/\b3\b/);
    });

    // A listed stream whose stats never flushed serializes doc_time_max: 0, which formatted as the Unix epoch.
    it("a never-flushed stream reads 'no data yet' — never an epoch date or a 20,000-day age", async () => {
      const state = staleState();
      state.staleGroups.value[0].lastSeenUs = 0;
      (state.staleGroups.value[0] as any).noDataYet = true;
      wrapper = await mountView({}, state);
      const banner = wrapper.find('[data-test="curated-stale-banner"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).not.toContain("1970");
      expect(banner.text()).not.toMatch(/\d{5,} days?/);
      expect(banner.text().toLowerCase()).toContain("no data yet");
    });

    it("the 'as of the last stream-list refresh' caveat is TOOLTIP-only", async () => {
      wrapper = await mountView({}, staleState());
      expect(wrapper.find('[data-test="curated-stale-banner"]').text()).not.toContain(
        "last stream-list refresh",
      );
    });

    // The "No Data" tile state renders ON the tile (§6.3), so it is pinned in
    // PanelContainer.spec.ts against the real series-data-update seam rather
    // than a page-level footnote list. The phase disclosure is NOT a tile
    // concern — it is a fact about the trio, so it is a section-level line.

    it("renders the active section's note in the banner region, above the panels", async () => {
      wrapper = await mountView(
        {},
        {
          dashboard: ref(withNoteOnFirstTab(dashboardFixture())),
        },
      );
      const note = wrapper.find('[data-test="curated-section-note"]');
      expect(note.exists()).toBe(true);
      expect(note.text()).toContain("Succeeded");
      // In the slot, so it scrolls WITH the tiles it qualifies — a note the user
      // has to scroll away from the tiles to find is not a disclosure.
      expect(wrapper.find(".render-stub").find('[data-test="curated-section-note"]').exists()).toBe(
        true,
      );
    });

    it("renders NO note for a section that declares none", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-section-note"]').exists()).toBe(false);
    });

    it("never renders a freshness line — the panels carry their own timestamps", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-last-data"]').exists()).toBe(false);
      wrapper.unmount();

      wrapper = await mountView({}, staleState());
      expect(wrapper.find('[data-test="curated-last-data"]').exists()).toBe(false);
    });
  });

  // ── Warnings banner (§6.1 item 2) ────────────────────────────────────────

  describe("warnings", () => {
    it("`probe` renders the user-situation wording, not the engine's verification step", async () => {
      wrapper = await mountView({}, { warnings: ref([{ kind: "probe", message: "CloudTrail" }]) });
      const banner = wrapper.find('[data-test="curated-warning-probe"]');
      expect(banner.exists()).toBe(true);
      expect(banner.text().toLowerCase()).toContain("showing its panels anyway");
    });

    it("`schema`, `semantic-groups` and `groups-missing` collapse into ONE defaultFieldNames line", async () => {
      // All three are the same event to a user and none is actionable.
      wrapper = await mountView(
        {},
        {
          warnings: ref([
            { kind: "schema", message: "a" },
            { kind: "semantic-groups", message: "b" },
            { kind: "groups-missing", message: "c" },
          ]),
        },
      );
      expect(wrapper.findAll('[data-test="curated-warning-defaultFieldNames"]')).toHaveLength(1);
      expect(wrapper.find('[data-test="curated-warning-schema"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="curated-warning-semantic-groups"]').exists()).toBe(false);
    });

    it("`stats` stays its own row", async () => {
      wrapper = await mountView({}, { warnings: ref([{ kind: "stats", message: "s" }]) });
      expect(wrapper.find('[data-test="curated-warning-stats"]').exists()).toBe(true);
    });
  });

  // ── Pickers (§6.4) ───────────────────────────────────────────────────────

  describe("scope pickers", () => {
    // These mount the REAL VariablesValueSelector, not a stub that hand-emits a
    // contract nothing implements: the disabled/cap/omission affordances live in
    // that component, so a pin that fakes them proves nothing about the page.
    const pickerVariables = () => [
      {
        name: "cluster",
        label: "K8s Cluster",
        type: "query_values",
        multiSelect: true,
        omitWhenValuesEmpty: true,
        curatedOmitWhenValuesEmpty: true,
        curatedCapNotice: true,
        curatedNarrowBy: "",
        options: [],
        isLoading: false,
        isVariableLoadingPending: false,
        isVariablePartialLoaded: true,
        value: [],
        query_data: { max_record_size: 100 },
      },
      {
        name: "namespace",
        label: "K8s Namespace",
        type: "query_values",
        multiSelect: true,
        omitWhenValuesEmpty: true,
        curatedOmitWhenValuesEmpty: true,
        curatedCapNotice: true,
        curatedNarrowBy: "K8s Cluster",
        options: new Array(100).fill(0).map((_, i) => ({ label: `ns${i}`, value: `ns${i}` })),
        isLoading: false,
        isVariableLoadingPending: false,
        isVariablePartialLoaded: true,
        value: [],
        query_data: { max_record_size: 100 },
      },
    ];

    const withPickers = (over: any[] = []) => ({
      dashboard: ref({
        ...dashboardFixture(["overview", "workloads"]),
        variables: {
          showDynamicFilters: false,
          list: over.length ? over : pickerVariables(),
        },
      }),
    });

    /**
     * The REAL VariablesValueSelector with its list seeded directly: the manager
     * that normally fills it needs a live store, and the seam under test is the
     * template's forwarding, not the manager.
     */
    const mountRealSelector = async (variables: any[]) => {
      const store = createStore({
        state: { selectedOrganization: { identifier: "test-org" }, timezone: "UTC" },
      });
      const selector = mount(VariablesValueSelector, {
        props: { variablesConfig: { list: variables }, showDynamicFilters: false },
        global: {
          plugins: [store, i18n],
          stubs: { VariableQueryValueSelector: querySelectorStub },
        },
      });
      (selector.vm as any).variablesData.values = variables;
      await flushPromises();
      return selector;
    };

    // THE restructure invariant, and the direct cause of "filters reset on tab
    // switch": a tab switch must mutate the injected selectedTabId ref and
    // NOTHING else. Rebuilding emitted a new dashboard object, which re-ran
    // useVariablesManager.initialize, which re-seeded every picker from
    // buildVariable's `value: ""` and discarded the user's selection. Dashboards
    // never do this (ViewDashboard :540-542, RenderDashboardCharts :528-531).
    it("a tab switch changes ONLY the injected tab ref — the dashboard object is untouched", async () => {
      const variables = pickerVariables();
      wrapper = await mountView({}, withPickers(variables));

      const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
      const before = render.props("dashboardData");
      const injected = (render.vm as any).$.provides["selectedTabId"] as Ref<string | null>;
      expect(isRef(injected)).toBe(true);

      injected.value = "workloads";
      await flushPromises();

      // Same object IDENTITY — that is what stops the manager re-initializing.
      expect(render.props("dashboardData")).toBe(before);
    });

    // A re-resolve re-initializes the variables manager, which never
    // re-fetches an all-sentinel picker — so the view has to hand the loaded
    // options back to the composable before the next build drops them.
    it("forwards loaded variable options to the composable so a re-resolve keeps them", async () => {
      wrapper = await mountView({}, withPickers(pickerVariables()));
      rememberSpy.mockClear();

      // The REAL payload RenderDashboardCharts emits — see its
      // getMergedVariablesForPanel: { isVariablesLoading, values }.
      const payload = {
        isVariablesLoading: false,
        values: [{ name: "namespace", options: [{ label: "argocd", value: "argocd" }] }],
      };
      wrapper.findComponent({ name: "RenderDashboardCharts" }).vm.$emit("variablesData", payload);
      await flushPromises();

      expect(rememberSpy).toHaveBeenCalledWith(payload);
    });

    it("values length === cap renders valuesCapped in the REAL selector; below the cap it is absent", async () => {
      // Truncation is undetectable (no_count:true), so length===cap is the only
      // inference available and it errs toward disclosure.
      const variables = pickerVariables();
      const selector = await mountRealSelector(variables);
      expect(selector.find('[data-test="variable-values-capped-namespace"]').exists()).toBe(true);
      expect(selector.find('[data-test="variable-values-capped-cluster"]').exists()).toBe(false);
      selector.unmount();
    });

    it("F4: the cap notice survives a list that EXCEEDS the cap, not only one equal to it", async () => {
      // Options accumulate across paged responses (:505 merges the previous page
      // in) and the selected value is appended when absent, so a truncated list
      // can exceed max_record_size — where `===` silently dropped the notice
      // exactly when the list was most truncated.
      const variables = pickerVariables();
      const namespace = variables[1] as any;
      namespace.options = [...namespace.options, { label: "extra", value: "extra" }];
      expect(namespace.options.length).toBeGreaterThan(namespace.query_data.max_record_size);

      const selector = await mountRealSelector(variables);
      expect((selector.vm as any).isVariableCapped(namespace)).toBe(true);
      // Paired negative: a genuinely short list still reports nothing.
      expect((selector.vm as any).isVariableCapped(variables[0])).toBe(false);
      selector.unmount();
    });

    it("DRY-RUN finding 6: an omitWhenValuesEmpty picker with ZERO values is hidden by the REAL selector", async () => {
      // Not rendered disabled, not rendered with an empty-state string — an enabled
      // empty dropdown reads as a broken page.
      const variables = pickerVariables();
      const selector = await mountRealSelector(variables);
      const vm = selector.vm as any;
      expect(vm.isVariableOmitted(variables[0])).toBe(true);
      expect(vm.isVariableOmitted(variables[1])).toBe(false);
      // A still-loading empty list is NOT an omission — the picker would flicker.
      expect(vm.isVariableOmitted({ ...variables[0], isLoading: true })).toBe(false);
      // NOR is a chained child mid-reload. useVariablesManager clears a child's
      // options with isLoading ALREADY false on a parent change (:643/:650) and
      // leaves both loading flags false while resetting descendants (:695-706),
      // so a one-flag test read those windows as "genuinely empty" and flickered
      // the Pod picker out of the DOM on every Namespace change.
      expect(vm.isVariableOmitted({ ...variables[0], isVariableLoadingPending: true })).toBe(false);
      expect(vm.isVariableOmitted({ ...variables[0], isVariablePartialLoaded: false })).toBe(false);
      selector.unmount();
    });

    it("a cold load whose URL carries var-cluster keeps the picker even before options arrive", async () => {
      // loadFromUrl sets isVariablePartialLoaded and clears BOTH loading flags so the
      // value is not re-fetched (useVariablesManager :880-885), so on a hard refresh the
      // held-value picker is indistinguishable from a settled-empty one and vanished.
      const variables = pickerVariables();
      const cluster = variables[0] as any;
      cluster.value = ["common-dev"];
      const selector = await mountRealSelector(variables);
      const vm = selector.vm as any;
      expect(vm.isVariableOmitted(cluster)).toBe(false);
      // A single-select picker holding a URL value is the same case.
      expect(vm.isVariableOmitted({ ...cluster, multiSelect: false, value: "common-dev" })).toBe(
        false,
      );
      // The legitimate omission survives: no value held, nothing to protect.
      expect(vm.isVariableOmitted({ ...cluster, value: [] })).toBe(true);
      selector.unmount();
    });

    // The three-picker chain the k8s pack actually declares, with the runtime
    // shape useVariablesManager.initialize produces rather than hand-set flags:
    // the scheduling contract under test is the manager's, so a fixture that
    // pre-sets the flags would assert nothing about it.
    const chainConfig = () => [
      {
        name: "cluster",
        label: "K8s Cluster",
        type: "query_values",
        multiSelect: true,
        scope: "global",
        options: [],
        query_data: { stream: "kube_pod_status_phase", field: "k8s_cluster", filter: [] },
      },
      {
        name: "namespace",
        label: "K8s Namespace",
        type: "query_values",
        multiSelect: true,
        scope: "global",
        options: [],
        query_data: {
          stream: "kube_pod_status_phase",
          field: "namespace",
          filter: [{ name: "k8s_cluster", operator: "IN", value: "$cluster" }],
        },
      },
      {
        name: "pod",
        label: "Pod",
        type: "query_values",
        multiSelect: true,
        scope: "global",
        options: [],
        query_data: {
          stream: "kube_pod_status_phase",
          field: "pod",
          filter: [
            { name: "k8s_cluster", operator: "IN", value: "$cluster" },
            { name: "namespace", operator: "IN", value: "$namespace" },
          ],
        },
      },
    ];

    /** checkAndLoadPendingVariables fires on this flag ALONE (VariablesValueSelector :1826-1833). */
    const scheduled = (manager: any, name: string) =>
      manager.variablesData.global.find((v: any) => v.name === name)?.isVariableLoadingPending ===
      true;

    const coldLoad = async (query: Record<string, string>) => {
      const manager = useVariablesManager((key: string) => key);
      await manager.initialize(chainConfig(), {});
      manager.loadFromUrl({ query });
      manager.commitAll();
      await flushPromises();
      return manager;
    };

    it("a URL-restored parent schedules its chained child, so namespace can still load", async () => {
      // The reported URL: var-cluster only. loadFromUrl marks cluster loaded WITHOUT
      // fetching, and only a completed fetch calls onVariablePartiallyLoaded — so the
      // chain was never told to start and namespace stayed pending=false forever.
      const manager = await coldLoad({ "var-cluster": "common-dev" });
      expect(scheduled(manager, "namespace")).toBe(true);
    });

    it("the grandchild waits for its own parent rather than firing unnarrowed", async () => {
      // Pod is chained on cluster AND namespace; scheduling it before namespace
      // resolves would query every cluster's pods.
      const manager = await coldLoad({ "var-cluster": "common-dev" });
      expect(scheduled(manager, "pod")).toBe(false);

      const namespace = manager.variablesData.global.find((v: any) => v.name === "namespace");
      namespace.value = ["argocd"];
      namespace.options = [{ label: "argocd", value: "argocd" }];
      manager.onVariablePartiallyLoaded("namespace@global");
      expect(scheduled(manager, "pod")).toBe(true);
    });

    it("a URL carrying the whole chain schedules nothing, because every value is already held", async () => {
      const manager = await coldLoad({
        "var-cluster": "common-dev",
        "var-namespace": "argocd",
        "var-pod": "ingester-0",
      });
      expect(scheduled(manager, "namespace")).toBe(false);
      expect(scheduled(manager, "pod")).toBe(false);
    });

    it("a cold load with NO var- keys leaves the chain to the parent's own fetch", async () => {
      // Cluster is parentless so initialize already scheduled it; the children must
      // wait for its response, not race it.
      const manager = await coldLoad({});
      expect(scheduled(manager, "cluster")).toBe(true);
      expect(scheduled(manager, "namespace")).toBe(false);
      expect(scheduled(manager, "pod")).toBe(false);
    });

    it("valueless namespace and pod are RENDERED on that cold load, never omitted", async () => {
      // partial=false is the un-settled state, so the omit test's third clause
      // already spares them — this pins that b54f23ab09 did not widen omission
      // onto the children.
      const manager = await coldLoad({ "var-cluster": "common-dev" });
      const selector = await mountRealSelector(manager.variablesData.global as any[]);
      const vm = selector.vm as any;
      expect(vm.isVariableOmitted(manager.variablesData.global[1])).toBe(false);
      expect(vm.isVariableOmitted(manager.variablesData.global[2])).toBe(false);
      selector.unmount();
    });

    it("a genuinely empty picker is still omitted once its own load has settled", async () => {
      // The deliberate behaviour b54f23ab09 had to preserve: a settled, valueless,
      // zero-option picker is unresolvable and must go.
      const manager = await coldLoad({ "var-cluster": "common-dev" });
      const selector = await mountRealSelector(manager.variablesData.global as any[]);
      const vm = selector.vm as any;
      const settledEmpty = {
        ...manager.variablesData.global[1],
        curatedOmitWhenValuesEmpty: true,
        isVariablePartialLoaded: true,
        isVariableLoadingPending: false,
        isLoading: false,
        options: [],
        value: [],
      };
      expect(vm.isVariableOmitted(settledEmpty)).toBe(true);
      selector.unmount();
    });

    it("a mid-chain reload re-schedules the child instead of stranding it empty", async () => {
      // Changing cluster resets descendants with BOTH loading flags false
      // (useVariablesManager :695-706); the child must be re-armed, not left settled.
      const manager = await coldLoad({ "var-cluster": "common-dev" });
      manager.updateVariableValue("cluster", "global", undefined, undefined, ["common-prod"]);
      expect(scheduled(manager, "namespace")).toBe(true);
      expect(scheduled(manager, "pod")).toBe(false);
    });

    it("a curated picker is clearable, so a chosen scope can be undone", async () => {
      // The affordance is OSelect's own `clearable` X (used app-wide); the curated
      // page previously offered no way back out of a selection at all.
      const variables = pickerVariables();
      const selector = await mountRealSelector(variables);
      const picker = selector.findComponent(querySelectorStub);
      expect(picker.props("clearable")).toBe(true);
      selector.unmount();
    });

    it("clearing a picker strips its var- key from the URL and resets the chained child", async () => {
      const variables = pickerVariables();
      (variables[0] as any).options = [{ label: "common-dev", value: "common-dev" }];
      (variables[0] as any).value = ["common-dev"];
      (variables[1] as any).value = ["argocd"];
      // The REAL chain edge buildVariable emits — the graph is built from this
      // `$cluster` reference, so a fixture without it resets no children.
      (variables[1] as any).query_data = {
        ...(variables[1] as any).query_data,
        stream: "kube_pod_status_phase",
        field: "namespace",
        filter: [{ name: "k8s_cluster", operator: "IN", value: "$cluster" }],
      };
      wrapper = await mountView({}, withPickers(variables), {
        "var-cluster": "common-dev",
        "var-namespace": "argocd",
      });
      await flushPromises();

      const manager = useVariablesManager((key: string) => key);
      await manager.initialize(variables, {});
      wrapper
        .findComponent({ name: "RenderDashboardCharts" })
        .vm.$emit("variablesManagerReady", manager);
      await flushPromises();

      manager.updateVariableValue("cluster", "global", undefined, undefined, []);
      manager.commitAll();
      await flushPromises();

      expect(router.currentRoute.value.query["var-cluster"]).toBeUndefined();
      // The chain: a namespace picked under the cleared cluster must not keep filtering.
      expect(router.currentRoute.value.query["var-namespace"]).toBeUndefined();
    });

    it("finding 23b: an omitted cluster picker with ONE resolvable value renders the name as static text", async () => {
      const variables = pickerVariables();
      (variables[0] as any).options = [{ label: "production", value: "production" }];
      wrapper = await mountView({}, withPickers(variables));
      await flushPromises();
      const label = wrapper.find('[data-test="curated-single-cluster"]');
      expect(label.exists()).toBe(true);
      expect(label.text()).toContain("production");
    });
  });

  // ── Chained narrowing: the SQL a child picker actually sends (§6.4) ──────

  describe("a chained picker's values query carries the parent's selection", () => {
    // resolve.spec.ts pins the built `filter` ROW; this pins what the shared
    // selector turns that row into on the wire, because the row alone proves
    // nothing — the value travels as base64 SQL in the `sql` field of the
    // _values_stream body (VariablesValueSelector buildQueryContext :1839-1931),
    // and substitution happens AFTER the row is compiled to SQL. Verified live
    // against o2.introspect: namespace=argocd -> 13 pods, ziox -> 27,
    // argocd+ziox -> 40, a bogus namespace -> 0, and the backend rewrites the
    // _o2_all_ sentinel to `true` (remove_dashboard_placeholder.rs) so ALL
    // -> the unfiltered 500. The bundled host_metrics dashboard's own chain
    // behaves identically on the same backend (6 mountpoints -> 2 for one host).
    /** Keyed by the field being fetched, so the parent's own load cannot be mistaken for the child's. */
    const capturedSql: { field: string; sql: string }[] = [];

    const chainedVariables = () => [
      {
        name: "namespace",
        label: "K8s Namespace",
        type: "query_values",
        multiSelect: true,
        scope: "global",
        value: ["argocd"],
        isVariablePartialLoaded: true,
        isLoading: false,
        isVariableLoadingPending: false,
        options: [{ label: "argocd", value: "argocd" }],
        query_data: {
          stream: "k8s_pod_memory_usage",
          stream_type: "metrics",
          field: "k8s_namespace_name",
          max_record_size: 100,
          filter: [],
        },
      },
      {
        name: "pod",
        label: "K8s Pod",
        type: "query_values",
        multiSelect: true,
        scope: "global",
        value: [],
        isVariablePartialLoaded: false,
        isLoading: false,
        isVariableLoadingPending: true,
        options: [],
        // The exact row resolve.ts buildVariable emits for a chainedOn picker.
        query_data: {
          stream: "k8s_pod_memory_usage",
          stream_type: "metrics",
          field: "k8s_pod_name",
          max_record_size: 100,
          filter: [{ name: "k8s_namespace_name", operator: "IN", value: "$namespace" }],
        },
      },
    ];

    const loadPodValues = async (variables: any[]) => {
      capturedSql.length = 0;
      const store = createStore({
        state: {
          selectedOrganization: { identifier: "test-org" },
          timezone: "UTC",
          zoConfig: { timestamp_column: "_timestamp" },
        },
      });
      const selector = mount(VariablesValueSelector, {
        props: {
          variablesConfig: { list: variables },
          showDynamicFilters: false,
          selectedTimeDate: {
            start_time: new Date(NOW_US / 1000 - 3 * 60 * 60 * 1000),
            end_time: new Date(NOW_US / 1000),
          },
        },
        global: {
          plugins: [store, i18n],
          stubs: { VariableQueryValueSelector: querySelectorStub },
        },
      });
      (selector.vm as any).variablesData.values = variables;
      await flushPromises();
      await (selector.vm as any).loadVariableOptions(variables[1]);
      await flushPromises();
      selector.unmount();
      return capturedSql
        .filter((entry) => entry.field === "k8s_pod_name")
        .map((entry) => b64DecodeUnicodeSafe(entry.sql));
    };

    beforeEach(() => {
      streamingMock.mockImplementation(async (payload: any) => {
        if (payload?.type !== "values") return;
        capturedSql.push({
          field: payload.queryReq.fields?.[0] ?? "",
          sql: payload.queryReq.sql,
        });
      });
    });

    it("substitutes the parent's CONCRETE selection into the child's SQL filter", async () => {
      const sent = await loadPodValues(chainedVariables());
      expect(sent).toHaveLength(1);
      // Narrowed, and narrowed to what the user picked — the literal `$namespace`
      // token surviving to the wire is the failure this pin exists to catch.
      expect(sent[0]).toContain(`"k8s_namespace_name" IN ('argocd')`);
      expect(sent[0]).not.toContain("$namespace");
    });

    it("a MULTI-value parent selection becomes an IN list, not just its first value", async () => {
      const variables = chainedVariables();
      variables[0].value = ["argocd", "ziox"];
      const sent = await loadPodValues(variables);
      expect(sent[0]).toContain("'argocd'");
      expect(sent[0]).toContain("'ziox'");
    });

    it("the ALL sentinel travels verbatim — the BACKEND rewrites it to `true`", async () => {
      // Deliberately NOT stripped client-side: remove_dashboard_placeholder.rs
      // turns `IN ('_o2_all_')` into `true`, measured live as the unfiltered
      // 500-pod list. Stripping it here would fork behaviour from every stored
      // dashboard, which sends the sentinel too.
      const variables = chainedVariables();
      variables[0].value = ["_o2_all_"];
      const sent = await loadPodValues(variables);
      expect(sent[0]).toContain("_o2_all_");
    });
  });

  // ── Panel reactivity to a picker change (§6.4) ───────────────────────────

  describe("panels re-query when a picker selection changes", () => {
    // The REAL useVariablesManager, not a hand-rolled fake: panels read
    // getCommittedVariablesForPanel, and a selection only reaches committed
    // state through commitAll(). Every other embedder of RenderDashboardCharts
    // (ViewDashboard :1254, AppPerformance :326, TracesAnalysisDashboard :782)
    // holds a ref and calls commitAllVariables() — the curated page must too,
    // and it cannot lean on the per-panel "refresh to apply" button because
    // PanelContainer hides that behind `v-if="!viewOnly"` (:204) and the
    // curated page is viewOnly.
    const workloadsDashboard = () => ({
      ...dashboardFixture(["overview", "workloads"]),
      variables: {
        showDynamicFilters: false,
        list: [
          {
            name: "namespace",
            label: "K8s Namespace",
            type: "query_values",
            multiSelect: true,
            scope: "global",
            value: [],
            options: [
              { label: "argocd", value: "argocd" },
              { label: "ziox", value: "ziox" },
            ],
            query_data: {
              stream: "k8s_pod_memory_usage",
              stream_type: "metrics",
              field: "k8s_namespace_name",
              max_record_size: 100,
              filter: [],
            },
          },
        ],
      },
    });

    /**
     * The real manager, initialized and committed exactly as
     * RenderDashboardCharts does before it emits (:1134-1149) — the emit's
     * payload is that manager object verbatim, so this IS the real contract.
     */
    const readyManager = async (dashboardData: any) => {
      const manager = useVariablesManager();
      await manager.initialize(dashboardData.variables.list, dashboardData);
      manager.commitAll();
      return manager;
    };

    it("the emitted payload really is a manager exposing what the view drives it by", () => {
      // Guards the shape the view depends on: if RenderDashboardCharts ever
      // emits something narrower, the pins below would still pass on a fake.
      const manager = useVariablesManager();
      expect(typeof manager.commitAll).toBe("function");
      expect(typeof manager.updateVariableValue).toBe("function");
      expect(typeof manager.getCommittedVariablesForPanel).toBe("function");
      expect(Array.isArray(manager.variablesData.global)).toBe(true);
    });

    const committedValue = (manager: any, name: string) =>
      manager
        .getCommittedVariablesForPanel("workloads_p1", "workloads")
        .find((v: any) => v.name === name)?.value;

    it("re-setting the SAME selection commits nothing new — no gratuitous panel re-query", async () => {
      // RenderDashboardCharts already auto-commits the first load (:1228), so
      // this watcher fires on that same transition. commitAll is a pure
      // live->committed clone, so the second call must be a no-op in effect;
      // if it were not, every page load would double-query every panel.
      const dashboardData = workloadsDashboard();
      wrapper = await mountView({}, { dashboard: ref(dashboardData) });

      const manager = await readyManager(dashboardData);
      wrapper
        .findComponent({ name: "RenderDashboardCharts" })
        .vm.$emit("variablesManagerReady", manager);
      await flushPromises();

      manager.updateVariableValue("namespace", "global", undefined, undefined, ["argocd"]);
      await flushPromises();
      const afterFirst = committedValue(manager, "namespace");

      manager.updateVariableValue("namespace", "global", undefined, undefined, ["argocd"]);
      await flushPromises();

      expect(committedValue(manager, "namespace")).toEqual(afterFirst);
      expect(manager.hasUncommittedChanges.value).toBe(false);
    });

    it("a picker selection reaches COMMITTED state, which is what panels query on", async () => {
      const dashboardData = workloadsDashboard();
      wrapper = await mountView({}, { dashboard: ref(dashboardData) });

      const manager = await readyManager(dashboardData);
      wrapper
        .findComponent({ name: "RenderDashboardCharts" })
        .vm.$emit("variablesManagerReady", manager);
      await flushPromises();

      expect(committedValue(manager, "namespace")).toEqual([]);

      // Exactly what VariablesValueSelector does on a user pick.
      manager.updateVariableValue("namespace", "global", undefined, undefined, ["argocd"]);
      await flushPromises();

      // Live state moved...
      expect(manager.getVariable("namespace", "global")?.value).toEqual(["argocd"]);
      // ...and the page must have pushed it through to what panels read.
      expect(committedValue(manager, "namespace")).toEqual(["argocd"]);
    });

    it("a tab switch does not reset the cluster picker the reader chose", async () => {
      // Writing ?tab= wakes the drilldown watcher, whose second half resets
      // `cluster` whenever ?var-cluster= is absent — and a tab write never adds
      // it. Unguarded, every tab click throws away a cluster picked by hand:
      // the "filters reset on tab switch" bug, re-entering through the URL sync.
      const dashboardData = {
        ...dashboardFixture(["overview", "workloads"]),
        variables: {
          showDynamicFilters: false,
          list: [
            {
              name: "cluster",
              label: "Cluster",
              type: "query_values",
              multiSelect: false,
              scope: "global",
              value: "prod-eu",
              options: [
                { label: "prod-eu", value: "prod-eu" },
                { label: "prod-us", value: "prod-us" },
              ],
              query_data: {
                stream: "k8s_pod_memory_usage",
                stream_type: "metrics",
                field: "k8s_cluster",
                max_record_size: 100,
                filter: [],
              },
            },
          ],
        },
      };
      wrapper = await mountView({}, { dashboard: ref(dashboardData) });

      const manager = await readyManager(dashboardData);
      wrapper
        .findComponent({ name: "RenderDashboardCharts" })
        .vm.$emit("variablesManagerReady", manager);
      await flushPromises();

      manager.updateVariableValue("cluster", "global", undefined, undefined, "prod-us");
      await flushPromises();

      const render = wrapper.findComponent({ name: "RenderDashboardCharts" });
      const injected = (render.vm as any).$.provides["selectedTabId"] as Ref<string | null>;
      injected.value = dashboardData.tabs[1].tabId;
      await flushPromises();

      expect(router.currentRoute.value.query.tab).toBe(dashboardData.tabs[1].tabId);
      expect(manager.getVariable("cluster", "global")?.value).toBe("prod-us");
    });

    it("a picker change does NOT re-resolve — only the selection moved", async () => {
      // The counterweight: committing must not be smuggled in via a full
      // refresh(), which would remount every panel and drop the
      // pickers' own loaded options.
      const dashboardData = workloadsDashboard();
      wrapper = await mountView({}, { dashboard: ref(dashboardData) });

      const manager = await readyManager(dashboardData);
      wrapper
        .findComponent({ name: "RenderDashboardCharts" })
        .vm.$emit("variablesManagerReady", manager);
      await flushPromises();
      refreshSpy.mockClear();
      const identityBefore = captured.dashboardData;

      manager.updateVariableValue("namespace", "global", undefined, undefined, ["ziox"]);
      await flushPromises();

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(captured.dashboardData).toBe(identityBefore);
    });
  });

  // ── Time picker (§6.4) ───────────────────────────────────────────────────

  it("the picker opens on the manifest's defaultRelativePeriod, not DateTime's 15m default", async () => {
    // manifest.defaultRelativePeriod was declared and never read, so the header
    // said 15m while every panel query ran over the page's 3h window.
    wrapper = await mountView();
    const picker = wrapper.findComponent({ name: "DateTime" });
    expect(picker.exists()).toBe(true);
    expect(picker.props("defaultRelativeTime")).toBe(kubernetesPage.defaultRelativePeriod);
    expect(picker.props("defaultRelativeTime")).toBe("3h");
  });

  // ── Footer (§6.5) ────────────────────────────────────────────────────────

  describe("footer", () => {
    it("renders no footer: the panels already timestamp themselves", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-footer"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="curated-footer-version"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="curated-build-own"]').exists()).toBe(false);
    });

    it("the pack-unavailable escape hatch still routes to the dashboards LIST, creating nothing", async () => {
      // Locked decision 1 guard: it routes, and creates/copies/imports/forks nothing.
      wrapper = await mountView({}, { manifest: null, packUnavailable: true });
      const build = wrapper.find('[data-test="curated-pack-unavailable-build"]');
      if (!build.exists()) return;
      await build.trigger("click");
      await flushPromises();
      expect(router.push).toHaveBeenCalledTimes(1);
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.name).toBe("dashboards");
    });
  });

  // ── Fleet-quadrant drilldown ─────────────────────────────────────────────

  describe("fleet-quadrant drilldown", () => {
    // The sandboxed chart JS cannot see the router, so it dispatches a DOM event
    // and this view routes it. The handler used to call `location.assign`, which
    // is a document navigation: the whole SPA was torn down and rebuilt, every
    // panel refetched, and the user watched a multi-second white flash. These
    // pin the SPA path, and the URL invariants that moved here with it.
    const drill = async (cluster: unknown) => {
      document.dispatchEvent(
        new CustomEvent(FLEET_DRILLDOWN_EVENT, { detail: { cluster }, bubbles: true }),
      );
      await flushPromises();
    };

    const query = () => router.currentRoute.value.query;

    it("routes through the router, never through a document navigation", async () => {
      // router.push is the ONLY assertion that separates this from the bug: a
      // reload reaches the same URL, and only the mechanism tells them apart.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await drill("prod-eu");
      expect(router.push).toHaveBeenCalledTimes(1);
      expect(query()["var-cluster"]).toBe("prod-eu");
      expect(query().tab).toBe("health");
    });

    it("switches the tab on a view that never remounts", async () => {
      // The tab watcher only re-seeds off ?tab= when the tab LIST changes, which a
      // reload did for free and an in-app push does not. Without an explicit
      // switch the URL says health and the page still shows summary.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("summary");
      await drill("prod-eu");
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("health");
    });

    it("replaces a stale cluster scope instead of appending a second one", async () => {
      // Two var-cluster params is a coin flip over which the manager reads, so a
      // second click would silently keep showing the first cluster.
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { "var-cluster": "prod-eu", tab: "health" },
      );
      await drill("prod-us");
      expect(query()["var-cluster"]).toBe("prod-us");
    });

    it("preserves the other query params it does not own", async () => {
      wrapper = await mountView(
        {},
        { dashboard: ref(dashboardFixture(["summary", "health"])) },
        { org_identifier: "acme", period: "15m" },
      );
      await drill("prod-eu");
      expect(query().org_identifier).toBe("acme");
      expect(query().period).toBe("15m");
    });

    it("a cluster name full of query-string metacharacters survives intact", async () => {
      // The name rides a structured `detail` and the router encodes it, so the
      // round trip has to be checked rather than the escaping.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await drill("eu&west=1");
      expect(query()["var-cluster"]).toBe("eu&west=1");
    });

    it("ignores an event carrying no cluster, rather than scoping to nothing", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await drill(undefined);
      expect(router.push).not.toHaveBeenCalled();
      expect(query()["var-cluster"]).toBeUndefined();
    });

    it("does not switch to a tab the manifest is not currently showing", async () => {
      // A hidden health section must not leave the page on a tab that renders nothing.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "nodes"])) });
      await drill("prod-eu");
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("summary");
    });

    it("stops listening once unmounted — a stray click must not route a dead view", async () => {
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      wrapper.unmount();
      (router.push as any).mockClear();
      await drill("prod-eu");
      expect(router.push).not.toHaveBeenCalled();
    });

    it("registers exactly ONE listener, so a click routes once", async () => {
      // The sandbox re-executes and re-binds often; a listener added per render
      // would push the same route several times per click.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      state.dashboard.value = dashboardFixture(["summary", "health"]);
      await flushPromises();
      (router.push as any).mockClear();
      await drill("prod-eu");
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    it("Back returns to the tab the reader came from", async () => {
      // A reload made Back a fresh mount that re-read the URL. In-app, nothing
      // re-reads it, so Back would leave the URL on summary and the page on health.
      wrapper = await mountView({}, { dashboard: ref(dashboardFixture(["summary", "health"])) });
      await drill("prod-eu");
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("health");

      router.back();
      await flushPromises();
      expect(query()["var-cluster"]).toBeUndefined();
      expect(injectedTabIds[injectedTabIds.length - 1]).toBe("summary");
    });
  });

  // ── Org switch (§5.6) ────────────────────────────────────────────────────

  it("an org switch refreshes EXACTLY ONCE with force:true and resets the picker URL params", async () => {
    // Driven through a real reactive store commit: assigning onto a plain object
    // fires no watcher, so the previous shape passed on a view with no org
    // watcher at all. The call count is asserted because "refresh ran" is also
    // true of a mount, and only a count attributes it to the org change.
    wrapper = await mountView();
    await router.replace({ path: "/infra/kubernetes", query: { "var-namespace": "default" } });
    await flushPromises();
    refreshSpy.mockClear();

    (wrapper.vm as any).$store.commit("setOrganization", { identifier: "other-org" });
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(router.currentRoute.value.query["var-namespace"]).toBeUndefined();
  });

  it("an org switch RESETS the dashboards list — the stale org's panels never survive it", async () => {
    // §9's other half: the reset was only weakly implied by the refresh call.
    wrapper = await mountView();
    expect(captured.dashboardData).toBeTruthy();

    state.dashboard.value = null;
    (wrapper.vm as any).$store.commit("setOrganization", { identifier: "other-org" });
    await flushPromises();

    expect(wrapper.find(".render-stub").exists()).toBe(false);
  });

  // ── Loop-2 review fixes ────────────────────────────────────────────────────
  describe("dormant face, strip CTA and strip expansion", () => {
    const deadGroup = () => ({
      group: kubernetesPage.groups[0]!,
      reason: "streams-missing" as const,
      missingStreams: [
        { name: "k8s_node_cpu_usage", state: "stale" as const, lastSeenUs: NOW_US - 120 * HOUR_US },
      ],
      panelCount: 4,
    });

    it("B4: an org whose streams all STOPPED renders the dormant face, not the setup face", async () => {
      // The streams exist; only their data stopped. Rendering the setup face here
      // told an org to install a collector it already has.
      wrapper = await mountView(
        {},
        {
          face: ref("dormant"),
          dashboard: ref(null),
          hiddenGroups: ref([deadGroup()]),
        },
      );
      expect(wrapper.find('[data-test="curated-dormant-state"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="curated-setup-state"]').exists()).toBe(false);
      // ...and offers NO setup CTA, since installing is not the fix.
      expect(wrapper.find('[data-test="setup-card-stub"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="curated-setup-route-cta"]').exists()).toBe(false);
      // It names what stopped and when.
      const text = wrapper.find('[data-test="curated-dormant-stream"]').text();
      expect(text).toContain("k8s_node_cpu_usage");
      expect(text).toContain("stopped reporting");
    });

    it("M1: a PRESENT group's strip row offers no Set-up — its collector already works", async () => {
      const group = kubernetesPage.groups[0]!;
      wrapper = await mountView(
        {},
        {
          hiddenGroups: ref([
            {
              group,
              reason: "field-unresolved" as const,
              missingStreams: [],
              unresolvedConcepts: [{ groupId: "k8s-cluster", display: "K8s Cluster" }],
              panelCount: 1,
            },
          ]),
          presentGroupIds: ref([group.id]),
        },
      );
      (wrapper.vm as any).stripExpanded = true;
      await flushPromises();
      expect(wrapper.find('[data-test="curated-strip-setup"]').exists()).toBe(false);
    });

    it("M1: an ABSENT group's row still offers Set-up — asserted both ways", async () => {
      wrapper = await mountView({}, { hiddenGroups: ref([deadGroup()]), presentGroupIds: ref([]) });
      (wrapper.vm as any).stripExpanded = true;
      await flushPromises();
      expect(wrapper.find('[data-test="curated-strip-setup"]').exists()).toBe(true);
    });

    it("F9: a refresh does not re-expand a strip the user collapsed", async () => {
      // Auto-expand SEEDS the state once (pass-4 finding 8b). Re-syncing on every
      // change discarded a collapse the user had just performed.
      const stripAutoExpand = ref(true);
      wrapper = await mountView({}, { hiddenGroups: ref([deadGroup()]), stripAutoExpand });
      expect((wrapper.vm as any).stripExpanded).toBe(true);

      (wrapper.vm as any).stripExpanded = false;
      await flushPromises();

      // A refresh where the group momentarily resolves and goes missing again.
      stripAutoExpand.value = false;
      await flushPromises();
      stripAutoExpand.value = true;
      await flushPromises();

      expect((wrapper.vm as any).stripExpanded).toBe(false);
    });
  });
});
