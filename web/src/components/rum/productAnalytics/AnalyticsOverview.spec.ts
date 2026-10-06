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
import { defineComponent, h, KeepAlive, ref } from "vue";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const confirmMock = vi.hoisted(() => vi.fn(async (_o: Record<string, unknown>) => true));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import searchService from "@/services/search";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import AnalyticsOverview from "./AnalyticsOverview.vue";
import useNamedEvents, {
  readNamedEventHandoff,
  resetNamedEvents,
} from "@/composables/rum/useNamedEvents";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";

type Hit = Record<string, unknown>;

const SUMMARY: Hit = {
  sessions: 200,
  prev_sessions: 400,
  views: 600,
  va_rows: 1000,
  synthetic_sessions: 0,
  data_through_us: 1790000000000000,
  usr_email__values: 50,
  usr_email__sessions: 150,
};
const PAGES: Hit[] = [
  {
    k: "/web/logs",
    sessions: 150,
    prev_sessions: 100,
    views: 300,
    prev_views: 200,
    users: 20,
    prev_users: 15,
    rank_key: 150,
  },
  {
    k: "/web/metrics",
    sessions: 40,
    prev_sessions: 100,
    views: 50,
    prev_views: 120,
    users: 4,
    prev_users: 9,
    rank_key: 100,
  },
  {
    k: "/web/old",
    sessions: 0,
    prev_sessions: 80,
    views: 0,
    prev_views: 90,
    users: 0,
    prev_users: 7,
    rank_key: 80,
  },
  {
    k: "<img src=x onerror=alert(1)>",
    sessions: 3,
    prev_sessions: 3,
    views: 3,
    prev_views: 3,
    users: 1,
    prev_users: 1,
    rank_key: 3,
  },
];
const CLICKS: Hit[] = [
  {
    k: "Sign up now",
    sessions: 50,
    prev_sessions: 50,
    clicks: 90,
    prev_clicks: 90,
    users: 5,
    prev_users: 5,
    rank_key: 50,
  },
  {
    k: "menu-link-/logs-item",
    sessions: 10,
    prev_sessions: 12,
    clicks: 10,
    prev_clicks: 12,
    users: 2,
    prev_users: 2,
    rank_key: 12,
  },
];
const CLICK_PAGES: Hit[] = [
  { k: "Sign up now", pg: "/a", sessions: 20 },
  { k: "Sign up now", pg: "/b", sessions: 30 },
  { k: "Sign up now", pg: "/c", sessions: 1 },
];
const ENTRY: Hit[] = [
  {
    k: "/",
    entry_sessions: 120,
    prev_entry_sessions: 100,
    exit_sessions: 10,
    prev_exit_sessions: 9,
    rank_key: 239,
  },
];

type SearchArgs = { query: { query: { sql: string } }; signal?: AbortSignal };
type Route = [RegExp, Hit[] | ((args: SearchArgs) => never)];
let routes: Route[] = [];
const respond = () =>
  vi.mocked(searchService.search).mockImplementation((async (args: SearchArgs) => {
    const hit = routes.find(([re]) => re.test(args.query.query.sql));
    if (!hit) return { data: { hits: [] } };
    if (typeof hit[1] === "function") return hit[1](args);
    return { data: { hits: hit[1] } };
  }) as never);

// A search that stays in flight until released, and rejects as cancelled when its request is aborted.
const held = () => {
  const waiting: ((hits: Hit[]) => void)[] = [];
  const signals: AbortSignal[] = [];
  const fn = ((args: SearchArgs) =>
    new Promise((resolve, reject) => {
      if (args.signal) signals.push(args.signal);
      args.signal?.addEventListener("abort", () =>
        reject({ name: "CanceledError", code: "ERR_CANCELED" }),
      );
      waiting.push((hits) => resolve({ data: { hits } }));
    })) as never;
  return {
    fn,
    signals,
    pending: () => waiting.length,
    release: (hits: Hit[]) => waiting.splice(0).forEach((r) => r(hits)),
  };
};
const withRoute = (re: RegExp, v: Route[1]): Route[] =>
  baseRoutes().map(([r, x]) => (String(r) === String(re) ? [r, v] : [r, x]));
const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  for (let i = 0; i < 4; i++) await flushPromises();
};

const baseRoutes = (): Route[] => [
  [/AS app, COUNT/, [{ app: "web", sessions: 200 }]],
  [/va_rows/, [SUMMARY]],
  [/total_s/, [{ u: "a", s: 10, total_s: 150, n_values: 50 }]],
  [/entry_sessions/, ENTRY],
  [/AS pg, COUNT/, CLICK_PAGES],
  [/AS clicks/, CLICKS],
  [/AS views/, PAGES],
  [/AS dau/, [{ dau: 3, wau: 12, mau: 40 }]],
  [
    /e0_sessions/,
    [
      {
        e0_sessions: 150,
        e0_prev_sessions: 100,
        e0_events: 300,
        e0_prev_events: 200,
        e0_users: 20,
        e0_prev_users: 15,
        e1_sessions: 0,
        e1_prev_sessions: 0,
        e1_events: 0,
        e1_prev_events: 0,
        e1_users: 0,
        e1_prev_users: 0,
      },
    ],
  ],
];

const sqls = () =>
  vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false },
    timezone: "UTC",
    theme: "light",
  },
});

const reveal = vi.fn();
const TrendsStub = {
  name: "TrendsPanel",
  props: ["scope", "identity", "series", "events", "eventsStatus", "range"],
  emits: ["update:series", "retry-events"],
  methods: { reveal },
  template: "<div data-test='trends-stub' />",
};

const SAVED_SIGNUP = {
  id: "Signup0000000000000000000001",
  app: "web",
  name: "Signup",
  def: {
    steps: [
      { kind: "p" as const, key: "/a" },
      { kind: "p" as const, key: "/b" },
    ],
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  },
  sql: "SELECT 1",
  eventIds: [],
  version: 1,
  createdBy: "a@x.com",
  createdAt: 1,
  updatedBy: "a@x.com",
  updatedAt: 1,
};

describe("AnalyticsOverview", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;
  const show = ref(true);

  const mountOverview = async () => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/o", name: "productAnalyticsOverview", component: { template: "<div />" } },
        { path: "/f", name: "productAnalyticsFunnels", component: { template: "<div />" } },
        { path: "/fb", name: "productAnalyticsFunnelBuilder", component: { template: "<div />" } },
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/i", name: "frontendMonitoring", component: { template: "<div />" } },
        { path: "/en", name: "productAnalyticsEventNew", component: { template: "<div />" } },
      ],
    });
    await router.push("/o?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, show.value ? [h(AnalyticsOverview)] : []),
    });
    wrapper = mount(Host, {
      global: {
        plugins: [router, store],
        stubs: { TrendsPanel: TrendsStub },
      },
      attachTo: document.body,
    });
    await flushPromises();
    await flushPromises();
    await flushPromises();
  };

  const rowKeys = (table: string) =>
    wrapper!
      .findAll(`[data-test="${table}"] [data-test^="${table}-row-"][data-test$="-key"]`)
      .map((w) => w.text());

  beforeEach(() => {
    show.value = true;
    api.reset();
    resetNamedEvents();
    resetProductAnalytics();
    reveal.mockReset();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" } },
    };
    routes = baseRoutes();
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("renders the KPI strip and both ranked lists with no clicks (AC-1, AC-2)", async () => {
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-kpi-sessions"]').text()).toContain("200");
    expect(wrapper!.find('[data-test="rum-analytics-kpi-pages-per-session"]').text()).toContain(
      "3.0",
    );
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual([
      "/web/logs",
      "/web/metrics",
      "<img src=x onerror=alert(1)>",
    ]);
    const first = wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-sessions"]');
    expect(first.text()).toBe("150");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-users"]').text(),
    ).toBe("20");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-events"]').text(),
    ).toBe("300");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-share"]').text(),
    ).toContain("75.0%");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-delta"]').text(),
    ).toContain("+50.0%");
    expect(rowKeys("rum-analytics-overview-clicks-table")).toEqual([
      "Sign up now",
      "menu-link-/logs-item",
    ]);
    expect(document.querySelector("img")).toBeNull();
  });

  it("hides the users column without an identity (AC-2, AC-29)", async () => {
    routes = baseRoutes().map(([re, v]) =>
      String(re) === String(/total_s/)
        ? [re, [{ u: "guest", s: 150, total_s: 150, n_values: 1 }]]
        : [re, v],
    );
    respond();
    await mountOverview();
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-users"]').exists(),
    ).toBe(false);
    expect(wrapper!.find('[data-test="rum-analytics-active-users"]').exists()).toBe(false);
    expect(sqls().some((s) => s.includes("AS dau"))).toBe(false);
  });

  it("shows DAU, WAU and MAU when an identity resolves (AC-49)", async () => {
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-active-users-dau"]').text()).toContain("3");
    expect(wrapper!.find('[data-test="rum-analytics-active-users-wau"]').text()).toContain("12");
    expect(wrapper!.find('[data-test="rum-analytics-active-users-mau"]').text()).toContain("40");
  });

  const withIdentity = (summary: Hit, tops: Hit[]) => {
    routes = baseRoutes().map(([re, v]) => {
      if (String(re) === String(/va_rows/)) return [re, [{ ...SUMMARY, ...summary }]];
      if (String(re) === String(/total_s/)) return [re, tops];
      return [re, v];
    });
    respond();
  };

  it("a partial identity labels the user tile and active-users strip with its coverage (scope addition 6)", async () => {
    withIdentity({ sessions: 6400, usr_email__values: 174, usr_email__sessions: 6100 }, [
      { u: "synthetic-bot@synthetic.test", s: 5300, total_s: 6100, n_values: 174 },
      { u: "a@synthetic.test", s: 40, total_s: 6100, n_values: 174 },
    ]);
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-kpi-users"]').text()).toContain(
      "Identified users (12.5% of sessions)",
    );
    expect(wrapper!.find('[data-test="rum-analytics-active-users"]').text()).toContain(
      "Identified users (12.5% of sessions)",
    );
    expect(wrapper!.html()).not.toContain("synthetic-bot@synthetic.test");
  });

  it("a constant usr_email shows why no users count, with its share and never its value (scope addition 6)", async () => {
    withIdentity({ usr_email__values: 1, usr_email__sessions: 200 }, [
      { u: "placeholder@synthetic.test", s: 200, total_s: 200, n_values: 1 },
    ]);
    await mountOverview();
    const tile = wrapper!.find('[data-test="rum-analytics-kpi-users"]').text();
    expect(tile).toMatch(/placeholder/i);
    expect(tile).toContain("100.0%");
    expect(tile).not.toContain("No user id set");
    expect(wrapper!.html()).not.toContain("placeholder@synthetic.test");
    expect(wrapper!.find('[data-test="rum-analytics-active-users"]').exists()).toBe(false);
  });

  it("an anonymous id labels the tile and strip as Visitors (scope addition 6)", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_anonymous_id: { name: "usr_anonymous_id" } },
    };
    withIdentity({ usr_anonymous_id__values: 150, usr_anonymous_id__sessions: 180 }, [
      { u: "anon-1", s: 3, total_s: 180, n_values: 150 },
    ]);
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-kpi-users"]').text()).toContain("Visitors");
    expect(wrapper!.find('[data-test="rum-analytics-active-users"]').text()).toContain(
      "Active visitors",
    );
  });

  it("chips filter both lists and Not used shows previous-window values (AC-5)", async () => {
    await mountOverview();
    await wrapper!.find('[data-test="rum-analytics-overview-chip-rising"]').trigger("click");
    await flushPromises();
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual(["/web/logs"]);
    await wrapper!.find('[data-test="rum-analytics-overview-chip-not-used"]').trigger("click");
    await flushPromises();
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual(["/web/old"]);
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-prev-sessions"]').text(),
    ).toBe("80");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-funnel-btn"]').exists(),
    ).toBe(false);
  });

  it("hides Not used when the previous window has no data (AC-5)", async () => {
    routes = baseRoutes().map(([re, v]) =>
      String(re) === String(/va_rows/) ? [re, [{ ...SUMMARY, prev_sessions: 0 }]] : [re, v],
    );
    respond();
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-overview-chip-not-used"]').exists()).toBe(
      false,
    );
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-delta"]').text(),
    ).toContain("New");
  });

  it("shows an empty state with a one-click Last 30 days when nothing happened (AC-8)", async () => {
    routes = [
      [/va_rows/, [{ ...SUMMARY, sessions: 0 }]],
      [/AS app, COUNT/, [{ app: "web", sessions: 0 }]],
    ];
    respond();
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-overview-empty"]').exists()).toBe(true);
    await wrapper!.find('[data-test="rum-analytics-overview-widen-range-btn"]').trigger("click");
    await flushPromises();
    expect(useProductAnalytics().state.datetime.relativeTimePeriod).toBe("30d");
  });

  it("explains missing click tracking while pages still render (AC-8)", async () => {
    routes = baseRoutes().map(([re, v]) =>
      String(re) === String(/AS clicks/) ? [re, []] : [re, v],
    );
    respond();
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-overview-clicks-not-captured"]').exists()).toBe(
      true,
    );
    expect(wrapper!.find('[data-test="rum-analytics-overview-clicks-setup-link"]').exists()).toBe(
      true,
    );
    expect(rowKeys("rum-analytics-overview-pages-table")).toHaveLength(3);
  });

  it("a failed Clicks search shows Retry for that panel only (AC-9)", async () => {
    routes = baseRoutes().map(([re, v]) =>
      String(re) === String(/AS clicks/)
        ? [
            re,
            (() =>
              Promise.reject({
                response: { status: 429, data: { message: "queue full" } },
              })) as never,
          ]
        : [re, v],
    );
    respond();
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-overview-clicks-error"]').text()).toContain(
      "429",
    );
    expect(rowKeys("rum-analytics-overview-pages-table")).toHaveLength(3);
    routes = baseRoutes();
    respond();
    const before = sqls().length;
    await wrapper!.find('[data-test="rum-analytics-overview-clicks-retry-btn"]').trigger("click");
    await flushPromises();
    await flushPromises();
    expect(
      sqls()
        .slice(before)
        .filter((s) => s.includes("AS clicks")),
    ).toHaveLength(1);
    expect(
      sqls()
        .slice(before)
        .filter((s) => s.includes("AS views")),
    ).toHaveLength(0);
    expect(rowKeys("rum-analytics-overview-clicks-table")).toHaveLength(2);
  });

  it("switches Pages to the Entry view in one click (AC-42)", async () => {
    await mountOverview();
    await wrapper!.find('[data-test="rum-analytics-overview-pages-view-entry"]').trigger("click");
    await flushPromises();
    await flushPromises();
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual(["/"]);
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-events"]').exists(),
    ).toBe(false);
  });

  it("fills the Pages column and shows the actionNameAttribute hint for inner-text clicks (AC-57)", async () => {
    await mountOverview();
    await flushPromises();
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-clicks-table-row-0-pages"]').text(),
    ).toContain("3");
    expect(wrapper!.find('[data-test="rum-analytics-overview-clicks-name-hint"]').exists()).toBe(
      true,
    );
    const q5b = sqls().find((s) => s.includes("AS pg, COUNT"))!;
    expect(q5b).toContain("IN ('Sign up now', 'menu-link-/logs-item')");
  });

  it("Build funnel sets step 1 and opens Funnels in one click (AC-10)", async () => {
    await mountOverview();
    await wrapper!
      .find('[data-test="rum-analytics-overview-pages-table-row-0-funnel-btn"]')
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder");
    expect(useProductAnalytics().funnel.value.steps).toEqual([{ kind: "p", key: "/web/logs" }]);
  });

  it("Build funnel starts an unsaved funnel instead of overwriting the open saved one, asking first over its edits", async () => {
    await mountOverview();
    const pa = useProductAnalytics();
    pa.openSavedFunnel(SAVED_SIGNUP);
    pa.funnel.value = { ...SAVED_SIGNUP.def, breakdown: "browser" };
    confirmMock.mockClear().mockResolvedValueOnce(false);
    const btn = '[data-test="rum-analytics-overview-pages-table-row-0-funnel-btn"]';
    await wrapper!.find(btn).trigger("click");
    await flushPromises();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(pa.openedFunnel.value?.id).toBe(SAVED_SIGNUP.id);
    expect(router.currentRoute.value.name).not.toBe("productAnalyticsFunnelBuilder");
    await wrapper!.find(btn).trigger("click");
    await flushPromises();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps).toEqual([{ kind: "p", key: "/web/logs" }]);
    expect(router.currentRoute.value.name).toBe("productAnalyticsFunnelBuilder");
    expect(router.currentRoute.value.query.sf).toBeUndefined();
  });

  it("Paths anchors at the row in one click (AC-25)", async () => {
    await mountOverview();
    const btn = wrapper!.find('[data-test="rum-analytics-overview-clicks-table-row-1-paths-btn"]');
    expect(btn.text()).toBe("Paths from here");
    await btn.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsPaths");
    expect(useProductAnalytics().paths.value.anchor).toEqual({
      kind: "c",
      key: "menu-link-/logs-item",
    });
  });

  it("returning to a settled Overview shows its results without a new search (AC-38)", async () => {
    await mountOverview();
    const before = sqls().length;
    show.value = false;
    await flushPromises();
    show.value = true;
    await flushPromises();
    expect(sqls().length).toBe(before);
    expect(rowKeys("rum-analytics-overview-pages-table")).toHaveLength(3);
  });

  it("leaving aborts the search still in flight, and returning reruns only that one (AC-38)", async () => {
    const pages = held();
    routes = withRoute(/AS views/, pages.fn);
    respond();
    await mountOverview();
    expect(pages.pending()).toBe(1);
    const clicksBefore = sqls().filter((q) => q.includes("AS clicks")).length;
    show.value = false;
    await flushPromises();
    expect(pages.signals[0].aborted).toBe(true);
    routes = baseRoutes();
    respond();
    show.value = true;
    await settle();
    expect(rowKeys("rum-analytics-overview-pages-table")).toHaveLength(3);
    expect(sqls().filter((q) => q.includes("AS clicks")).length).toBe(clicksBefore);
  });

  it("Features does not stay loading after leaving while its search was in flight (W3)", async () => {
    api.seedEvent("web", "Logs page", { rules: [{ t: "view", op: "eq", value: "/web/logs" }] });
    const features = held();
    routes = withRoute(/e0_sessions/, features.fn);
    respond();
    await mountOverview();
    await settle();
    expect(features.pending()).toBe(1);
    show.value = false;
    await flushPromises();
    routes = baseRoutes();
    respond();
    show.value = true;
    await settle();
    expect(wrapper!.find('[data-test="rum-analytics-overview-features-loading"]').exists()).toBe(
      false,
    );
    expect(rowKeys("rum-analytics-overview-features-table")).toEqual(["Logs page"]);
  });

  it("starts no Overview searches once it is left while the scope is still loading (W33)", async () => {
    api.seedEvent("web", "Logs page", { rules: [{ t: "view", op: "eq", value: "/web/logs" }] });
    await useNamedEvents().load("org1", "web");
    const summary = held();
    routes = withRoute(/va_rows/, summary.fn);
    respond();
    await mountOverview();
    expect(summary.pending()).toBe(1);
    show.value = false;
    await flushPromises();
    const atLeave = sqls().length;
    summary.release([SUMMARY]);
    await settle();
    const whileAway = sqls().slice(atLeave);
    expect(whileAway.filter((q) => q.includes("AS views") || q.includes("e0_sessions"))).toEqual(
      [],
    );
    show.value = true;
    await settle();
    expect(rowKeys("rum-analytics-overview-pages-table")).toHaveLength(3);
    expect(rowKeys("rum-analytics-overview-features-table")).toEqual(["Logs page"]);
  });

  it("the Clicks table pages past page 1 and stays there while that page's click pages load (W2)", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      ...CLICKS[0],
      k: `btn-${String(i).padStart(2, "0")}`,
      sessions: 100 - i,
      rank_key: 100 - i,
    }));
    const clickPages = held();
    routes = withRoute(/AS clicks/, many);
    routes = routes.map(([r, x]) =>
      String(r) === String(/AS pg, COUNT/) ? [r, clickPages.fn] : [r, x],
    );
    respond();
    await mountOverview();
    clickPages.release([]);
    await settle();
    const table = "rum-analytics-overview-clicks-table";
    expect(rowKeys(table)[0]).toBe("btn-00");
    await wrapper!
      .find('[data-test="rum-analytics-overview-clicks"] [data-test="o2-table-next-page-btn"]')
      .trigger("click");
    await flushPromises();
    expect(rowKeys(table)[0]).toBe("btn-10");
    clickPages.release([{ k: "btn-10", pg: "/a", sessions: 1 }]);
    await settle();
    expect(rowKeys(table)[0]).toBe("btn-10");
    const lastPagesSql = sqls()
      .filter((q) => q.includes("AS pg, COUNT"))
      .at(-1)!;
    expect(lastPagesSql).toContain("'btn-10'");
    expect(lastPagesSql).not.toContain("'btn-00'");
  });

  it("the Entry view never shows a superseded scope's rows (W18)", async () => {
    await mountOverview();
    await wrapper!.find('[data-test="rum-analytics-overview-pages-view-entry"]').trigger("click");
    await settle();
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual(["/"]);
    const other = held();
    routes = withRoute(/entry_sessions/, other.fn);
    respond();
    const pa = useProductAnalytics();
    pa.setScope({ env: ["staging"] });
    await settle();
    expect(other.pending()).toBe(1);
    routes = baseRoutes();
    respond();
    pa.setScope({ env: [] });
    await settle();
    other.release([{ ...ENTRY[0], k: "/staging-only" }]);
    await settle();
    expect(rowKeys("rum-analytics-overview-pages-table")).toEqual(["/"]);
  });

  it("lists every named event in Features, including one with 0 uses, like the Pages row (AC-45)", async () => {
    api.seedEvent("web", "Logs page", { rules: [{ t: "view", op: "eq", value: "/web/logs" }] });
    api.seedEvent("web", "Never used", { rules: [{ t: "view", op: "eq", value: "/nowhere" }] });
    await mountOverview();
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(useNamedEvents().events.value).toHaveLength(2);
    expect(rowKeys("rum-analytics-overview-features-table")).toEqual(["Logs page", "Never used"]);
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-features-table-row-0-sessions"]').text(),
    ).toBe("150");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-sessions"]').text(),
    ).toBe("150");
    expect(
      wrapper!.find('[data-test="rum-analytics-overview-features-table-row-1-sessions"]').text(),
    ).toBe("0");
    expect(sqls().filter((s) => s.includes("e0_sessions"))).toHaveLength(1);
  });

  it("an event created while Overview was away is counted when it comes back, without rerunning Pages (AC-45)", async () => {
    api.seedEvent("web", "Logs page", { rules: [{ t: "view", op: "eq", value: "/web/logs" }] });
    await mountOverview();
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await flushPromises();
    show.value = false;
    await flushPromises();
    api.seedEvent("web", "Created elsewhere", { rules: [{ t: "view", op: "eq", value: "/web" }] });
    await useNamedEvents().load("org1", "web", true);
    await flushPromises();
    const featureSearches = () => sqls().filter((s) => s.includes("e0_sessions")).length;
    const pageSearches = () => sqls().filter((s) => s.includes("AS pg, COUNT")).length;
    const [features, pages] = [featureSearches(), pageSearches()];
    show.value = true;
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(featureSearches()).toBe(features + 1);
    expect(pageSearches()).toBe(pages);
    expect(rowKeys("rum-analytics-overview-features-table")).toContain("Created elsewhere");
  });

  it("the trend waits on the named events and drops a series whose event is gone once they are ready", async () => {
    api.seedEvent("web", "Logs page", { id: "LogsPage0000000000000000001" });
    const kept = { kind: "e" as const, key: "LogsPage0000000000000000001" };
    const page = { kind: "p" as const, key: "/web/logs" };
    useProductAnalytics().trendSeries.value = [
      kept,
      { kind: "e", key: "GoneEvent000000000000000001" },
      page,
    ];
    await mountOverview();
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 4; i++) await flushPromises();
    const trends = wrapper!.findComponent(TrendsStub);
    expect(trends.props("eventsStatus")).toBe("ready");
    expect(useProductAnalytics().trendSeries.value).toEqual([kept, page]);
    expect(trends.props("series")).toEqual([kept, page]);
    trends.vm.$emit("retry-events");
    await flushPromises();
    expect(useProductAnalytics().eventsStatus.value).toBe("ready");
  });

  it("Trend toggles the row on the chart, marks it plotted and brings the chart into view (scope addition 8, U1)", async () => {
    await mountOverview();
    const btn = () =>
      wrapper!.find('[data-test="rum-analytics-overview-pages-table-row-0-trend-btn"]');
    const logs = { kind: "p", key: "/web/logs" };
    expect(btn().attributes("aria-pressed")).toBe("false");
    await btn().trigger("click");
    await flushPromises();
    expect(useProductAnalytics().trendSeries.value).toEqual([logs]);
    expect(btn().attributes("aria-pressed")).toBe("true");
    expect(reveal).toHaveBeenCalledWith(logs);
    await btn().trigger("click");
    await flushPromises();
    expect(useProductAnalytics().trendSeries.value).toEqual([]);
    expect(btn().attributes("aria-pressed")).toBe("false");
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("at five series a plotted row still removes itself and the others explain the limit (scope addition 8, U1)", async () => {
    const logs = { kind: "p" as const, key: "/web/logs" };
    useProductAnalytics().trendSeries.value = [
      logs,
      { kind: "c", key: "a" },
      { kind: "c", key: "b" },
      { kind: "c", key: "c" },
      { kind: "c", key: "d" },
    ];
    await mountOverview();
    const row = (i: number) =>
      wrapper!.find(`[data-test="rum-analytics-overview-pages-table-row-${i}-trend-btn"]`);
    expect(row(1).attributes("disabled")).toBeDefined();
    expect(row(0).attributes("disabled")).toBeUndefined();
    await row(0).trigger("click");
    await flushPromises();
    expect(useProductAnalytics().trendSeries.value).toHaveLength(4);
    expect(useProductAnalytics().trendSeries.value).not.toContainEqual(logs);
    expect(reveal).not.toHaveBeenCalled();
    expect(row(1).attributes("disabled")).toBeUndefined();
  });

  it("offers to create a named event when none exist, and Define as event pre-fills the click (AC-45, AC-57)", async () => {
    await mountOverview();
    expect(wrapper!.find('[data-test="rum-analytics-overview-features-empty"]').exists()).toBe(
      true,
    );
    await flushPromises();
    await wrapper!
      .find('[data-test="rum-analytics-overview-clicks-table-row-0-define-event-btn"]')
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsEventNew");
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d" });
    expect(readNamedEventHandoff(router.options.history.state)).toEqual({
      draft: {
        name: "Sign up now",
        rules: [{ t: "action", targets: ["Sign up now"], onPage: "/b" }],
      },
      pageHints: ["/b", "/a", "/c"],
      from: "overview",
    });
  });

  it("the Features empty state's Create named event opens a blank editor that returns to Overview", async () => {
    await mountOverview();
    await flushPromises();
    await wrapper!
      .find('[data-test="rum-analytics-overview-features-empty"] button')
      .trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("productAnalyticsEventNew");
    expect(readNamedEventHandoff(router.options.history.state)).toEqual({
      draft: null,
      pageHints: [],
      from: "overview",
    });
  });
});
