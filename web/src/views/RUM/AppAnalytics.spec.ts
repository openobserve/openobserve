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

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createRouter, createWebHistory, type Router } from "vue-router";
import { createStore } from "vuex";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const mockGetStream = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: mockGetStream }) }));

import searchService from "@/services/search";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import usePerformance from "@/composables/rum/usePerformance";
import AppAnalytics from "./AppAnalytics.vue";
import AnalyticsOverview from "@/components/rum/productAnalytics/AnalyticsOverview.vue";
import AnalyticsPaths from "@/components/rum/productAnalytics/AnalyticsPaths.vue";
import AnalyticsPanelState from "@/components/rum/productAnalytics/AnalyticsPanelState.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import useProductAnalytics, {
  querySignature,
  resetProductAnalytics,
} from "@/composables/rum/useProductAnalytics";
import useNamedEvents, { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { encodeDef, MAX_EVENTS_PER_APP, stepRefParam } from "@/utils/rum/productAnalyticsModel";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";

const Child = { name: "AnalyticsOverview", template: "<div data-test='child-view' />" };

const SUMMARY = {
  sessions: 100,
  prev_sessions: 90,
  views: 300,
  va_rows: 3666563,
  synthetic_sessions: 7,
  data_through_us: 1790000000000000,
  usr_email__values: 181,
  usr_email__sessions: 90,
};

const respond = (hits: [RegExp, Record<string, unknown>[]][]) =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
  }) => {
    const hit = hits.find(([re]) => re.test(args.query.query.sql));
    return { data: { hits: hit ? hit[1] : [] } };
  }) as never);

const makeRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      {
        path: "/product-analytics",
        name: PA_ROUTES.shell,
        component: AppAnalytics,
        children: [
          { path: "overview", name: PA_ROUTES.overview, component: Child },
          { path: "funnels", name: PA_ROUTES.funnels, component: Child },
          { path: "funnels/build", name: PA_ROUTES.funnelBuilder, component: Child },
          { path: "paths", name: PA_ROUTES.paths, component: Child },
          { path: "retention", name: PA_ROUTES.retention, component: Child },
          { path: "events", name: PA_ROUTES.events, component: Child },
        ],
      },
      { path: "/product-analytics/events/new", name: PA_ROUTES.eventNew, component: Child },
      { path: "/setup", name: "frontendMonitoring", component: Child },
      { path: "/rum", name: "RUM", component: { template: "<div data-test='rum-view' />" } },
    ],
  });

// MainLayout keeps the shell alive, so leaving and coming back reactivates it instead of remounting.
const KeptAliveRoot = {
  template: `<router-view v-slot="{ Component }"><keep-alive include="AppAnalytics"><component :is="Component" /></keep-alive></router-view>`,
};

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false, web_url: "http://x" },
    timezone: "UTC",
    theme: "light",
  },
});

describe("AppAnalytics shell", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;
  let replaceSpy: ReturnType<typeof vi.spyOn>;
  let setSavedDateSpy: ReturnType<typeof vi.fn>;

  const mountAt = async (path: string, keepAlive = false) => {
    router = makeRouter();
    await router.push(path);
    replaceSpy = vi.spyOn(router, "replace");
    setSavedDateSpy = vi.fn();
    wrapper = mount(keepAlive ? KeptAliveRoot : { template: "<router-view />" }, {
      global: {
        plugins: [router, store],
        stubs: {
          DateTimePickerDashboard: {
            template: "<div data-test='date-picker-stub' />",
            props: ["modelValue"],
            methods: { setSavedDate: (d: unknown) => setSavedDateSpy(d) },
          },
          ShareButton: { template: "<button data-test='share-stub' />", props: ["url"] },
        },
      },
      attachTo: document.body,
    });
    await flushPromises();
    await flushPromises();
  };

  beforeEach(() => {
    api.reset();
    resetNamedEvents();
    resetSavedFunnels();
    resetProductAnalytics();
    vi.mocked(searchService.search).mockReset();
    mockGetStream.mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" }, session_type: { name: "session_type" } },
    };
    respond([
      [
        /AS app, COUNT/,
        [
          { app: "web", sessions: 100 },
          { app: "shop", sessions: 3 },
        ],
      ],
      [/va_rows/, [SUMMARY]],
      [/total_s/, [{ u: "bot", s: 80, total_s: 90, n_values: 181 }]],
    ]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("shows the five sub-tabs, Named events after Retention, and highlights the routed one (AC-40)", async () => {
    await mountAt("/product-analytics/funnels?period=7d");
    const tabs = wrapper!
      .findAll('[data-test^="rum-analytics-subtab-"][role="tab"]')
      .map((el) => [el.attributes("data-test"), el.text()]);
    expect(tabs).toEqual([
      ["rum-analytics-subtab-overview", "Overview"],
      ["rum-analytics-subtab-funnels", "Funnels"],
      ["rum-analytics-subtab-paths", "Paths"],
      ["rum-analytics-subtab-retention", "Retention"],
      ["rum-analytics-subtab-events", "Named events"],
    ]);
    expect(
      wrapper!.find('[data-test="rum-analytics-subtab-funnels"]').attributes("data-state"),
    ).toBe("active");
  });

  it("lights Funnels on the funnel builder route", async () => {
    await mountAt("/product-analytics/funnels/build?app=web&period=7d");
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(
      wrapper!.find('[data-test="rum-analytics-subtab-funnels"]').attributes("data-state"),
    ).toBe("active");
  });

  it("the Named events sub-tab opens the list page with the current scope", async () => {
    await mountAt("/product-analytics/overview?app=web&period=30d");
    const tab = wrapper!.find('[data-test="rum-analytics-subtab-events"]');
    await tab.trigger("mousedown");
    await tab.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.events);
    expect(router.currentRoute.value.query.app).toBe("web");
    expect(router.currentRoute.value.query.period).toBe("30d");
    expect(
      wrapper!.find('[data-test="rum-analytics-subtab-events"]').attributes("data-state"),
    ).toBe("active");
  });

  describe("a link that carries no scope (the rail tile and its flyout)", () => {
    it("keeps the app and range when switching sub-tab from the flyout", async () => {
      await mountAt("/product-analytics/overview?app=shop&period=30d");
      await router.push({ name: PA_ROUTES.paths, query: { org_identifier: "org1" } });
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.paths);
      expect(router.currentRoute.value.query.app).toBe("shop");
      expect(router.currentRoute.value.query.period).toBe("30d");
    });

    it("resumes the last sub-tab and scope when the page is opened again", async () => {
      await mountAt("/product-analytics/retention?app=shop&period=30d");
      wrapper!.unmount();
      await mountAt("/product-analytics?org_identifier=org1");
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.retention);
      expect(router.currentRoute.value.query.app).toBe("shop");
      expect(router.currentRoute.value.query.period).toBe("30d");
    });

    it("the rail tile on a kept-alive shell resumes the last sub-tab instead of an empty body (F1)", async () => {
      await mountAt("/product-analytics/retention?app=shop&period=30d", true);
      const shellUid = () => wrapper!.findComponent(AppAnalytics).vm.$.uid;
      const shell = shellUid();
      await router.push("/rum");
      await flushPromises();
      expect(wrapper!.find('[data-test="rum-view"]').exists()).toBe(true);
      replaceSpy.mockClear();
      await router.push({ path: "/product-analytics", query: { org_identifier: "org1" } });
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(shellUid()).toBe(shell);
      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.retention);
      expect(router.currentRoute.value.query.app).toBe("shop");
      expect(router.currentRoute.value.query.period).toBe("30d");
      expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(true);
    });

    it("the rail tile clicked while the shell is showing resumes the current sub-tab (F1)", async () => {
      await mountAt("/product-analytics/paths?app=shop&period=30d", true);
      await router.push({ path: "/product-analytics", query: { org_identifier: "org1" } });
      for (let i = 0; i < 3; i++) await flushPromises();
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.paths);
      expect(router.currentRoute.value.query.app).toBe("shop");
      expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(true);
    });

    it("starts fresh in another organization", async () => {
      await mountAt("/product-analytics/overview?app=shop&period=30d");
      wrapper!.unmount();
      store.state.selectedOrganization = { identifier: "org2" };
      try {
        await mountAt("/product-analytics/overview?org_identifier=org2");
        expect(router.currentRoute.value.query.app).toBe("web");
        expect(router.currentRoute.value.query.period).toBe("7d");
      } finally {
        store.state.selectedOrganization = { identifier: "org1" };
      }
    });
  });

  describe("organization switch on the kept-alive shell", () => {
    const settle = async () => {
      await new Promise((r) => setTimeout(r, 30));
      for (let i = 0; i < 4; i++) await flushPromises();
    };
    const switchTo = async (org: string, name: string = PA_ROUTES.events) => {
      store.state.selectedOrganization = { identifier: org };
      await router.push({ name, query: { org_identifier: org, app: "web", period: "7d" } });
      await settle();
    };
    afterEach(() => {
      store.state.selectedOrganization = { identifier: "org1" };
    });

    it("re-reads the schema, the write permission and the scope for the new org (W1, W6, W22)", async () => {
      api.seedEvent("web", "A", { rules: [{ t: "view", op: "eq", value: "/" }] });
      await mountAt("/product-analytics/events?app=web&period=7d", true);
      await settle();
      const cta = () => wrapper!.find('[data-test="rum-analytics-named-events-new-btn"]');
      expect(cta().exists()).toBe(true);
      api.failNext("deleteEvent", 403);
      await useNamedEvents()
        .remove("org1", "web", useNamedEvents().events.value[0].id)
        .catch(() => null);
      await flushPromises();
      expect(cta().exists()).toBe(false);
      mockGetStream.mockResolvedValue({
        name: "_rumdata",
        schema: [{ name: "application_id" }, { name: "session_id" }],
      });
      await switchTo("org2");
      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", true);
      expect(useProductAnalytics().schema.value).toEqual({
        application_id: true,
        session_id: true,
      });
      const org2Summary = vi
        .mocked(searchService.search)
        .mock.calls.filter(
          (c) => c[0].org_identifier === "org2" && String(c[0].query.query.sql).includes("va_rows"),
        );
      expect(org2Summary).toHaveLength(1);
      expect(cta().exists()).toBe(true);
    });

    it("an org without RUM shows RUM setup instead of the previous org's columns (W1)", async () => {
      await mountAt("/product-analytics/overview?app=web&period=7d", true);
      await settle();
      expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(true);
      mockGetStream.mockRejectedValue(new Error("Stream not found"));
      vi.mocked(searchService.search).mockRejectedValue({
        response: { status: 400, data: { code: 20002, message: "Search stream not found" } },
      });
      await switchTo("org2", PA_ROUTES.overview);
      expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(true);
    });
  });

  it("the SDK sampling caveat is reachable by keyboard (W30)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-sdk-sampling"]').attributes("tabindex")).toBe(
      "0",
    );
  });

  it("names the icon-only refresh button (W20)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-refresh-btn"]').attributes("aria-label")).toBe(
      "Refresh",
    );
  });

  it("shows the RUM setup state when no RUM data exists yet", async () => {
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    respond([[/AS app, COUNT/, []]]);
    await mountAt("/product-analytics/overview");
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="rum-empty-web-card"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(false);
    await wrapper!.find('[data-test="rum-empty-web-card"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("frontendMonitoring");
  });

  it("a failed probe shows the error panel with Retry, not RUM setup, even with no schema (F4)", async () => {
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    vi.mocked(searchService.search).mockRejectedValue({
      response: { status: 503, data: { code: 20009, message: "search is down" } },
    });
    await mountAt("/product-analytics/overview");
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-scope-error"]').text()).toContain(
      "search is down",
    );
    expect(wrapper!.find('[data-test="rum-analytics-scope-retry-btn"]').exists()).toBe(true);
  });

  it("an org with no _rumdata stream, whose probe answers stream not found, shows RUM setup (F4)", async () => {
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    vi.mocked(searchService.search).mockRejectedValue({
      response: {
        status: 400,
        data: { code: 20002, message: "Search stream not found: _rumdata" },
      },
    });
    await mountAt("/product-analytics/overview");
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="rum-analytics-scope-error"]').exists()).toBe(false);
  });

  it("a bookmarked ?app= on an org with no _rumdata stream still shows RUM setup, without a summary query (F9)", async () => {
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    vi.mocked(searchService.search).mockRejectedValue({
      response: {
        status: 400,
        data: { code: 20002, message: "Search stream not found: _rumdata" },
      },
    });
    await mountAt("/product-analytics/overview?app=shop&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="rum-analytics-scope-error"]').exists()).toBe(false);
    const sqls = vi
      .mocked(searchService.search)
      .mock.calls.map((c) => (c[0] as { query: { query: { sql: string } } }).query.query.sql);
    expect(sqls.some((sql) => /AS prev_sessions/.test(sql))).toBe(false);
    expect(useProductAnalytics().state.app).toBe("");
  });

  it("does not show the RUM setup state while data exists", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(true);
  });

  it("the bare analytics route moves to its sub-tab before the scope has loaded, so the tab's own wait shows", async () => {
    vi.mocked(searchService.search).mockImplementation(
      (() => new Promise(() => undefined)) as never,
    );
    await mountAt("/product-analytics?org_identifier=org1");
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    expect(router.currentRoute.value.query.org_identifier).toBe("org1");
    expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(true);
  });

  it("opening the bare analytics route lands on Overview with the busiest app in the URL (AC-1, AC-6)", async () => {
    await mountAt("/product-analytics");
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.overview);
    expect(router.currentRoute.value.query.app).toBe("web");
    expect(router.currentRoute.value.query.period).toBe("7d");
  });

  it("states data through on the refresh tooltip and the SDK sampling caveat beside the title (AC-54)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-trust-caption"]').exists()).toBe(false);
    const tips = wrapper!.findAllComponents(OTooltip).map((c) => String(c.props("content") ?? ""));
    expect(tips.some((c) => /^Refresh · data through 2026/.test(c))).toBe(true);
    const sampling = wrapper!.find('[data-test="rum-analytics-sdk-sampling"]');
    expect(sampling.attributes("aria-label")).toBe("Counts reflect sampled SDK sessions");
    expect(
      wrapper!
        .find('[data-test="rum-analytics-title"]')
        .find('[data-test="rum-analytics-sdk-sampling"]')
        .exists(),
    ).toBe(false);
  });

  it("names the excluded identity share, never the value, and Include it sets idall (AC-50)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    const note = wrapper!.find('[data-test="rum-analytics-identity-note"]');
    expect(note.text()).toContain("89");
    expect(document.body.textContent).not.toContain("bot");
    await note.trigger("click");
    await flushPromises();
    await document
      .querySelector<HTMLElement>('[data-test="rum-analytics-identity-include-btn"]')
      ?.click();
    await flushPromises();
    expect(router.currentRoute.value.query.idall).toBe("1");
  });

  describe("a dominant value that moves identity to another field (F34)", () => {
    const TWO_FIELD_SUMMARY = {
      ...SUMMARY,
      sessions: 1000,
      usr_email__values: 100,
      usr_email__sessions: 950,
      usr_anonymous_id__values: 300,
      usr_anonymous_id__sessions: 400,
    };
    const note = () => wrapper!.find('[data-test="rum-analytics-identity-note"]');
    const toggle = () =>
      document.querySelector<HTMLElement>('[data-test="rum-analytics-identity-include-btn"]');
    const openNote = async () => {
      await note().trigger("click");
      await flushPromises();
    };
    const clickToggle = async () => {
      toggle()!.click();
      await flushPromises();
      await flushPromises();
    };

    beforeEach(() => {
      usePerformance().performanceState.data.streams._rumdata = {
        name: "_rumdata",
        schema: {
          usr_email: { name: "usr_email" },
          usr_anonymous_id: { name: "usr_anonymous_id" },
          session_type: { name: "session_type" },
        },
      };
      respond([
        [/AS app, COUNT/, [{ app: "web", sessions: 1000 }]],
        [/va_rows/, [TWO_FIELD_SUMMARY]],
        [
          /NULLIF\(usr_email, ''\)[\s\S]*total_s/,
          [
            { u: "dominant-synthetic", s: 830, total_s: 950, n_values: 100 },
            { u: "a-synthetic", s: 9, total_s: 950, n_values: 100 },
          ],
        ],
        [
          /NULLIF\(usr_anonymous_id, ''\)[\s\S]*total_s/,
          [{ u: "anon-synthetic", s: 4, total_s: 400, n_values: 300 }],
        ],
      ]);
    });

    it("shows the note and Include it without idall, then Exclude again with idall=1, and gets back", async () => {
      await mountAt("/product-analytics/overview?app=web&period=7d");
      expect(useProductAnalytics().identity.value?.field).toBe("usr_anonymous_id");
      expect(note().exists()).toBe(true);
      expect(note().text()).toContain("87");
      await openNote();
      expect(
        document.querySelector('[data-test="rum-analytics-identity-help"]')?.textContent,
      ).toContain("One usr_email value covers 87%");
      expect(
        document.querySelector('[data-test="rum-analytics-identity-help"]')?.textContent,
      ).toContain("users are counted by usr_anonymous_id");
      expect(toggle()!.textContent).toContain("Include it");
      await clickToggle();
      expect(router.currentRoute.value.query.idall).toBe("1");
      expect(useProductAnalytics().identity.value?.field).toBe("usr_email");
      expect(note().exists()).toBe(true);
      expect(note().text()).toContain("All identity values included");
      await openNote();
      expect(
        document.querySelector('[data-test="rum-analytics-identity-help"]')?.textContent,
      ).toContain("It is counted in every users count");
      expect(toggle()!.textContent).toContain("Exclude again");
      await clickToggle();
      expect(router.currentRoute.value.query.idall).toBeUndefined();
      expect(useProductAnalytics().identity.value?.field).toBe("usr_anonymous_id");
      expect(note().exists()).toBe(true);
      expect(document.body.textContent).not.toMatch(
        /dominant-synthetic|a-synthetic|anon-synthetic/,
      );
    });

    it("a link opened with idall=1 can exclude the value again", async () => {
      await mountAt("/product-analytics/overview?app=web&period=7d&idall=1");
      expect(useProductAnalytics().identity.value?.field).toBe("usr_email");
      expect(note().exists()).toBe(true);
      await openNote();
      expect(toggle()!.textContent).toContain("Exclude again");
      await clickToggle();
      expect(router.currentRoute.value.query.idall).toBeUndefined();
      expect(useProductAnalytics().identity.value?.field).toBe("usr_anonymous_id");
    });
  });

  it("shows the sampled tag on sampled sub-tabs only, and Run exact sets exact=1 (AC-52)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-sampled-tag"]').exists()).toBe(false);
    await router.push({ name: PA_ROUTES.paths, query: router.currentRoute.value.query });
    await flushPromises();
    const tag = wrapper!.find('[data-test="rum-analytics-sampled-tag"]');
    expect(tag.text()).toContain("1 in 4");
    await tag.trigger("click");
    await flushPromises();
    document.querySelector<HTMLElement>('[data-test="rum-analytics-run-exact-btn"]')?.click();
    await flushPromises();
    expect(router.currentRoute.value.query.exact).toBe("1");
  });

  it("warns once when part of the link was invalid (D-45)", async () => {
    await mountAt("/product-analytics/funnels/build?app=web&period=7d&funnel=%25%25");
    expect(wrapper!.find('[data-test="rum-analytics-invalid-link"]').exists()).toBe(true);
  });

  it("changing the app writes it to the URL and reloads the scope (AC-6)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    const before = vi.mocked(searchService.search).mock.calls.length;
    const vm = wrapper!.findComponent(AppAnalytics).vm as unknown as {
      onAppChange: (v: string) => void;
    };
    vm.onAppChange("shop");
    await flushPromises();
    await flushPromises();
    expect(router.currentRoute.value.query.app).toBe("shop");
    expect(vi.mocked(searchService.search).mock.calls.length).toBeGreaterThan(before);
  });

  it("one env or version reloads the scope once, and the URL parsed back still matches the synced signature (F3)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    const vm = wrapper!.findComponent(AppAnalytics).vm as unknown as {
      onEnvChange: (v: string[]) => void;
      onVersionChange: (v: string[]) => void;
    };
    const summaries = () =>
      vi
        .mocked(searchService.search)
        .mock.calls.filter((c) => /va_rows/.test((c[0] as any).query.query.sql)).length;
    const before = summaries();
    vm.onEnvChange(["prod"]);
    await flushPromises();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toContain("env=prod");
    expect(summaries()).toBe(before + 1);
    vm.onVersionChange(["1.0"]);
    await flushPromises();
    await flushPromises();
    expect(summaries()).toBe(before + 2);
    // Back, reload and keep-alive returns read the query parsed from the URL, where one value is a string.
    const parsed = router.resolve(router.currentRoute.value.fullPath).query;
    expect(parsed.env).toBe("prod");
    expect(querySignature(parsed)).toBe(useProductAnalytics().syncedSignature.value);
  });

  it("the Named events tab puts New event in the header, which opens the editor with the scope (AC-44)", async () => {
    api.seedEvent("web", "A", { rules: [{ t: "view", op: "eq", value: "/" }] });
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    const cta = () => wrapper!.find('[data-test="rum-analytics-named-events-new-btn"]');
    expect(cta().exists()).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-named-events-btn"]').exists()).toBe(false);
    await router.push({ name: PA_ROUTES.events, query: router.currentRoute.value.query });
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(cta().text()).toBe("New event");
    expect(cta().attributes("disabled")).toBeUndefined();
    await cta().trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.eventNew);
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d" });
  });

  it("hides New event for a read-only role and disables it at the cap", async () => {
    for (let i = 0; i < MAX_EVENTS_PER_APP; i++) api.seedEvent("web", `E${i}`);
    await mountAt("/product-analytics/events?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 3; i++) await flushPromises();
    const cta = () => wrapper!.find('[data-test="rum-analytics-named-events-new-btn"]');
    expect(cta().attributes("disabled")).toBeDefined();
    api.failNext("deleteEvent", 403);
    await useNamedEvents()
      .remove("org1", "web", useNamedEvents().events.value[0].id)
      .catch(() => null);
    await flushPromises();
    expect(useNamedEvents().permission.value).toBe("read");
    expect(cta().exists()).toBe(false);
  });

  it("the Funnels list puts New funnel in the header, never the builder, and it opens an empty unsaved builder", async () => {
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/a"],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await useSavedFunnels().ensure("org1", "web");
    await flushPromises();
    const cta = () => wrapper!.find('[data-test="rum-analytics-saved-funnels-new-btn"]');
    expect(cta().exists()).toBe(false);
    await router.push({ name: PA_ROUTES.funnels, query: router.currentRoute.value.query });
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(cta().text()).toBe("New funnel");
    const pa = useProductAnalytics();
    pa.openSavedFunnel(useSavedFunnels().funnels.value[0]);
    await cta().trigger("click");
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d" });
    expect(router.currentRoute.value.query.sf).toBeUndefined();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps).toEqual([]);
    expect(cta().exists()).toBe(false);
  });

  it("the list URL names no funnel, and going back to it keeps the funnel being built", async () => {
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/a"],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountAt("/product-analytics/funnels?app=web&period=7d");
    await useSavedFunnels().ensure("org1", "web");
    const pa = useProductAnalytics();
    pa.openSavedFunnel(useSavedFunnels().funnels.value[0]);
    await pa.pushSubTab(router, PA_ROUTES.funnelBuilder);
    pa.funnel.value = { ...pa.funnel.value, unit: "users", window: "1d" };
    await pa.syncUrl(router);
    expect(router.currentRoute.value.query.sf).toBeDefined();
    await pa.pushSubTab(router, PA_ROUTES.funnels);
    await flushPromises();
    expect(router.currentRoute.value.query).not.toHaveProperty("sf");
    expect(router.currentRoute.value.query).not.toHaveProperty("funnel");
    await pa.pushSubTab(router, PA_ROUTES.funnelBuilder);
    router.back();
    for (let i = 0; i < 4; i++) await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    expect(pa.openedFunnel.value?.name).toBe("Signup");
    expect(pa.funnel.value.unit).toBe("users");
  });

  it("keeps New funnel for a read-only role, since building needs no write, and hides it when the list cannot be read", async () => {
    api.seedFunnel("web", "Signup", {
      s: [
        ["p", "/a"],
        ["p", "/b"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountAt("/product-analytics/funnels?app=web&period=7d");
    await useSavedFunnels().ensure("org1", "web");
    await flushPromises();
    const cta = () => wrapper!.find('[data-test="rum-analytics-saved-funnels-new-btn"]');
    expect(cta().exists()).toBe(true);
    api.failNext("deleteFunnel", 403);
    await useSavedFunnels()
      .remove("org1", "web", useSavedFunnels().funnels.value[0].id)
      .catch(() => null);
    await flushPromises();
    expect(useSavedFunnels().permission.value).toBe("read");
    expect(cta().exists()).toBe(true);
    resetSavedFunnels();
    api.failNext("listFunnels", 403);
    await useSavedFunnels().ensure("org1", "web");
    await flushPromises();
    expect(useSavedFunnels().status("org1", "web")).toBe("forbidden");
    expect(cta().exists()).toBe(false);
  });

  it("drops a named-event step that no longer exists from a shared link and says so (D-45)", async () => {
    const funnel = encodeDef({
      s: [
        ["p", "/a"],
        ["e", "GoneEvent000000000000000001"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountAt(`/product-analytics/funnels/build?app=web&period=7d&funnel=${funnel}`);
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(useProductAnalytics().funnel.value.steps).toEqual([{ kind: "p", key: "/a" }]);
    expect(wrapper!.find('[data-test="rum-analytics-deleted-event-link"]').exists()).toBe(true);
    expect(useNamedEvents().events.value).toEqual([]);
  });

  it("keeps a shared link's named-event steps when the events fail to load (F12)", async () => {
    api.failNext("listEvents", 503);
    const funnel = encodeDef({
      s: [
        ["p", "/a"],
        ["e", "KeptKeptKept000000000000001"],
      ],
      u: "sessions",
      w: "session",
    });
    await mountAt(`/product-analytics/funnels/build?app=web&period=7d&funnel=${funnel}`);
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(useProductAnalytics().funnel.value.steps).toEqual([
      { kind: "p", key: "/a" },
      { kind: "e", key: "KeptKeptKept000000000000001" },
    ]);
    expect(router.currentRoute.value.query.funnel).toBe(funnel);
    expect(wrapper!.find('[data-test="rum-analytics-deleted-event-link"]').exists()).toBe(false);
  });

  it("the date picker re-announcing the range it was given, as it does on mount, reloads nothing (AC-19)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    const scopeSearches = () =>
      vi
        .mocked(searchService.search)
        .mock.calls.filter((c) => /va_rows/.test((c[0] as any).query.query.sql)).length;
    const before = scopeSearches();
    const key = useProductAnalytics().scopeKey.value;
    const shell = wrapper!.findComponent(AppAnalytics).vm as unknown as {
      onDateChange: (v: Record<string, unknown>) => void;
    };
    shell.onDateChange({
      valueType: "relative",
      relativeTimePeriod: "7d",
      startTime: 1,
      endTime: 2,
    });
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(scopeSearches()).toBe(before);
    expect(useProductAnalytics().scopeKey.value).toBe(key);
    shell.onDateChange({
      valueType: "relative",
      relativeTimePeriod: "30d",
      startTime: 1,
      endTime: 2,
    });
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(scopeSearches()).toBeGreaterThan(before);
    expect(router.currentRoute.value.query.period).toBe("30d");
  });

  it("a reload or shared link moves the already-mounted picker, not just the model (P1-M1)", async () => {
    const setSavedDate = vi.fn();
    router = makeRouter();
    await router.push("/product-analytics/overview?app=web&period=4w");
    wrapper = mount(
      { template: "<router-view />" },
      {
        global: {
          plugins: [router, store],
          stubs: {
            DateTimePickerDashboard: {
              props: ["modelValue"],
              setup: (_: unknown, { expose }: { expose: (e: object) => void }) => {
                expose({ setSavedDate });
                return {};
              },
              template: "<div data-test='date-picker-stub' />",
            },
            ShareButton: { template: "<button data-test='share-stub' />", props: ["url"] },
          },
        },
        attachTo: document.body,
      },
    );
    await flushPromises();
    await flushPromises();

    expect(useProductAnalytics().state.datetime).toMatchObject({
      valueType: "relative",
      relativeTimePeriod: "4w",
    });
    expect(setSavedDate).toHaveBeenCalledWith({ type: "relative", relativeTimePeriod: "4w" });
  });

  it("switching sub-tabs with a new range in the URL moves the mounted picker too (P1-M1)", async () => {
    const setSavedDate = vi.fn();
    router = makeRouter();
    await router.push("/product-analytics/overview?app=web&period=7d");
    wrapper = mount(
      { template: "<router-view />" },
      {
        global: {
          plugins: [router, store],
          stubs: {
            DateTimePickerDashboard: {
              props: ["modelValue"],
              setup: (_: unknown, { expose }: { expose: (e: object) => void }) => {
                expose({ setSavedDate });
                return {};
              },
              template: "<div data-test='date-picker-stub' />",
            },
            ShareButton: { template: "<button data-test='share-stub' />", props: ["url"] },
          },
        },
        attachTo: document.body,
      },
    );
    await flushPromises();
    await flushPromises();
    setSavedDate.mockClear();

    await router.push("/product-analytics/funnels?app=web&period=4w");
    await flushPromises();
    await flushPromises();

    expect(setSavedDate).toHaveBeenCalledWith({ type: "relative", relativeTimePeriod: "4w" });
  });

  it("widening the range to 30d after a no-data result also moves the picker's own label", async () => {
    await mountAt("/product-analytics/overview?app=web&period=15m");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    setSavedDateSpy.mockClear();
    useProductAnalytics().widenRange(router);
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(router.currentRoute.value.query.period).toBe("30d");
    expect(setSavedDateSpy).toHaveBeenCalledWith({ type: "relative", relativeTimePeriod: "30d" });
  });

  it("mounting inside keep-alive enters once, as a plain mount does (F6)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    const plain = replaceSpy.mock.calls.length;
    wrapper!.unmount();
    wrapper = null;
    resetProductAnalytics();
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(plain).toBe(1);
    expect(replaceSpy.mock.calls.length).toBe(plain);
  });

  it("reopening the URL it last wrote, as Back from the Session Viewer does, resumes without reloading the scope (AC-19)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    const scopeSearches = () =>
      vi
        .mocked(searchService.search)
        .mock.calls.filter((c) =>
          /AS app, COUNT|va_rows|total_s/.test((c[0] as any).query.query.sql),
        ).length;
    const before = scopeSearches();
    const written = router.currentRoute.value.fullPath;
    const key = useProductAnalytics().scopeKey.value;
    wrapper!.unmount();
    wrapper = null;
    await mountAt(written);
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    expect(scopeSearches()).toBe(before);
    expect(useProductAnalytics().scopeKey.value).toBe(key);
  });

  it("a cross-link that changes the definition lands without re-entering or reloading the scope (F18)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await new Promise((r) => setTimeout(r, 30));
    await flushPromises();
    const scopeSearches = () =>
      vi
        .mocked(searchService.search)
        .mock.calls.filter((c) =>
          /AS app, COUNT|va_rows|total_s/.test((c[0] as any).query.query.sql),
        ).length;
    const before = scopeSearches();
    const replace = replaceSpy.mockClear();
    const pa = useProductAnalytics();
    pa.funnel.value = {
      steps: [{ kind: "p", key: "/a" }],
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    await pa.pushSubTab(router, PA_ROUTES.funnelBuilder);
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(router.currentRoute.value.query.funnel).toBeTruthy();
    pa.paths.value = { ...pa.paths.value, anchor: { kind: "p", key: "/a" }, cohort: null };
    await pa.pushSubTab(router, PA_ROUTES.paths);
    for (let i = 0; i < 3; i++) await flushPromises();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.paths);
    expect(router.currentRoute.value.query.anchor).toBeTruthy();
    expect(scopeSearches()).toBe(before);
    expect(replace).not.toHaveBeenCalled();
    expect(pa.funnel.value.steps).toEqual([{ kind: "p", key: "/a" }]);
  });
});

describe("pa gap fixes (scope bar and Exclusions drawer)", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;
  const settingsApi = api.service as unknown as Record<string, Mock>;
  const appSettings = (over: Record<string, unknown> = {}) => ({
    id: "web-settings-id",
    app: "web",
    bots: true,
    builtinBots: {
      version: 1,
      families: ["HeadlessChrome", "PhantomJS", "Spider", "BuiltinListedFamily"],
      devices: ["Spider"],
    },
    sessions: [],
    pages: [],
    version: 1,
    rulesHash: "0123456789abcdef",
    createdBy: "admin@x.com",
    createdAt: 1,
    updatedBy: "admin@x.com",
    updatedAt: 1,
    ...over,
  });
  const NEVER_SAVED = {
    id: null,
    version: 0,
    createdBy: null,
    createdAt: null,
    updatedBy: null,
    updatedAt: null,
  };
  const EXCLUDED_SUMMARY = {
    ...SUMMARY,
    sessions: 1673,
    total_sessions: 14008,
    builtin_kept_sessions: 1752,
  };
  const STAFF_RULE = { field: "usr_email", op: "suffix", values: ["@openobserve.ai"] };
  const UA_RE = /AS dev/;
  const BOT_UA = [{ ua: "PingdomBot", dev: "Other", sessions: 500 }];

  const withHits = (extra: [RegExp, Record<string, unknown>[]][], summary = EXCLUDED_SUMMARY) =>
    respond([
      ...extra,
      [
        /AS app, COUNT/,
        [
          { app: "web", sessions: 100 },
          { app: "shop", sessions: 3 },
        ],
      ],
      [/va_rows/, [summary]],
      [/total_s/, [{ u: "a", s: 10, total_s: 150, n_values: 50 }]],
    ]);

  const realRouter = () =>
    createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/product-analytics",
          name: PA_ROUTES.shell,
          component: AppAnalytics,
          children: [
            { path: "overview", name: PA_ROUTES.overview, component: AnalyticsOverview },
            { path: "funnels", name: PA_ROUTES.funnels, component: Child },
            { path: "funnels/build", name: PA_ROUTES.funnelBuilder, component: Child },
            { path: "paths", name: PA_ROUTES.paths, component: AnalyticsPaths },
            { path: "retention", name: PA_ROUTES.retention, component: Child },
            { path: "events", name: PA_ROUTES.events, component: Child },
          ],
        },
        { path: "/product-analytics/events/new", name: PA_ROUTES.eventNew, component: Child },
        { path: "/setup", name: "frontendMonitoring", component: Child },
      ],
    });

  const settle = async () => {
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 5; i++) await flushPromises();
  };

  const mountAt = async (path: string, real = false) => {
    router = real ? realRouter() : makeRouter();
    await router.push(path);
    wrapper = mount(
      { template: "<router-view />" },
      {
        global: {
          plugins: [router, store],
          stubs: {
            DateTimePickerDashboard: { template: "<div />", props: ["modelValue"] },
            ShareButton: { template: "<button data-test='share-stub' />", props: ["url"] },
            TrendsPanel: { name: "TrendsPanel", template: "<div />" },
            PathsFlow: { name: "PathsFlow", template: "<div />" },
            PathSessionsDrawer: { name: "PathSessionsDrawer", template: "<div />" },
          },
        },
        attachTo: document.body,
      },
    );
    await settle();
  };

  const chip = () =>
    wrapper!
      .findAll("*")
      .filter((e) => /^\s*App filters\b[\s\S]*\d/.test(e.text()))
      .at(-1);
  const body = () => document.body.textContent ?? "";
  const buttonIn = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button, a, [role='button']")].find(
      (b) => b.textContent?.trim() === label,
    );
  const drawer = () =>
    [...document.querySelectorAll<HTMLElement>("[role='dialog']")].find((d) =>
      d.textContent?.includes("Built-in bot rule"),
    );
  const openDrawer = async () => {
    await chip()!.trigger("click");
    await settle();
  };
  const botSwitch = (d: HTMLElement) =>
    d.querySelector<HTMLElement>('[data-test="rum-analytics-exclusions-builtin-switch-btn"]')!;
  const isDisabled = (el: Element | undefined) =>
    !!el &&
    ((el as HTMLButtonElement).disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      el.hasAttribute("data-disabled"));
  const hasValue = (root: HTMLElement, value: string) =>
    !!root.textContent?.includes(value) ||
    [...root.querySelectorAll<HTMLInputElement>("input, textarea")].some((i) =>
      i.value.includes(value),
    );
  const searchCount = (re: RegExp) =>
    vi.mocked(searchService.search).mock.calls.filter((c) => re.test(c[0].query.query.sql)).length;
  const previewLine = (d: HTMLElement) =>
    [...d.querySelectorAll<HTMLElement>("*")]
      .filter((e) => /\d[\d,]* of 14,008 sessions remain/.test(e.textContent ?? ""))
      .at(-1)!;
  // Tone is compared as markup with the numbers masked, so no class name is pinned.
  const toneOf = (el: HTMLElement) => {
    const chain = [el, el.parentElement, el.parentElement?.parentElement]
      .map((e) => (e ? `${e.tagName}.${e.getAttribute("class") ?? ""}` : ""))
      .join(">");
    return `${chain}|${el.outerHTML.replace(/\d[\d,]*/g, "#")}`;
  };
  const uaSearches = () =>
    vi.mocked(searchService.search).mock.calls.filter((c) => UA_RE.test(c[0].query.query.sql))
      .length;

  beforeEach(() => {
    api.reset();
    resetNamedEvents();
    resetSavedFunnels();
    resetProductAnalytics();
    vi.mocked(searchService.search).mockReset();
    mockGetStream.mockReset();
    usePerformance().performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: {
        usr_email: { name: "usr_email" },
        session_type: { name: "session_type" },
        user_agent_user_agent_family: { name: "user_agent_user_agent_family" },
        user_agent_device_family: { name: "user_agent_device_family" },
      },
    };
    settingsApi.getAppSettings.mockImplementation(async () => ({ data: appSettings() }));
    settingsApi.putAppSettings.mockImplementation(async (_o: string, _a: string, body: object) => ({
      data: appSettings({ ...body, version: 2, rulesHash: "fedcba9876543210" }),
    }));
    withHits([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("P7-R2: the chip reads Exclusions 1 on day one, for the built-in rule of an app with no row", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({ data: appSettings(NEVER_SAVED) }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(chip()?.text()).toMatch(/^\s*App filters\s*·?\s*1\b/);
  });

  it("P7-R2: N counts the built-in rule and the session rules, never the ignored pages", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({
        sessions: [STAFF_RULE, { field: "geo_info_country", op: "eq", values: ["XX"] }],
        pages: [
          { op: "eq", value: "/web/login" },
          { op: "eq", value: "/web/cb" },
          { op: "prefix", value: "/web/org/" },
        ],
      }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(chip()?.text()).toMatch(/^\s*App filters\s*·?\s*3\b/);
  });

  it("P7-R2: with the built-in rule off, N is the session rules only", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ bots: false, sessions: [STAFF_RULE] }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(chip()?.text()).toMatch(/^\s*App filters\s*·?\s*1\b/);
  });

  it("P7-R2: the chip says likely bot found when the Overview banner fires for a user agent", async () => {
    withHits([[UA_RE, BOT_UA]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(chip()?.text()).toContain("likely bot found");
  });

  it("P7-R2: the App filters button shows a warning icon when it says likely bot found", async () => {
    const chipTone = async (rows: Record<string, unknown>[]) => {
      resetProductAnalytics();
      withHits([[UA_RE, rows]]);
      await mountAt("/product-analytics/overview?app=web&period=7d", true);
      const btn = wrapper!.find('[data-test="rum-analytics-exclusions-chip"]');
      const out = {
        text: btn.text(),
        icons: btn.findAllComponents({ name: "OIcon" }).map((i) => i.props("name")),
      };
      wrapper!.unmount();
      wrapper = null;
      document.body.innerHTML = "";
      return out;
    };
    const normal = await chipTone([{ ua: "Chrome", dev: "Other", sessions: 1500 }]);
    const warned = await chipTone(BOT_UA);
    expect(normal.text).toMatch(/^\s*App filters/);
    expect(warned.text).toContain("likely bot found");
    expect(normal.icons).toContain("filter-alt");
    expect(warned.icons).toContain("warning");
  });

  it("P7-R2: no likely bot found without a banner", async () => {
    withHits([[UA_RE, [{ ua: "Chrome", dev: "Other", sessions: 1500 }]]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(
      vi.mocked(searchService.search).mock.calls.some((c) => UA_RE.test(c[0].query.query.sql)),
    ).toBe(true);
    expect(chip()?.text()).not.toContain("likely bot found");
  });

  it("one click on the chip opens the drawer, which lists the removed counts and the include switch", async () => {
    withHits([[UA_RE, []]]);
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const view = () =>
      document.querySelector<HTMLElement>('[data-test="rum-analytics-exclusions-view"]')!;
    expect(view().textContent).toContain("Built-in bot rule 12,256");
    expect(view().textContent).toContain("Saved rules 79");
    expect(view().textContent).toContain("Synthetic tests 7 · always excluded");
    expect(view().textContent).toContain("Include hidden sessions in this view");
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-app-filters-include-switch-btn"]')!
      .click();
    await settle();
    expect(useProductAnalytics().state.includeExcluded).toBe(true);
    expect(router.currentRoute.value.query.xall).toBe("1");
  });

  it("while hidden sessions are included every tab shows the banner, and Hide hidden sessions drops xall", async () => {
    await mountAt("/product-analytics/paths?app=web&period=7d&xall=1");
    const banner = () =>
      document.querySelector<HTMLElement>('[data-test="rum-analytics-included-banner"]');
    expect(banner()?.textContent).toContain("hidden by app filters in this view only");
    buttonIn(document.body, "Hide hidden sessions")!.click();
    await settle();
    expect(useProductAnalytics().state.includeExcluded).toBe(false);
    expect(router.currentRoute.value.query.xall).toBeUndefined();
    expect(banner()).toBeNull();
  });

  it("P6-R11: an identity suggestion fires the banner but not the chip's warning tone", async () => {
    withHits([
      [UA_RE, []],
      [/total_s/, [{ u: "staff@x.com", s: 40, total_s: 150, n_values: 50 }]],
    ]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(buttonIn(document.body, "Review app filters")).toBeDefined();
    expect(chip()?.text()).not.toContain("likely bot found");
  });

  it("P7-R3: the chip opens the drawer with the Built-in bot rule row, its switch, the sessions it removes and the listed names", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(drawer()).toBeUndefined();
    await openDrawer();
    const d = drawer()!;
    expect(d).toBeDefined();
    expect(d.querySelector("[role='switch']")).not.toBeNull();
    expect(d.textContent).toContain("12,256");
    expect(d.innerHTML).toContain("BuiltinListedFamily");
  });

  it("P7-R3: with nothing to suggest the drawer says Nothing stands out in this range", async () => {
    withHits([[UA_RE, [{ ua: "Chrome", dev: "Other", sessions: 1500 }]]]);
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    expect(drawer()!.textContent).toContain("Nothing stands out in this range");
  });

  it("P7-R3: the live preview reads M of <total> sessions remain, with Cancel and Save", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ sessions: [STAFF_RULE] }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const d = drawer()!;
    expect(d.textContent).toMatch(/1,673 of 14,008 sessions remain/);
    expect(buttonIn(d, "Cancel")).toBeDefined();
    expect(buttonIn(d, "Save")).toBeDefined();
  });

  it("P7-R3: rules that exclude everything read 0 of <total> sessions remain, in another tone, and keep Save enabled", async () => {
    const render = async (sessions: number) => {
      resetProductAnalytics();
      withHits([], { ...EXCLUDED_SUMMARY, sessions });
      await mountAt("/product-analytics/overview?app=web&period=7d");
      await openDrawer();
      const d = drawer()!;
      const line = previewLine(d);
      const out = {
        text: line.textContent ?? "",
        tone: toneOf(line),
        saveDisabled: isDisabled(buttonIn(d, "Save")),
      };
      wrapper!.unmount();
      wrapper = null;
      document.body.innerHTML = "";
      return out;
    };
    const some = await render(1673);
    const none = await render(0);
    expect(some.text).toMatch(/1,673 of 14,008 sessions remain/);
    expect(none.text).toMatch(/\b0 of 14,008 sessions remain/);
    expect(none.tone).not.toBe(some.tone);
    expect(none.saveDisabled).toBe(false);
  });

  it("P7-R3: Save sends a PUT with the drawer's edit and the version that was read", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ version: 7, sessions: [STAFF_RULE] }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const d = drawer()!;
    botSwitch(d).click();
    await settle();
    buttonIn(d, "Save")!.click();
    await settle();
    expect(settingsApi.putAppSettings).toHaveBeenCalledTimes(1);
    const [org, app, body] = settingsApi.putAppSettings.mock.calls[0];
    expect([org, app]).toEqual(["org1", "web"]);
    expect(body).toMatchObject({ bots: false, version: 7, sessions: [STAFF_RULE], pages: [] });
  });

  it("a page picked in the Hidden pages picker is saved as a page rule", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const d = drawer()!;
    d.querySelector<HTMLElement>('[data-test="rum-analytics-exclusions-add-page"]')!.click();
    await settle();
    const input = document.querySelector<HTMLInputElement>(
      '[data-test="rum-analytics-app-filter-page-picker-value"] input, input[data-test="rum-analytics-app-filter-page-picker-value"]',
    )!;
    input.value = "/health";
    input.dispatchEvent(new Event("input"));
    await settle();
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-app-filter-page-picker-apply"]')!
      .click();
    await settle();
    expect(d.querySelector('[data-test="rum-analytics-exclusions-page-0"]')?.textContent).toContain(
      "Page is /health",
    );
    buttonIn(d, "Save")!.click();
    await settle();
    const body = settingsApi.putAppSettings.mock.calls[0][2];
    expect(body).toMatchObject({ pages: [{ op: "eq", value: "/health" }] });
  });

  it("re-applying an unchanged is rule from its chip keeps it an eq rule", async () => {
    const rule = { field: "geo_info_country", op: "eq", values: ["XX"] };
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ sessions: [rule] }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const d = drawer()!;
    d.querySelector<HTMLElement>('[data-test="rum-analytics-exclusions-rule-0-chip"]')!.click();
    await settle();
    document
      .querySelector<HTMLElement>('[data-test="rum-analytics-funnel-field-picker-apply"]')!
      .click();
    await settle();
    buttonIn(d, "Save")!.click();
    await settle();
    expect(settingsApi.putAppSettings.mock.calls[0][2]).toMatchObject({ sessions: [rule] });
  });

  it("P6-R6: a drawer Save reloads the settings into scope.exclusions and re-runs the summary without re-probing apps", async () => {
    let stored = appSettings();
    settingsApi.getAppSettings.mockImplementation(async () => ({ data: stored }));
    settingsApi.putAppSettings.mockImplementation(
      async (_o: string, _a: string, body: Record<string, unknown>) => {
        stored = appSettings({
          ...body,
          version: Number(body.version) + 1,
          rulesHash: "fedcba9876543210",
        });
        return { data: stored };
      },
    );
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const reads = settingsApi.getAppSettings.mock.calls.length;
    const probes = searchCount(/AS app, COUNT/);
    const summaries = searchCount(/va_rows/);
    const d = drawer()!;
    botSwitch(d).click();
    await settle();
    buttonIn(d, "Save")!.click();
    await settle();
    expect(settingsApi.getAppSettings.mock.calls.length).toBeGreaterThan(reads);
    const scope = useProductAnalytics().scope.value as unknown as { exclusions: unknown };
    expect(scope.exclusions).toMatchObject({ bots: false, rulesHash: "fedcba9876543210" });
    expect(searchCount(/AS app, COUNT/)).toBe(probes);
    expect(searchCount(/va_rows/)).toBeGreaterThan(summaries);
  });

  it("P7-R3: the drawer lists a bot-like user-agent suggestion", async () => {
    withHits([[UA_RE, BOT_UA]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    await openDrawer();
    expect(drawer()!.textContent).toContain("PingdomBot");
    expect(drawer()!.textContent).not.toContain("Nothing stands out in this range");
  });

  it("P7-R4: with no stored row the audit line reads Built-in default · never saved", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({ data: appSettings(NEVER_SAVED) }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    expect(drawer()!.textContent).toContain("Built-in default · never saved");
  });

  it("P7-R5: a 409 on Save reloads the rules and says re-apply your change", async () => {
    settingsApi.putAppSettings.mockImplementation(async () => {
      throw {
        response: {
          status: 409,
          data: {
            code: "version_conflict",
            message: "version_conflict",
            current: appSettings({
              version: 5,
              sessions: [{ field: "usr_email", op: "suffix", values: ["@reloaded-only.example"] }],
            }),
          },
        },
      };
    });
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    const d = drawer()!;
    botSwitch(d).click();
    await settle();
    buttonIn(d, "Save")!.click();
    await settle();
    expect(settingsApi.putAppSettings).toHaveBeenCalledTimes(1);
    expect(drawer()!.textContent).toContain(
      "Reloaded with the latest app filters, re-apply your change",
    );
    expect(hasValue(drawer()!, "@reloaded-only.example")).toBe(true);
  });

  it("P7-R6: a rule on a field the stream lacks is marked field not in this stream", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ sessions: [{ field: "geo_info_country", op: "eq", values: ["XX"] }] }),
    }));
    await mountAt("/product-analytics/overview?app=web&period=7d");
    await openDrawer();
    expect(drawer()!.textContent).toContain("field not in this stream");
  });

  it("P7-R8: Review app filters on the Overview banner opens the drawer", async () => {
    withHits([[UA_RE, BOT_UA]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(drawer()).toBeUndefined();
    buttonIn(document.body, "Review app filters")!.click();
    await settle();
    expect(drawer()).toBeDefined();
  });

  it("P7-R10: Edit app filters on a deep link to an ignored Paths anchor opens the drawer", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({ pages: [{ op: "eq", value: "/web/login" }] }),
    }));
    const anchor = encodeDef(stepRefParam({ kind: "p", key: "/web/login" }));
    await mountAt(`/product-analytics/paths?app=web&period=7d&anchor=${anchor}`, true);
    expect(body()).toContain("This page is hidden by the app filters");
    buttonIn(document.body, "Edit app filters")!.click();
    await settle();
    expect(drawer()).toBeDefined();
  });

  it("P7-R10: the Paths footnote naming the ignored pages links to the drawer", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => ({
      data: appSettings({
        pages: [
          { op: "eq", value: "/web/login" },
          { op: "eq", value: "/web/cb" },
        ],
      }),
    }));
    const anchor = encodeDef(stepRefParam({ kind: "p", key: "/" }));
    await mountAt(`/product-analytics/paths?app=web&period=7d&anchor=${anchor}`, true);
    const footnote = [...document.querySelectorAll<HTMLElement>("*")]
      .filter((e) => {
        const tx = e.textContent ?? "";
        return (
          tx.includes("/web/login") &&
          tx.includes("/web/cb") &&
          !!e.querySelector("button, a, [role='button']")
        );
      })
      .at(-1);
    expect(footnote).toBeDefined();
    expect(drawer()).toBeUndefined();
    footnote!.querySelector<HTMLElement>("button, a, [role='button']")!.click();
    await settle();
    expect(drawer()).toBeDefined();
  });

  it("P6-R8: the user-agent query runs once for Overview and the drawer, survives a Save, and reruns after refresh", async () => {
    withHits([[UA_RE, [{ ua: "Chrome", dev: "Other", sessions: 1500 }]]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(uaSearches()).toBe(1);
    await openDrawer();
    expect(uaSearches()).toBe(1);
    const d = drawer()!;
    botSwitch(d).click();
    await settle();
    buttonIn(d, "Save")!.click();
    await settle();
    expect(settingsApi.putAppSettings).toHaveBeenCalledTimes(1);
    expect(uaSearches()).toBe(1);
    await useProductAnalytics().refresh();
    await settle();
    expect(uaSearches()).toBe(2);
  });

  it("P6-R8: resetProductAnalytics clears the user-agent suggestions, so the query runs again", async () => {
    withHits([[UA_RE, [{ ua: "Chrome", dev: "Other", sessions: 1500 }]]]);
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(uaSearches()).toBe(1);
    wrapper!.unmount();
    wrapper = null;
    resetProductAnalytics();
    await mountAt("/product-analytics/overview?app=web&period=7d", true);
    expect(uaSearches()).toBe(2);
  });

  it("P7-R18: a failed settings read shows an error state in place of the views", async () => {
    settingsApi.getAppSettings.mockImplementation(async () => {
      throw { response: { status: 403, data: { code: "forbidden", message: "forbidden" } } };
    });
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(settingsApi.getAppSettings).toHaveBeenCalled();
    expect(wrapper!.find('[data-test="child-view"]').exists()).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-no-data"]').exists()).toBe(false);
    expect(
      wrapper!.findComponent(OEmptyState).exists() ||
        wrapper!.findComponent(AnalyticsPanelState).exists(),
    ).toBe(true);
  });

  it("P7-R13: New users only is disabled with a tooltip in Sessions mode and enabled in Users mode", async () => {
    const chipFor = async (unit: string) => {
      const funnel = encodeDef({
        s: [
          ["p", "/a"],
          ["p", "/b"],
        ],
        u: unit,
        w: "session",
      });
      await mountAt(`/product-analytics/funnels/build?app=web&period=7d&funnel=${funnel}`);
      const el = wrapper!
        .findAll("button, [role='button'], [role='checkbox'], [role='switch']")
        .find((e) => e.text().includes("New users only"));
      expect(el).toBeDefined();
      const disabled = isDisabled(el!.element);
      const host = el!.element.parentElement ?? el!.element;
      const tooltip =
        el!.element.hasAttribute("title") ||
        el!.element.hasAttribute("aria-describedby") ||
        wrapper!.findAllComponents(OTooltip).some((c) => host.contains(c.element));
      wrapper!.unmount();
      wrapper = null;
      return { disabled, tooltip };
    };
    expect(await chipFor("sessions")).toEqual({ disabled: true, tooltip: true });
    resetProductAnalytics();
    expect((await chipFor("users")).disabled).toBe(false);
  });

  it("P7-R13: the App select shows the compared apps", async () => {
    await mountAt("/product-analytics/overview?app=web&apps=shop&period=7d");
    const select = wrapper!.find('[data-test="rum-analytics-app-select"]');
    expect(select.text()).toContain("web");
    expect(select.text()).toContain("shop");
  });
});
