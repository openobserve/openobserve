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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { flushPromises } from "@vue/test-utils";

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});

const mockStore = {
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false },
    timezone: "UTC",
  },
};
vi.mock("vuex", () => ({ useStore: () => mockStore }));
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
const mockGetStream = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream: mockGetStream }) }));
const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: (...a: unknown[]) => mockToast(...a),
}));

import searchService from "@/services/search";
import { resetNamedEvents } from "./useNamedEvents";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "./useProductAnalytics";
import { decodeDef, encodeDef } from "@/utils/rum/productAnalyticsModel";

type Hit = Record<string, unknown>;

const respond = (routes: [RegExp, Hit[]][]) =>
  vi.mocked(searchService.search).mockImplementation((async (args: {
    query: { query: { sql: string } };
  }) => {
    const sql = args.query.query.sql;
    const hit = routes.find(([re]) => re.test(sql));
    return { data: { hits: hit ? hit[1] : [] } };
  }) as never);

const SUMMARY = {
  sessions: 6429,
  prev_sessions: 6000,
  views: 20000,
  va_rows: 3666563,
  synthetic_sessions: 12,
  data_through_us: 1790000000000000,
  usr_email__values: 181,
  usr_email__sessions: 6129,
};

const setSchema = (fields: string[]) => {
  const { performanceState } = usePerformance();
  performanceState.data.streams._rumdata = {
    name: "_rumdata",
    schema: Object.fromEntries(fields.map((f) => [f, { name: f }])),
  };
};

describe("useProductAnalytics", () => {
  beforeEach(() => {
    vi.mocked(searchService.search).mockReset();
    mockGetStream.mockReset();
    mockStore.state.selectedOrganization.identifier = "org1";
    window.localStorage.clear();
    resetProductAnalytics();
    setSchema(["application_id", "session_id", "usr_email", "env", "session_type"]);
  });

  it("defaults to the last 7 days and the busiest app (AC-1)", async () => {
    respond([
      [
        /AS app, COUNT/,
        [
          { app: "busy", sessions: 10 },
          { app: "quiet", sessions: 1 },
        ],
      ],
      [/va_rows/, [SUMMARY]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({});
    await pa.loadScope();
    expect(pa.state.app).toBe("busy");
    expect(pa.state.datetime.relativeTimePeriod).toBe("7d");
    expect(pa.apps.value.map((a) => a.app)).toEqual(["busy", "quiet"]);
  });

  it("prefers the stored app when Q1 lists it, and the URL app over both (AC-1)", async () => {
    respond([
      [
        /AS app, COUNT/,
        [
          { app: "busy", sessions: 10 },
          { app: "mine", sessions: 1 },
        ],
      ],
    ]);
    window.localStorage.setItem("o2.rum.analytics.org1.app", "mine");
    const pa = useProductAnalytics();
    pa.initFromRoute({});
    await pa.loadScope();
    expect(pa.state.app).toBe("mine");
    resetProductAnalytics();
    pa.initFromRoute({ app: "other" });
    await pa.loadScope();
    expect(pa.state.app).toBe("other");
  });

  it("resolves identity with the dominant value excluded and samples above 1M rows (AC-50, AC-52)", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/va_rows/, [SUMMARY]],
      [/total_s/, [{ u: "bot", s: 5293, total_s: 6129, n_values: 181 }]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web" });
    await pa.loadScope();
    expect(pa.identity.value?.field).toBe("usr_email");
    expect(pa.identitySql.value).toEqual({ field: "usr_email", excluded: ["bot"] });
    expect(pa.sampleRatio.value).toBe(4);
    expect(pa.summary.value?.syntheticSessions).toBe(12);
    pa.setScope({ exact: true });
    expect(pa.sampleRatio.value).toBe(1);
    expect(pa.toQuery().exact).toBe("1");
  });

  it("runs env and version options only for fields in the schema", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/env AS value/, [{ value: "prod", sessions: 3 }]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web" });
    await pa.loadScope();
    const sqls = vi
      .mocked(searchService.search)
      .mock.calls.map((c) => c[0].query.query.sql as string);
    expect(sqls.some((s) => s.includes("env AS value"))).toBe(true);
    expect(sqls.some((s) => s.includes("version AS value"))).toBe(false);
    expect(pa.envOptions.value).toEqual([{ value: "prod", sessions: 3 }]);
  });

  it("round-trips the shared scope and sub-tab definitions through the URL (AC-6, AC-20)", () => {
    const pa = useProductAnalytics();
    const funnel = encodeDef({
      s: [
        ["p", "/a"],
        ["c", "b"],
      ],
      u: "sessions",
      w: "session",
    });
    pa.initFromRoute({
      app: "web",
      env: ["prod"],
      from: "100",
      to: "200",
      idall: "1",
      funnel,
      dir: "prev",
      depth: "4",
      per: "week",
      rmode: "after",
    });
    const q = pa.toQuery("funnels");
    expect(q).toMatchObject({
      app: "web",
      from: "100",
      to: "200",
      idall: "1",
      dir: "prev",
      depth: "4",
    });
    expect(q.env).toEqual(["prod"]);
    expect(decodeDef(q.funnel as string)).toEqual({
      s: [
        ["p", "/a"],
        ["c", "b"],
      ],
      u: "sessions",
      w: "session",
    });
    expect(q.per).toBe("week");
    expect(q.rmode).toBe("after");
    resetProductAnalytics();
    pa.initFromRoute(q);
    expect(pa.funnel.value.steps).toHaveLength(2);
    expect(pa.paths.value.depth).toBe(4);
    expect(pa.retention.value.mode).toBe("after");
    expect(pa.state.env).toEqual(["prod"]);
  });

  it("falls back to defaults and reports each invalid param once (D-45)", () => {
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", funnel: "%%%", depth: "99", rmode: "x", exact: "7" });
    expect(pa.invalidParams.value).toEqual(["exact", "funnel", "paths", "retention"]);
    expect(pa.funnel.value.steps).toEqual([]);
    expect(pa.paths.value.depth).toBe(3);
  });

  const SF = "2A7YeEEBY3ABp3e2zS8iq9y7Ajz";
  const EV = "GoneEvent000000000000000001";
  const savedFunnel = () => ({
    id: SF,
    app: "web",
    name: "Signup",
    def: {
      steps: [
        { kind: "p" as const, key: "/a" },
        { kind: "e" as const, key: EV },
      ],
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    },
    sql: "SELECT 1",
    eventIds: [EV],
    version: 4,
    createdBy: "a@x.com",
    createdAt: 1,
    updatedBy: "b@x.com",
    updatedAt: 2,
  });

  it("an sf link keeps its id until resolved, alongside the funnel it carried (AC-70)", () => {
    const pa = useProductAnalytics();
    const funnel = encodeDef({
      s: [
        ["p", "/x"],
        ["p", "/y"],
      ],
      u: "sessions",
      w: "session",
    });
    pa.initFromRoute({ app: "web", sf: SF, funnel });
    expect(pa.pendingSavedId.value).toBe(SF);
    expect(pa.toQuery()).toMatchObject({ sf: SF, funnel });
    pa.openSavedFunnel(savedFunnel());
    expect(pa.pendingSavedId.value).toBeNull();
    expect(pa.openedFunnel.value?.version).toBe(4);
    expect(pa.funnel.value).toEqual(savedFunnel().def);
    const q = pa.toQuery();
    expect(q.sf).toBe(SF);
    expect(decodeDef(q.funnel as string)).toEqual({
      s: [
        ["p", "/a"],
        ["e", EV],
      ],
      u: "sessions",
      w: "session",
    });
    pa.detachSavedFunnel();
    expect(pa.toQuery().sf).toBeUndefined();
  });

  describe("the saved-funnels list URL names no funnel", () => {
    const routerWith = async (start: string) => {
      const stub = { template: "<div />" };
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/funnels", name: "productAnalyticsFunnels", component: stub },
          { path: "/funnels/build", name: "productAnalyticsFunnelBuilder", component: stub },
          { path: "/paths", name: "productAnalyticsPaths", component: stub },
        ],
      });
      await router.push(start);
      return router;
    };
    const openWithEdits = () => {
      const pa = useProductAnalytics();
      pa.initFromRoute({ app: "web" });
      pa.openSavedFunnel(savedFunnel());
      return pa;
    };

    it("leaves sf and funnel off the list route only", () => {
      const pa = openWithEdits();
      expect(pa.toQuery("productAnalyticsFunnels")).not.toHaveProperty("sf");
      expect(pa.toQuery("productAnalyticsFunnels")).not.toHaveProperty("funnel");
      expect(pa.toQuery("productAnalyticsFunnels")).toMatchObject({ app: "web" });
      expect(pa.toQuery("productAnalyticsFunnelBuilder")).toMatchObject({ sf: SF });
      expect(pa.toQuery("productAnalyticsPaths")).toHaveProperty("funnel");
      expect(pa.toQuery()).toMatchObject({ sf: SF });
    });

    it("syncs and pushes the list without them, and the builder with them", async () => {
      const pa = openWithEdits();
      const router = await routerWith("/paths");
      await pa.pushSubTab(router, "productAnalyticsFunnels");
      expect(router.currentRoute.value.query).not.toHaveProperty("sf");
      expect(router.currentRoute.value.query).not.toHaveProperty("funnel");
      await pa.syncUrl(router);
      expect(router.currentRoute.value.query).not.toHaveProperty("sf");
      await pa.pushSubTab(router, "productAnalyticsFunnelBuilder");
      expect(router.currentRoute.value.query.sf).toBe(SF);
      expect(router.currentRoute.value.query.funnel).toBeDefined();
    });

    it("re-entering the list from its URL keeps the funnel already open, which that URL never named", () => {
      const pa = openWithEdits();
      pa.funnel.value = { ...pa.funnel.value, unit: "users", window: "1d" };
      pa.initFromRoute({ app: "web", period: "30d" }, { keepFunnel: true });
      expect(pa.state.datetime.relativeTimePeriod).toBe("30d");
      expect(pa.openedFunnel.value?.id).toBe(SF);
      expect(pa.funnel.value.unit).toBe("users");
      pa.initFromRoute({ app: "web" });
      expect(pa.openedFunnel.value).toBeNull();
    });
  });

  it("a missing saved funnel falls back to the carried funnel and says so; a malformed sf is an invalid param", () => {
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", sf: SF });
    pa.markSavedFunnelMissing();
    expect(pa.savedFunnelMissing.value).toBe(true);
    expect(pa.toQuery().sf).toBeUndefined();
    pa.initFromRoute({ app: "web", sf: "abc" });
    expect(pa.invalidParams.value).toEqual(["sf"]);
    expect(pa.pendingSavedId.value).toBeNull();
    expect(pa.savedFunnelMissing.value).toBe(false);
  });

  it("a saved funnel keeps its deleted named-event step tagged instead of dropping it (AC-69)", async () => {
    resetNamedEvents();
    api.reset();
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web" });
    pa.openSavedFunnel(savedFunnel());
    expect(await pa.eventsGate(() => true)).toBe("ready");
    expect(pa.funnel.value.steps).toEqual(savedFunnel().def.steps);
    expect(pa.deletedEventLink.value).toBe(false);
  });

  it("the scope key changes with app, range and the identity and exact toggles", () => {
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", from: "100", to: "200" });
    pa.resolveRange();
    const k1 = pa.scopeKey.value;
    expect(k1).toBe("org1|web|||100|200|0|0");
    pa.setScope({ includeAllIdentities: true });
    expect(pa.scopeKey.value).toBe("org1|web|||100|200|1|0");
  });

  it("remembers an explicitly picked app per org", () => {
    const pa = useProductAnalytics();
    pa.setScope({ app: "picked" }, true);
    expect(window.localStorage.getItem("o2.rum.analytics.org1.app")).toBe("picked");
  });

  it("a URL sync while a sub-tab push is pending lands on the new sub-tab (AC-6)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const stub = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/funnels", name: "productAnalyticsFunnels", component: stub },
        { path: "/paths", name: "productAnalyticsPaths", component: stub, beforeEnter: () => gate },
      ],
    });
    await router.push({ name: "productAnalyticsFunnels" });
    const pa = useProductAnalytics();
    pa.setScope({ app: "web", env: ["e2e"] });
    const push = pa.pushSubTab(router, "productAnalyticsPaths");
    const sync = pa.syncUrl(router);
    release();
    await Promise.all([push, sync]);
    expect(router.currentRoute.value.name).toBe("productAnalyticsPaths");
    expect(router.currentRoute.value.query.env).toEqual(["e2e"]);
  });

  it("a second sub-tab push made while a URL sync waits on the first still lands (AC-6, F19)", async () => {
    let releasePaths: () => void = () => {};
    let releaseRetention: () => void = () => {};
    const pathsGate = new Promise<void>((r) => (releasePaths = r));
    const retentionGate = new Promise<void>((r) => (releaseRetention = r));
    const stub = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/funnels", name: "productAnalyticsFunnels", component: stub },
        {
          path: "/paths",
          name: "productAnalyticsPaths",
          component: stub,
          beforeEnter: () => pathsGate,
        },
        {
          path: "/retention",
          name: "productAnalyticsRetention",
          component: stub,
          beforeEnter: () => retentionGate,
        },
      ],
    });
    await router.push({ name: "productAnalyticsFunnels" });
    const pa = useProductAnalytics();
    pa.setScope({ app: "web", env: ["e2e"] });
    const first = pa.pushSubTab(router, "productAnalyticsPaths");
    const sync = pa.syncUrl(router);
    const second = pa.pushSubTab(router, "productAnalyticsRetention");
    releasePaths();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    releaseRetention();
    await Promise.all([second, sync]);
    expect(router.currentRoute.value.name).toBe("productAnalyticsRetention");
    expect(router.currentRoute.value.query.env).toEqual(["e2e"]);
  });

  it("a Refresh whose named-events list fails fast loads and toasts once (F32)", async () => {
    resetNamedEvents();
    vi.mocked(searchService.search).mockImplementation((async (args: {
      query: { query: { sql: string } };
    }) => {
      const sql = args.query.query.sql;
      await new Promise((r) => setTimeout(r, 20));
      if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "f32", sessions: 5 }] } };
      return { data: { hits: /va_rows/.test(sql) ? [SUMMARY] : [] } };
    }) as never);
    // Earlier tests' superseded loads may still reach the list, so only this app's calls count.
    const lists = () => api.service.listEvents.mock.calls.filter((c) => c[1] === "f32").length;
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "f32" });
    api.service.listEvents.mockRejectedValue({ response: { status: 503 } });
    mockToast.mockClear();
    try {
      await pa.loadScope();
      expect(lists()).toBe(1);
      await pa.refresh();
      expect(lists()).toBe(2);
      expect(mockToast).toHaveBeenCalledTimes(2);
    } finally {
      api.reset();
    }
  });

  it("a rejected sub-tab push reports one rejection, to its caller only (F20)", async () => {
    const stub = { template: "<div />" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/funnels", name: "productAnalyticsFunnels", component: stub },
        {
          path: "/paths",
          name: "productAnalyticsPaths",
          component: stub,
          beforeEnter: () => {
            throw new Error("chunk failed");
          },
        },
      ],
    });
    await router.push({ name: "productAnalyticsFunnels" });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const pa = useProductAnalytics();
      await expect(pa.pushSubTab(router, "productAnalyticsPaths")).rejects.toThrow("chunk failed");
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
      await pa.syncUrl(router);
      expect(router.currentRoute.value.name).toBe("productAnalyticsFunnels");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  describe("organization switch in place", () => {
    const sqls = () =>
      vi.mocked(searchService.search).mock.calls.map((c) => c[0].query.query.sql as string);
    const streamOf = (fields: string[], docTimeMin = 0) => ({
      name: "_rumdata",
      schema: fields.map((name) => ({ name })),
      stats: { doc_time_min: docTimeMin },
    });

    it("re-reads the schema for the new org, so an org with no RUM shows no stale columns (W1)", async () => {
      respond([
        [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
        [/va_rows/, [SUMMARY]],
      ]);
      const pa = useProductAnalytics();
      pa.initFromRoute({ app: "web" });
      await pa.loadScope();
      expect(pa.schema.value.env).toBe(true);
      mockStore.state.selectedOrganization.identifier = "org2";
      mockGetStream.mockRejectedValue(new Error("Stream not found"));
      vi.mocked(searchService.search).mockRejectedValue({
        response: { status: 500, data: { code: 20002, message: "no stream" } },
      });
      pa.initFromRoute({});
      await pa.loadScope();
      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", true);
      expect(pa.schema.value).toEqual({});
      expect(pa.state.app).toBe("");
      expect(pa.scopeStatus.value).toBe("ok");
    });

    it("builds the new org's queries from its own columns (W1)", async () => {
      respond([
        [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
        [/va_rows/, [SUMMARY]],
      ]);
      const pa = useProductAnalytics();
      pa.initFromRoute({ app: "web", from: "100", to: "200" });
      await pa.loadScope();
      mockStore.state.selectedOrganization.identifier = "org2";
      mockGetStream.mockResolvedValue(streamOf(["application_id", "session_id"]));
      vi.mocked(searchService.search).mockClear();
      pa.initFromRoute({ app: "web", from: "100", to: "200" });
      await pa.loadScope();
      expect(pa.schema.value).toEqual({ application_id: true, session_id: true });
      expect(sqls().length).toBeGreaterThan(0);
      expect(sqls().some((s) => s.includes("env AS value") || s.includes("session_type"))).toBe(
        false,
      );
    });

    it("never caches a failed schema read: the next load asks again (W1)", async () => {
      respond([
        [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
        [/va_rows/, [SUMMARY]],
      ]);
      mockStore.state.selectedOrganization.identifier = "org2";
      delete usePerformance().performanceState.data.streams._rumdata;
      mockGetStream
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue(streamOf(["application_id", "session_id", "env"]));
      const pa = useProductAnalytics();
      pa.initFromRoute({ app: "web" });
      await pa.loadScope();
      expect(pa.schema.value).toEqual({});
      await pa.loadScope(true);
      expect(mockGetStream).toHaveBeenCalledTimes(2);
      expect(pa.schema.value.env).toBe(true);
      await pa.loadScope(true);
      expect(mockGetStream).toHaveBeenCalledTimes(2);
    });

    it("reloads an unchanged app and range, and keeps no cache, across orgs (W22)", async () => {
      respond([
        [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
        [/va_rows/, [SUMMARY]],
        [/AS kind|'p' AS kind|kind/, [{ kind: "p", k: "/a", sessions: 1 }]],
      ]);
      mockGetStream.mockResolvedValue(streamOf(["application_id", "session_id"], 100));
      const pa = useProductAnalytics();
      pa.initFromRoute({ app: "web", from: "100", to: "200" });
      await pa.loadScope();
      expect(await pa.loadDataStart()).toBe(100);
      await pa.pickerOptions();
      const before = sqls().length;
      mockStore.state.selectedOrganization.identifier = "org2";
      mockGetStream.mockResolvedValue(streamOf(["application_id", "session_id"], 500));
      pa.initFromRoute({ app: "web", from: "100", to: "200" });
      await pa.loadScope();
      expect(sqls().length).toBeGreaterThan(before);
      expect(await pa.loadDataStart()).toBe(500);
      const afterScope = sqls().length;
      await pa.pickerOptions();
      expect(sqls().length).toBe(afterScope + 1);
    });
  });

  it("a scope toggle reruns only the queries it changes (W9)", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/va_rows/, [SUMMARY]],
      [/total_s/, [{ u: "bot", s: 5293, total_s: 6129, n_values: 181 }]],
      [/env AS value/, [{ value: "prod", sessions: 3 }]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", from: "100", to: "200" });
    await pa.loadScope();
    expect(pa.identitySql.value?.excluded).toEqual(["bot"]);
    const calls = () => vi.mocked(searchService.search).mock.calls.length;
    const base = calls();
    pa.setScope({ includeAllIdentities: true });
    await pa.loadScope();
    expect(calls()).toBe(base);
    expect(pa.identitySql.value?.excluded).toEqual([]);
    pa.setScope({ exact: true });
    await pa.loadScope();
    expect(calls()).toBe(base);
    pa.setScope({ env: ["prod"] });
    await pa.loadScope();
    const ran = vi
      .mocked(searchService.search)
      .mock.calls.slice(base)
      .map((c) => c[0].query.query.sql as string);
    expect(ran.some((s) => /AS app, COUNT/.test(s))).toBe(false);
    expect(ran.some((s) => s.includes("env AS value"))).toBe(false);
    expect(ran.some((s) => s.includes("va_rows"))).toBe(true);
    expect(pa.envOptions.value).toEqual([{ value: "prod", sessions: 3 }]);
  });

  it("a superseded scope load writes no facets, summary or identity (W8)", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/va_rows/, [SUMMARY]],
      [/env AS value/, [{ value: "prod", sessions: 3 }]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", from: "100", to: "200" });
    await pa.loadScope();
    const gates: (() => void)[] = [];
    vi.mocked(searchService.search).mockImplementation((async (args: {
      query: { query: { sql: string } };
    }) => {
      await new Promise<void>((r) => gates.push(r));
      const sql = args.query.query.sql;
      if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 10 }] } };
      if (/env AS value/.test(sql)) return { data: { hits: [{ value: "prod", sessions: 3 }] } };
      return { data: { hits: /va_rows/.test(sql) ? [{ ...SUMMARY, sessions: 1 }] : [] } };
    }) as never);
    const first = pa.loadScope(true);
    await flushPromises();
    gates.splice(0).forEach((r) => r());
    await flushPromises();
    const second = pa.loadScope(true);
    await flushPromises();
    gates.splice(0).forEach((r) => r());
    await first;
    expect(pa.envOptions.value).toEqual([{ value: "prod", sessions: 3 }]);
    expect(pa.summary.value?.sessions).toBe(SUMMARY.sessions);
    for (let i = 0; i < 5 && gates.length === 0; i++) await flushPromises();
    while (gates.length) {
      gates.splice(0).forEach((r) => r());
      await flushPromises();
    }
    await second;
    expect(pa.summary.value?.sessions).toBe(1);
    expect(pa.scopeStatus.value).toBe("ok");
  });

  it("a second Entry/Exit caller for the same scope joins the read in flight (W18)", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/va_rows/, [SUMMARY]],
      [/entry_sessions/, [{ k: "/", entry_sessions: 1 }]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", from: "100", to: "200" });
    await pa.loadScope();
    const before = vi.mocked(searchService.search).mock.calls.length;
    const [a, b] = await Promise.all([pa.entryExit(), pa.entryExit()]);
    expect(a).toEqual([{ k: "/", entry_sessions: 1 }]);
    expect(b).toEqual(a);
    expect(vi.mocked(searchService.search).mock.calls.length).toBe(before + 1);
  });

  it("a failed picker load reports its status and is not cached as empty (W16)", async () => {
    respond([
      [/AS app, COUNT/, [{ app: "web", sessions: 10 }]],
      [/va_rows/, [SUMMARY]],
    ]);
    const pa = useProductAnalytics();
    pa.initFromRoute({ app: "web", from: "100", to: "200" });
    await pa.loadScope();
    vi.mocked(searchService.search).mockRejectedValueOnce({
      response: { status: 500, data: { message: "boom" } },
    });
    const failed = await pa.loadPicker();
    expect(failed.status).toBe("error");
    respond([[/kind/, [{ kind: "p", k: "/a", sessions: 2 }]]]);
    const ok = await pa.loadPicker();
    expect(ok.status).toBe("ok");
    expect(ok.options.map((o) => o.key)).toEqual(["/a"]);
    vi.mocked(searchService.search).mockRejectedValueOnce({ response: { status: 403 } });
    expect((await pa.searchPicker("x")).status).toBe("forbidden");
  });
});
