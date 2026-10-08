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

import searchService from "@/services/search";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import DropoffDrawer from "./DropoffDrawer.vue";
import type { FunnelCohort } from "@/utils/rum/productAnalyticsQueries";

type Hit = Record<string, unknown>;

const NEXT: Hit[] = [
  { is_next: 0, kind: null, k: null, units: 19 },
  { is_next: 1, kind: "p", k: "/web/dashboards/view", units: 41 },
  { is_next: 1, kind: "c", k: "menu-link-/logs-item", units: 12 },
];
const HEALTH = (dropped: number): Hit[] => [
  { side: "converted", units: 71, sessions: 80, with_error: 4, with_frustration: 0 },
  { side: "dropped", units: dropped, sessions: 104, with_error: 16, with_frustration: 0 },
];
const SESSIONS = (total: number): Hit[] => [
  {
    sid: "s-replay",
    step_t: 1790000000000,
    errors: 2,
    frustrations: 0,
    has_replay: 1,
    started: 1789999990000,
    ended: 1790000372000,
    user_label: "a@x.com",
    total,
  },
  {
    sid: "s-plain",
    step_t: 1790000100000,
    errors: 0,
    frustrations: 0,
    has_replay: 0,
    started: 1790000000000,
    ended: 1790000048000,
    user_label: null,
    total,
  },
];

let health = HEALTH(87);
let sessions = SESSIONS(87);
let summaryExtra: Record<string, unknown> = {};
let tops: Record<string, unknown>[] = [];
let nextPage: ((args: { signal?: AbortSignal }) => Promise<unknown>) | null = null;
const respond = () =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
    signal?: AbortSignal;
  }) => {
    const sql = args.query.query.sql;
    if (nextPage && /cs AS \(SELECT sid/.test(sql) && /OFFSET 200/.test(sql)) return nextPage(args);
    if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 500 }] } };
    if (/va_rows/.test(sql))
      return {
        data: {
          hits: [{ sessions: 500, prev_sessions: 1, views: 1, va_rows: 1000, ...summaryExtra }],
        },
      };
    if (/total_s/.test(sql)) return { data: { hits: tops } };
    if (/nu0 AS/.test(sql)) return { data: { hits: NEXT } };
    if (/hu AS/.test(sql)) return { data: { hits: health } };
    if (/cs AS \(SELECT sid/.test(sql)) return { data: { hits: sessions } };
    return { data: { hits: [] } };
  }) as never);

const sqls = () =>
  vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);

const cohort: FunnelCohort = {
  funnel: {
    steps: [
      { kind: "p", key: "/web/dashboards" },
      { kind: "c", key: "dashboard-add-btn" },
    ],
    unit: "sessions",
    window: "session",
    breakdown: null,
  },
  stepIndex: 1,
  side: "dropped",
};

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
  },
});

describe("DropoffDrawer", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  const mountDrawer = async (props: Record<string, unknown> = {}) => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/f", name: "productAnalyticsFunnels", component: { template: "<div />" } },
        { path: "/s/:id", name: "SessionViewer", component: { template: "<div />" } },
      ],
    });
    await router.push("/f?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    wrapper = mount(DropoffDrawer, {
      props: { open: true, cohort, sampled: 1, expectedDropped: 87, ...props },
      global: { plugins: [router, store] },
      attachTo: document.body,
    });
    for (let i = 0; i < 4; i++) await flushPromises();
  };

  const body = () => document.body.textContent ?? "";
  const q = (dt: string) => document.querySelector<HTMLElement>(`[data-test="${dt}"]`);

  beforeEach(() => {
    resetProductAnalytics();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    health = HEALTH(87);
    sessions = SESSIONS(87);
    summaryExtra = {};
    tops = [];
    nextPage = null;
    respond();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("shows the dropped count, what they did instead with Left the app first, and Other (AC-16)", async () => {
    await mountDrawer();
    expect(q("rum-analytics-dropoff-drawer")?.textContent).toContain("87");
    const rows = [
      ...document.querySelectorAll('[data-test^="rum-analytics-dropoff-next-row-"]'),
    ].map((r) => r.textContent ?? "");
    expect(rows[0]).toContain("Left the app");
    expect(rows[0]).toContain("19");
    expect(rows[1]).toContain("/web/dashboards/view");
    expect(rows.at(-1)).toContain("Other");
    expect(rows.at(-1)).toContain("15");
  });

  it("compares the error rate of dropped and converted units and hides frustration without the field (AC-16)", async () => {
    await mountDrawer();
    const compare = q("rum-analytics-dropoff-compare")!.textContent ?? "";
    expect(compare).toContain("18.4%");
    expect(compare).toContain("5.6%");
    expect(q("rum-analytics-dropoff-frustration-dropped")).toBeNull();
  });

  it("lists dropped sessions replay first with health and opens one at the step moment (AC-17)", async () => {
    await mountDrawer();
    expect(q("rum-analytics-dropoff-sessions")?.textContent).toContain("All 87 sessions listed");
    const first = q("rum-analytics-dropoff-sessions-row-0")!;
    expect(first.textContent).toContain("a@x.com");
    expect(q("rum-analytics-dropoff-sessions-row-0-replay")!.textContent).toContain("Replay");
    expect(q("rum-analytics-dropoff-sessions-row-1-replay")!.textContent).toContain("No replay");
    expect(q("rum-analytics-dropoff-sessions-row-1")!.textContent).toContain("Unknown user");
    first.click();
    await flushPromises();
    const route = router.currentRoute.value;
    expect(route.name).toBe("SessionViewer");
    expect(route.params.id).toBe("s-replay");
    expect(route.query).toMatchObject({
      event_time: "1790000000000",
      start_time: "1790000000000000",
      end_time: "1790000000000000",
      from: "analytics",
      af_step: "1",
      af_label: "/web/dashboards",
      af_kind: "p",
    });
  });

  it("re-runs once and then flags a count that disagrees with the funnel (AC-59)", async () => {
    health = HEALTH(80);
    await mountDrawer();
    expect(sqls().filter((s) => /hu AS/.test(s))).toHaveLength(2);
    expect(q("rum-analytics-dropoff-incomplete")).not.toBeNull();
  });

  it("does not guard sampled drawers, and scales their counts (AC-52, AC-59)", async () => {
    health = HEALTH(20);
    sessions = SESSIONS(20);
    await mountDrawer({ sampled: 4 });
    expect(sqls().filter((s) => /hu AS/.test(s))).toHaveLength(1);
    expect(q("rum-analytics-dropoff-incomplete")).toBeNull();
    expect(body()).toContain("~80");
    expect(sqls().find((s) => /nu0 AS/.test(s))).toContain("md5(session_id)");
  });

  it("a users cohort under a partial identity names identified users and their coverage (scope addition 6)", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" } },
    };
    summaryExtra = { sessions: 6400, usr_email__values: 174, usr_email__sessions: 6100 };
    tops = [
      { u: "synthetic-bot@synthetic.test", s: 5300, total_s: 6100, n_values: 174 },
      { u: "a@synthetic.test", s: 40, total_s: 6100, n_values: 174 },
    ];
    await mountDrawer({ cohort: { ...cohort, funnel: { ...cohort.funnel, unit: "users" } } });
    await useProductAnalytics().loadScope();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(body()).toContain("identified users dropped after step");
    expect(q("rum-analytics-dropoff-identity")?.textContent).toContain(
      "Identified users (12.5% of sessions)",
    );
    expect(body()).not.toContain("synthetic-bot@synthetic.test");
  });

  it("titles a sampled drawer with the funnel row's own estimate (W28)", async () => {
    health = HEALTH(20);
    sessions = SESSIONS(20);
    await mountDrawer({ sampled: 4, expectedDropped: 25 });
    expect(body()).toContain("~100 sessions dropped after step 1");
    expect(body()).not.toContain("~80 sessions dropped");
  });

  it("says 1 session, not 1 sessions (W31)", async () => {
    health = HEALTH(1);
    sessions = SESSIONS(1);
    await mountDrawer({ expectedDropped: 1 });
    expect(body()).toContain("1 session dropped after step 1");
  });

  const page2 = (sid: string) => SESSIONS(450).map((r) => ({ ...r, sid: `${sid}-${r.sid}` }));

  it("a failed Load more says so and can be retried (W27)", async () => {
    health = HEALTH(450);
    sessions = SESSIONS(450);
    nextPage = async () => {
      throw { response: { status: 500, data: { message: "page failed" } } };
    };
    await mountDrawer({ expectedDropped: 450 });
    q("rum-analytics-dropoff-sessions-load-more-btn")!.click();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(q("rum-analytics-dropoff-sessions-load-more-error")).not.toBeNull();
    nextPage = async () => ({ data: { hits: page2("p2") } });
    q("rum-analytics-dropoff-sessions-load-more-btn")!.click();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(q("rum-analytics-dropoff-sessions-load-more-error")).toBeNull();
    expect(body()).toContain("First 4 of 450 listed");
  });

  it("a page still loading when the list is reloaded never lands in the new list (W27)", async () => {
    health = HEALTH(450);
    sessions = SESSIONS(450);
    let release!: () => void;
    nextPage = () =>
      new Promise((resolve) => {
        release = () => resolve({ data: { hits: page2("stale") } });
      });
    await mountDrawer({ expectedDropped: 450 });
    q("rum-analytics-dropoff-sessions-load-more-btn")!.click();
    await flushPromises();
    await wrapper!.setProps({
      cohort: {
        ...cohort,
        stepIndex: 1,
        side: "dropped",
        funnel: { ...cohort.funnel, window: "1h" },
      },
    });
    for (let i = 0; i < 4; i++) await flushPromises();
    release();
    for (let i = 0; i < 4; i++) await flushPromises();
    expect(body()).toContain("First 2 of 450 listed");
  });

  it("opens full height with a scrim, not pinned under the sub-tabs", async () => {
    await mountDrawer();
    const drawer = wrapper!.findComponent(ODrawer);
    expect(drawer.props("size")).toBe("lg");
    expect(drawer.props("anchor") ?? null).toBeNull();
    expect(drawer.props("seamless")).toBe(false);
  });

  it("See paths of dropped sessions points away with a forward arrow", async () => {
    await mountDrawer();
    const btn = wrapper!
      .findAllComponents(OButton)
      .find((b) => b.attributes("data-test") === "rum-analytics-dropoff-paths-btn")!;
    expect(btn.props("iconRight")).toBe("arrow-forward");
    expect(btn.props("iconLeft")).toBe("account-tree");
  });

  it("See paths of dropped sessions hands the cohort to Paths (AC-25)", async () => {
    await mountDrawer();
    q("rum-analytics-dropoff-paths-btn")!.click();
    expect(wrapper!.emitted("paths")?.[0]).toEqual([cohort]);
  });
});
