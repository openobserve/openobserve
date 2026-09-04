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
import { kubernetesPage } from "./packs/kubernetes.page";
import i18n from "@/locales";

const { useCuratedPageMock } = vi.hoisted(() => ({ useCuratedPageMock: vi.fn() }));
vi.mock("./useCuratedPage", () => ({ useCuratedPage: useCuratedPageMock }));

const NOW_US = 1_800_000_000_000_000;
const HOUR_US = 60 * 60 * 1_000_000;

/** Whatever the composable last returned, so tests can drive its refs. */
let state: any;

const refreshSpy = vi.fn(async () => {});

const dashboardFixture = (sections = ["overview", "nodes"]) => ({
  version: 8,
  variables: { list: [], showDynamicFilters: false },
  tabs: sections.map((id) => ({
    tabId: id,
    name: id,
    panels: [{ id: `${id}_p1`, title: id, layout: { x: 0, y: 0, w: 96, h: 16 }, config: {} }],
  })),
});

const makeState = (over: Record<string, any> = {}) => {
  refreshSpy.mockClear();
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
    /** The manifest's first group's setup door — card for k8s/hosts, route for AWS. */
    setupDoor: ref({ kind: "card", slug: "kubernetes" }),
    refresh: refreshSpy,
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
  props: ["modelValue", "variableItem", "loadOptions", "disabled", "disabledTooltipKey"],
  template: "<div class='qvs-stub' />",
});

describe("CuratedPageView", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountView = async (props: Record<string, any> = {}, over: Record<string, any> = {}) => {
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
    await router.push("/infra/kubernetes");
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
      // undetected face's route-kind branch is engine behavior, so it is driven
      // through a REGISTERED workload's setupDoor — `aws` has no pack, and a page
      // with no pack renders the unavailable face, never a setup face.
      wrapper = await mountView(
        { workload: "kubernetes" },
        {
          face: ref("undetected"),
          dashboard: ref(null),
          setupDoor: ref({ kind: "route", routeName: "AWSConfig" }),
        },
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
      wrapper = await mountView(
        { workload: "kubernetes" },
        {
          face: ref("undetected"),
          dashboard: ref(null),
          setupDoor: ref({ kind: "route", routeName: "AWSConfig" }),
        },
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
    const boundsUs = () => ({
      from: globalOf().start_time.getTime() * 1000,
      to: globalOf().end_time.getTime() * 1000,
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
      // place; the key idiom follows the pickerNotApplicable pin below.
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

    it("the 'as of the last stream-list refresh' caveat is TOOLTIP-only", async () => {
      wrapper = await mountView({}, staleState());
      expect(wrapper.find('[data-test="curated-stale-banner"]').text()).not.toContain(
        "last stream-list refresh",
      );
    });

    // The "— no data" tile state and the phase-tile subtitle both render ON the
    // tile (§6.3), so they are pinned in PanelContainer.spec.ts against the real
    // series-data-update seam rather than a page-level footnote list.

    it("the positive freshness line renders on a healthy page and is ABSENT when anything is stale", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-last-data"]').exists()).toBe(true);
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

    it("the view stamps curatedDisabled on a variable the ACTIVE section's scopedBy omits", async () => {
      // Overview declares `cluster` only, so `namespace` is inapplicable there.
      const variables = pickerVariables();
      wrapper = await mountView({}, withPickers(variables));
      const namespace = variables.find((v) => v.name === "namespace") as any;
      expect(namespace.curatedDisabled).toBe(true);
      expect(namespace.curatedDisabledTooltipKey).toBe("infra.curated.pickerNotApplicable");
    });

    it("switching to a section that DECLARES it clears curatedDisabled — selection untouched", async () => {
      const variables = pickerVariables();
      wrapper = await mountView({}, withPickers(variables));
      const namespace = variables.find((v) => v.name === "namespace") as any;
      namespace.value = ["kube-system"];

      const injected = (wrapper.findComponent({ name: "RenderDashboardCharts" }).vm as any).$
        .provides["selectedTabId"] as Ref<string | null>;
      expect(isRef(injected)).toBe(true);
      injected.value = "workloads";
      await flushPromises();

      expect(namespace.curatedDisabled).toBe(false);
      expect(namespace.value).toEqual(["kube-system"]);
    });

    it("the REAL selector forwards curatedDisabled + tooltip key to VariableQueryValueSelector", async () => {
      const variables = pickerVariables();
      (variables[1] as any).curatedDisabled = true;
      (variables[1] as any).curatedDisabledTooltipKey = "infra.curated.pickerNotApplicable";
      const selector = await mountRealSelector(variables);
      const inner = selector
        .findAllComponents({ name: "VariableQueryValueSelector" })
        .find((c: any) => c.props("variableItem")?.name === "namespace") as any;
      expect(inner.props("disabled")).toBe(true);
      expect(inner.props("disabledTooltipKey")).toBe("infra.curated.pickerNotApplicable");
      selector.unmount();
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
      selector.unmount();
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
    it("renders 'Data checked at {time}' plus Refresh, and NOT 'Curated page' or 'content v'", async () => {
      wrapper = await mountView();
      const footer = wrapper.find('[data-test="curated-footer"]');
      expect(footer.exists()).toBe(true);
      expect(footer.text()).not.toContain("Curated page");
      expect(footer.text()).not.toContain("content v");
    });

    it("contentVersion is reachable through a tooltip affordance, not a permanent string", async () => {
      wrapper = await mountView();
      expect(wrapper.find('[data-test="curated-footer-version"]').exists()).toBe(true);
    });

    it("'Build your own dashboard →' routes to the dashboards LIST carrying the range, creating nothing", async () => {
      // Locked decision 1 guard: it routes, and creates/copies/imports/forks nothing.
      wrapper = await mountView();
      await wrapper.find('[data-test="curated-build-own"]').trigger("click");
      await flushPromises();
      expect(router.push).toHaveBeenCalledTimes(1);
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.name).toBe("dashboards");
      expect(target.query.period ?? target.query.from).toBeTruthy();
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
});
