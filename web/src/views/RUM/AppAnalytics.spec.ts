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
import useProductAnalytics, {
  querySignature,
  resetProductAnalytics,
} from "@/composables/rum/useProductAnalytics";
import useNamedEvents, { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { encodeDef, MAX_EVENTS_PER_APP } from "@/utils/rum/productAnalyticsModel";
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

  const mountAt = async (path: string, keepAlive = false) => {
    router = makeRouter();
    await router.push(path);
    replaceSpy = vi.spyOn(router, "replace");
    wrapper = mount(keepAlive ? KeptAliveRoot : { template: "<router-view />" }, {
      global: {
        plugins: [router, store],
        stubs: {
          DateTimePickerDashboard: {
            template: "<div data-test='date-picker-stub' />",
            props: ["modelValue"],
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

  it("states data through, the SDK sampling caveat and excluded synthetic sessions (AC-54)", async () => {
    await mountAt("/product-analytics/overview?app=web&period=7d");
    expect(wrapper!.find('[data-test="rum-analytics-data-through"]').text()).toContain("2026");
    expect(wrapper!.find('[data-test="rum-analytics-sdk-sampling"]').exists()).toBe(true);
    expect(wrapper!.find('[data-test="rum-analytics-synthetic-excluded"]').text()).toContain("7");
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
