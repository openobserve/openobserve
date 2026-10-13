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
import { createRouter, createWebHistory } from "vue-router";
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
import PathSessionsDrawer from "./PathSessionsDrawer.vue";
import { identityExpr, type PathsDef } from "@/utils/rum/productAnalyticsQueries";

const SESSIONS = [
  {
    sid: "s-known",
    step_t: 1790000000000,
    errors: 0,
    frustrations: 0,
    has_replay: 1,
    started: 1789999990000,
    ended: 1790000372000,
    user_label: "a@x.com",
    total: 2,
  },
  {
    sid: "s-anon",
    step_t: 1790000100000,
    errors: 0,
    frustrations: 0,
    has_replay: 0,
    started: 1790000000000,
    ended: 1790000048000,
    user_label: null,
    total: 2,
  },
];

const def: PathsDef = {
  anchor: { kind: "p", key: "/web/logs" },
  direction: "next",
  depth: 3,
  include: "all",
  cohort: null,
};

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: {},
    timezone: "UTC",
    theme: "light",
  },
});

describe("PathSessionsDrawer", () => {
  let wrapper: VueWrapper | null = null;

  const mountDrawer = async (prepare?: () => Promise<void>) => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/p", name: "productAnalyticsPaths", component: { template: "<div />" } },
        { path: "/s/:id", name: "SessionViewer", component: { template: "<div />" } },
      ],
    });
    await router.push("/p?app=web&period=7d");
    useProductAnalytics().initFromRoute({ app: "web", period: "7d" });
    if (prepare) await prepare();
    wrapper = mount(PathSessionsDrawer, {
      props: {
        open: true,
        def,
        predicate: "s1 = 'p:/web/home'",
        stepDepth: 1,
        title: "/web/home",
        expectedTotal: 2,
      },
      global: { plugins: [router, store] },
      attachTo: document.body,
    });
    for (let i = 0; i < 4; i++) await flushPromises();
  };

  const q = (dt: string) => document.querySelector<HTMLElement>(`[data-test="${dt}"]`);
  const sqls = () =>
    vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);

  beforeEach(() => {
    resetProductAnalytics();
    vi.mocked(searchService.search).mockReset();
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    vi.mocked(searchService.search).mockImplementation((async (args: {
      query: { query: { sql: string } };
    }) => {
      const sql = args.query.query.sql;
      if (/FROM pa WHERE/.test(sql)) return { data: { hits: SESSIONS } };
      if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 6400 }] } };
      if (/va_rows/.test(sql))
        return {
          data: {
            hits: [
              {
                sessions: 6400,
                prev_sessions: 1,
                views: 1,
                va_rows: 1000,
                usr_email__values: 174,
                usr_email__sessions: 6100,
              },
            ],
          },
        };
      if (/total_s/.test(sql))
        return {
          data: {
            hits: [
              { u: "bot@synthetic.test", s: 5300, total_s: 6100, n_values: 174 },
              { u: "a@synthetic.test", s: 40, total_s: 6100, n_values: 174 },
            ],
          },
        };
      return { data: { hits: [] } };
    }) as never);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("R10: shows a session's user_label and Unknown user for a session without one", async () => {
    await mountDrawer();
    expect(q("rum-analytics-paths-branch-sessions-row-0")?.textContent).toContain("a@x.com");
    expect(q("rum-analytics-paths-branch-sessions-row-0")?.textContent).not.toContain(
      "Unknown user",
    );
    expect(q("rum-analytics-paths-branch-sessions-row-1")?.textContent).toContain("Unknown user");
  });

  it("R10: the drawer's own query asks for user_label", async () => {
    await mountDrawer();
    const sql = sqls().find((s) => /FROM pa WHERE/.test(s));
    expect(sql).toBeDefined();
    expect(sql!.split("\n").at(-1)!.split(" FROM ")[0]).toMatch(/\buser_label\b/);
  });

  it("R10: with a resolved identity the drawer asks for that identity as user_label", async () => {
    const { performanceState } = usePerformance();
    performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" } },
    };
    await mountDrawer(async () => {
      await useProductAnalytics().loadScope();
      for (let i = 0; i < 4; i++) await flushPromises();
    });
    const id = useProductAnalytics().identitySql.value;
    expect(id).toEqual({ field: "usr_email", excluded: ["bot@synthetic.test"] });
    const sql = sqls().find((s) => /FROM pa WHERE/.test(s))!;
    expect(sql).toContain(identityExpr(id!));
    expect(sql).toContain("MAX(uid) AS user_label");
    expect(sql.split("\n").at(-1)!.split(" FROM ")[0]).toMatch(/\buser_label\b/);
  });
});
