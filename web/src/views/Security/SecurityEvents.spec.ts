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
import { mount, type VueWrapper } from "@vue/test-utils";
import type { Router } from "vue-router";
import store from "@/test/unit/helpers/store";
import { planStream, type StreamPlan } from "@/utils/security/streamPlan";
import securityInvestigate from "@/services/securityInvestigate";
import { SOURCE_TYPE_BY_ID } from "@/views/Security/__fixtures__/securitySourceTypes";
import {
  ATTACKER_IP,
  authorOnly,
  cloudtrailEvent,
  grantAll,
  makeSecurityRouter,
  okResponse,
  oktaEvent,
  settle,
  triageOnly,
} from "./__fixtures__/securityFixtures";

const search = vi.hoisted(() => vi.fn());
const schema = vi.hoisted(() => vi.fn());
const fieldValues = vi.hoisted(() => vi.fn());
const planState = vi.hoisted(() => ({ plans: [] as unknown[], failure: null as unknown }));
const sourceSaves = vi.hoisted(() => ({
  include: vi.fn((_name: string) => Promise.resolve()),
  exclude: vi.fn((_name: string) => Promise.resolve()),
}));
const toastMock = vi.hoisted(() => vi.fn());
// The server's severity SQL for the stream, and each stream's last-reported time.
const serverSeverity = vi.hoisted(() => ({ sql: null as string | null }));
const lastReported = vi.hoisted(() => ({ byName: {} as Record<string, number> }));

vi.mock("@/services/securitySigma", async () =>
  (await import("@/views/Security/__fixtures__/sigmaFixtures")).mockSigmaService(),
);
vi.mock("@/services/securityInvestigate", () => ({
  default: { searchEvents: vi.fn() },
}));
vi.mock("@/services/search", () => ({
  default: { search, delete_running_queries: vi.fn(() => Promise.resolve()) },
}));
vi.mock("@/services/stream", () => ({ default: { schema, fieldValues } }));
vi.mock("@/composables/security/streamActivity", () => ({
  ocsfClassCounts: async () => [],
}));
vi.mock("@/services/securitySources.queries", async () => {
  const mod = await (await import("./__fixtures__/securityFixtures")).sourceQueriesModule();
  return {
    ...mod,
    fetchSourceMatch: async (org: string, fields: string[]) => ({
      ...(await mod.fetchSourceMatch(org, fields)),
      severity: serverSeverity.sql
        ? { sql: serverSeverity.sql, columns: ["severity"], fromOutcome: true }
        : null,
    }),
  };
});
vi.mock("@/composables/security/useSecuritySources", async () => {
  const { computed, ref, shallowRef } = await import("vue");
  const names = ["okta_auth", "aws_cloudtrail"];
  return {
    useSecuritySources: () => {
      const streams = shallowRef<unknown[]>([]);
      return {
        streams,
        loading: ref(false),
        streamsReadable: ref(true),
        sourceNames: computed(() => names),
        sources: computed(() =>
          names.map((name) => ({ name, reason: "auto", verdict: null, health: "live" })),
        ),
        suggestions: computed(() => []),
        classifying: ref(false),
        load: vi.fn(async () => {
          const { streamListEntry: entry } = await import("./__fixtures__/securityFixtures");
          streams.value = names.map((n) => {
            const row = entry(n, 300);
            const at = lastReported.byName[n];
            return at === undefined ? row : { ...row, stats: { ...row.stats, doc_time_max: at } };
          });
        }),
        include: sourceSaves.include,
        exclude: sourceSaves.exclude,
        dismiss: vi.fn(),
      };
    },
  };
});
vi.mock("@/composables/security/useSigmaRules", async () => {
  const { ref } = await import("vue");
  return {
    useSigmaRules: () => ({
      ranked: ref([]),
      counting: ref(false),
      error: ref(""),
      runnableCount: ref(0),
      firingCount: ref(0),
      compileFor: vi.fn(),
      countHits: vi.fn(),
    }),
  };
});
vi.mock("@/composables/security/useSecurityStreamPlans", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/security/useSecurityStreamPlans")>();
  const { ref, shallowRef } = await import("vue");
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...actual,
    runSql: f.runSqlVia(search),
    useSecurityStreamPlans: () => {
      const plans = shallowRef<unknown[]>([]);
      const failure = shallowRef<unknown>(null);
      return {
        plans,
        names: shallowRef<string[]>([]),
        unreadable: ref<string[]>([]),
        loading: ref(false),
        error: ref(""),
        failure,
        load: vi.fn(async () => {
          failure.value = planState.failure;
          plans.value = planState.plans;
        }),
      };
    },
  };
});
vi.mock("@/composables/security/useSecurityAccess", async (importOriginal) => {
  const f = await import("./__fixtures__/securityFixtures");
  return {
    ...(await importOriginal<typeof import("@/composables/security/useSecurityAccess")>()),
    useSecurityAccess: f.mockSecurityAccess,
    loadSecurityAccess: async () => ({ read: true, ...f.accessGrants }),
    isSecurityGated: () => false,
  };
});
const detectionLoads = vi.hoisted(() => vi.fn());
vi.mock("@/composables/security/useSiemDetections", async () => {
  const { shallowRef } = await import("vue");
  return {
    useSiemDetections: () => ({
      alerts: shallowRef([{ name: "taken__okta_auth" }]),
      load: detectionLoads,
    }),
    invalidateSiemDetections: vi.fn(),
  };
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/lib/overlay/Drawer/ODrawer.vue", async () => {
  const f = await import("./__fixtures__/securityFixtures");
  return f.drawerStubModule;
});

import SecurityEvents from "./SecurityEvents.vue";

const OKTA_ROWS = Array.from({ length: 50 }, (_, i) =>
  oktaEvent({ _timestamp: Date.now() * 1000 - i * 1_000_000, actor_alternateid: `u${i}@acme.io` }),
);
const OKTA_FIELDS = Object.keys(oktaEvent());
const CT_FIELDS = Object.keys(cloudtrailEvent());

const sqlOf = (call: unknown[]) =>
  (call[0] as { query: { query: { sql: string } } }).query.query.sql;
const requestOf = (call: unknown[]) =>
  (call[0] as { query: { query: { sql: string; from: number; size: number } } }).query.query;
const rowSearches = () =>
  search.mock.calls.filter((c) => /^SELECT \* FROM "okta_auth"/.test(sqlOf(c)));

function answer(req: { query: { query: { sql: string } } }) {
  const sql = req.query.query.sql;
  let hits: unknown[] = [];
  if (sql.includes("histogram(")) {
    hits = [{ zo_ts: Date.now() * 1000, zo_sev: "WARN", zo_n: 120 }];
  } else if (sql.startsWith('SELECT * FROM "okta_auth"')) {
    hits = OKTA_ROWS;
  }
  return Promise.resolve(okResponse({ hits, total: hits.length }));
}

const refusal = (url: string, message = "Unauthorized Access") => ({
  response: { status: 403, data: { code: 403, message } },
  config: { method: "post", url },
});

let wrapper: VueWrapper | null = null;
let router: Router;

const mountView = async (query: string) => {
  router = await makeSecurityRouter(`/security/events${query}`);
  wrapper = mount(SecurityEvents, {
    global: {
      provide: { store },
      plugins: [store, router],
      stubs: { DateTime: true, CodeQueryEditor: true, SecurityNewDetectionDialog: true },
    },
  });
  await settle();
  await settle();
  return wrapper;
};

beforeEach(() => {
  grantAll();
  localStorage.clear();
  planState.failure = null;
  planState.plans = [
    planStream("okta_auth", OKTA_FIELDS, SOURCE_TYPE_BY_ID.get("okta_system_log")!),
    planStream("aws_cloudtrail", CT_FIELDS, SOURCE_TYPE_BY_ID.get("aws_cloudtrail")!),
  ] as StreamPlan[];
  search.mockImplementation(answer);
  vi.mocked(securityInvestigate.searchEvents).mockResolvedValue({
    data: {
      rows: [
        {
          time: Date.now(),
          ts: Date.now() * 1000,
          source: "okta_auth",
          user: "carol@acme.io",
          ip: ATTACKER_IP,
          host: "",
          action: "",
          outcome: "failure",
          message: "",
          _key: "okta_auth:1:0",
        },
        {
          time: Date.now() - 1000,
          ts: Date.now() * 1000 - 1_000_000,
          source: "aws_cloudtrail",
          user: "svc-deploy",
          ip: ATTACKER_IP,
          host: "",
          action: "StopLogging",
          outcome: "",
          message: "",
          _key: "aws_cloudtrail:2:1",
        },
      ],
      total: 40,
      perSource: [
        { stream: "okta_auth", n: 30 },
        { stream: "aws_cloudtrail", n: 10 },
      ],
      uncounted: [],
      searchable: true,
    },
  } as never);
  schema.mockImplementation((_org: string, name: string) =>
    Promise.resolve(
      okResponse({
        schema: (name === "okta_auth" ? OKTA_FIELDS : CT_FIELDS).map((f) => ({
          name: f,
          type: "Utf8",
        })),
      }),
    ),
  );
  fieldValues.mockResolvedValue(okResponse({ hits: [] }));
});

afterEach(() => {
  serverSeverity.sql = null;
  lastReported.byName = {};
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityEvents", () => {
  it("renders one source's events normalised, newest first, one server page at a time", async () => {
    const w = await mountView("?stream=okta_auth&period=1h");
    expect(w.find('[data-test="security-events-detected"]').text()).toContain("Okta");
    expect(w.find('[data-test="security-events-table"]').text()).toContain(ATTACKER_IP);
    const first = requestOf(rowSearches()[0]);
    expect(first).toMatchObject({ from: 0, size: 50 });
    expect(first.sql).toMatch(/ORDER BY _timestamp DESC$/);
  });

  it("pages and sorts on the server without re-running the timeline", async () => {
    const w = await mountView("?stream=okta_auth&period=1h");
    const histograms = () =>
      search.mock.calls.filter((c) => sqlOf(c).includes("histogram(")).length;
    const before = histograms();
    const table = w.findComponent({ name: "SecurityEventsTable" });
    table.vm.$emit("pagination-change", { page: 2, size: 50 });
    await settle();
    expect(requestOf(rowSearches().at(-1)!)).toMatchObject({ from: 50, size: 50 });
    table.vm.$emit("sort-change", { column: "srcIp", order: "asc" });
    await settle();
    const sorted = requestOf(rowSearches().at(-1)!);
    expect(sorted.from).toBe(0);
    expect(sorted.sql).toMatch(/ORDER BY "client_ipaddress" ASC NULLS LAST, _timestamp DESC$/);
    expect(histograms()).toBe(before);
    // The histogram's 120 is the exact total the pager offers.
    expect(table.props("total")).toBe(120);
  });

  it("adds a builder filter from a pivot and re-queries", async () => {
    const w = await mountView("?stream=okta_auth&period=1h");
    w.findComponent({ name: "SecurityEventsTable" }).vm.$emit(
      "add-filter",
      "client_ipaddress",
      ATTACKER_IP,
      "=",
    );
    await settle();
    expect(w.find('[data-test="security-events-filter-0"]').text()).toContain(ATTACKER_IP);
    expect(requestOf(rowSearches().at(-1)!).sql).toContain(
      `WHERE "client_ipaddress" = '${ATTACKER_IP}'`,
    );
  });

  it("hunts every source on the server, labelling each row by the stream it came from", async () => {
    const w = await mountView(`?stream=__all__&period=1h&hunt_kind=ip&hunt=${ATTACKER_IP}`);
    const [, req] = vi.mocked(securityInvestigate.searchEvents).mock.calls[0];
    expect(req.plans.map((p) => p.stream)).toEqual(["okta_auth", "aws_cloudtrail"]);
    expect(req).toMatchObject({
      query: { kind: "ip", value: ATTACKER_IP },
      sort: { column: "time", order: "desc" },
      from: 0,
      count: true,
    });
    const table = w.find('[data-test="security-events-hunt-table"]').text();
    expect(table).toContain("okta_auth");
    expect(table).toContain("aws_cloudtrail");
    expect(table).toContain("StopLogging");
    expect(w.find('[data-test="security-events-hunt-source-okta_auth"]').text()).toContain("30");
    expect(
      w
        .findComponent({ name: "SecurityEventsHunt" })
        .findComponent({ name: "OTable" })
        .props("totalCount"),
    ).toBe(40);
  });

  it("opens a hunt row in its own stream", async () => {
    const w = await mountView(`?stream=__all__&period=1h&hunt_kind=ip&hunt=${ATTACKER_IP}`);
    w.findComponent({ name: "SecurityEventsHunt" }).vm.$emit(
      "open-event",
      "okta_auth",
      OKTA_ROWS[0]._timestamp,
    );
    await settle();
    await settle();
    expect(router.currentRoute.value.query.stream).toBe("okta_auth");
    expect(w.find('[data-test="security-events-hunt-table"]').exists()).toBe(false);
    expect(rowSearches().length).toBeGreaterThan(0);
    expect(w.find('[data-test="security-event-drawer"]').exists()).toBe(true);
    expect(router.currentRoute.value.query.event_ts).toBe(String(OKTA_ROWS[0]._timestamp));
  });
});

describe("SecurityEvents access", () => {
  const sel = (id: string) => `[data-test="${id}"]`;

  it("lets a triage-only analyst include a source but not exclude one or create a detection", async () => {
    triageOnly();
    const w = await mountView("?stream=okta_auth&period=1h");
    expect(w.find(sel("security-events-add-source")).exists()).toBe(true);
    expect(w.find(sel("security-events-source-remove-okta_auth")).exists()).toBe(false);
    expect(w.findComponent({ name: "SecurityEventsDetected" }).props("canCreate")).toBe(false);
  });

  it("lets an author create a detection from a matched rule", async () => {
    authorOnly();
    const w = await mountView("?stream=okta_auth&period=1h");
    expect(w.findComponent({ name: "SecurityEventsDetected" }).props("canCreate")).toBe(true);
    expect(w.find(sel("security-events-source-remove-okta_auth")).exists()).toBe(false);
  });

  it("lets an admin exclude a source", async () => {
    const w = await mountView("?stream=okta_auth&period=1h");
    expect(w.find(sel("security-events-source-remove-okta_auth")).exists()).toBe(true);
  });

  it("shows the server's reason when including a source fails and keeps the current stream", async () => {
    sourceSaves.include.mockRejectedValueOnce({
      response: { status: 403, data: { message: "Security triage permission required" } },
    });
    const w = await mountView("?stream=okta_auth&period=1h");
    w.findComponent({ name: "SecurityEventsSources" }).vm.$emit("add", "vpc_flow");
    await settle();
    expect(sourceSaves.include).toHaveBeenCalledWith("vpc_flow");
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Security triage permission required",
      }),
    );
    expect(w.findComponent({ name: "SecurityEventsSources" }).props("selected")).toBe("okta_auth");
  });

  it("falls back to a named message when excluding a source fails without one", async () => {
    sourceSaves.exclude.mockRejectedValueOnce(new Error("Network Error"));
    const w = await mountView("?stream=okta_auth&period=1h");
    w.findComponent({ name: "SecurityEventsSources" }).vm.$emit("remove", "aws_cloudtrail");
    await settle();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Could not remove aws_cloudtrail from Security",
      }),
    );
  });

  it("opens the new-detection dialog over Events instead of leaving for Detections", async () => {
    const w = await mountView("?stream=okta_auth&period=1h");
    w.findComponent({ name: "SecurityEventsDetected" }).vm.$emit("create-detection", "rule-1");
    await settle();
    expect(router.currentRoute.value.path).toBe("/security/events");
    const dialog = w.findComponent({ name: "SecurityNewDetectionDialog" });
    expect(dialog.props("open")).toBe(true);
    expect(dialog.props("preset")).toMatchObject({ sigmaId: "rule-1", stream: "okta_auth" });
    expect(dialog.props("existingNames")).toEqual(["taken__okta_auth"]);
    expect(detectionLoads).toHaveBeenCalled();
  });
});

describe("SecurityEvents severity, SQL results and default stream", () => {
  const sel = (id: string) => `[data-test="${id}"]`;
  const b64 = (text: string) => btoa(text);

  it("reads the tiles and the rows from the one server severity", async () => {
    serverSeverity.sql = "SEV_EXPR";
    search.mockImplementation((req: { query: { query: { sql: string } } }) => {
      const sql = req.query.query.sql;
      const hits = sql.includes("histogram(")
        ? [{ zo_ts: Date.now() * 1000, zo_sev: 3, zo_n: 59 }]
        : sql.includes('FROM "okta_auth"')
          ? [{ ...OKTA_ROWS[0], zo_severity_id: 3 }]
          : [];
      return Promise.resolve(okResponse({ hits, total: hits.length }));
    });
    const w = await mountView("?stream=okta_auth&period=1h");
    const sqls = search.mock.calls.map(sqlOf);
    expect(sqls.some((q) => q.includes("(SEV_EXPR) AS zo_sev,"))).toBe(true);
    expect(
      sqls.some((q) => q.startsWith('SELECT *, (SEV_EXPR) AS zo_severity_id FROM "okta_auth"')),
    ).toBe(true);
    expect(w.find(sel("security-events-severity-medium")).text()).toContain("59");
    expect(w.find(sel("security-events-severity-info")).text()).toContain("0");
    const rows = w.findComponent({ name: "SecurityEventsTable" }).props("rows") as {
      severityId: number;
      raw: Record<string, unknown>;
    }[];
    expect(rows[0].severityId).toBe(3);
    expect(rows[0].raw).not.toHaveProperty("zo_severity_id");
  });

  it("filters a severity tile on the same expression the tiles counted", async () => {
    serverSeverity.sql = "SEV_EXPR";
    const w = await mountView("?stream=okta_auth&period=1h&severity=5,6");
    const rowSql = search.mock.calls
      .map(sqlOf)
      .filter((q) => q.includes("zo_severity_id"))
      .at(-1);
    expect(rowSql).toContain("WHERE (SEV_EXPR) IN (5, 6)");
    expect(w.findComponent({ name: "SecurityEventsTimeline" }).props("severity")).toEqual([5, 6]);
  });

  it("shows GROUP BY results as returned, with no drawer and pivots only on stored columns", async () => {
    const sql = `SELECT actor_alternateid, COUNT(*) AS n FROM "okta_auth" GROUP BY actor_alternateid`;
    search.mockImplementation((req: { query: { query: { sql: string } } }) =>
      Promise.resolve(
        okResponse(
          req.query.query.sql === sql
            ? {
                hits: [{ actor_alternateid: "a@acme.io", n: 5 }],
                columns: ["actor_alternateid", "n"],
              }
            : { hits: [] },
        ),
      ),
    );
    const w = await mountView(`?stream=okta_auth&period=1h&sql_mode=true&query=${b64(sql)}`);
    const table = w.findComponent({ name: "SecurityEventsTable" });
    expect(table.props("resultTable")).toBe(true);
    const cols = (table.props("columns") as { id: string }[]).map((c) => c.id);
    expect(cols).toEqual(["res:actor_alternateid", "res:n"]);
    expect(w.find(sel("security-events-table")).text()).toContain("a@acme.io");
    const row = (table.props("rows") as unknown[])[0];
    const pivot = table.props("pivotFor") as (r: unknown, id: string) => unknown;
    expect(pivot(row, "res:actor_alternateid")).toEqual({
      field: "actor_alternateid",
      value: "a@acme.io",
    });
    expect(pivot(row, "res:n")).toBeNull();
    table.vm.$emit("row-click", row);
    await settle();
    expect(w.find(sel("security-event-drawer")).exists()).toBe(false);
  });

  it("adds result columns the schema lacks to a plain-row query", async () => {
    const sql = `SELECT *, LOWER(actor_alternateid) AS who FROM "okta_auth"`;
    search.mockImplementation(() =>
      Promise.resolve(okResponse({ hits: [{ ...OKTA_ROWS[0], who: "u0@acme.io" }] })),
    );
    const w = await mountView(`?stream=okta_auth&period=1h&sql_mode=true&query=${b64(sql)}`);
    const table = w.findComponent({ name: "SecurityEventsTable" });
    expect(table.props("resultTable")).toBe(false);
    table.vm.$emit("update:showRaw", true);
    await settle();
    const cols = (table.props("columns") as { id: string }[]).map((c) => c.id);
    expect(cols).toContain("raw:who");
  });

  it("moves the picker to the table a hand-written query reads", async () => {
    const sql = `SELECT * FROM "aws_cloudtrail" ORDER BY _timestamp DESC`;
    const w = await mountView(`?stream=okta_auth&period=1h&sql_mode=true&query=${b64(sql)}`);
    expect(w.findComponent({ name: "SecurityEventsSources" }).props("selected")).toBe(
      "aws_cloudtrail",
    );
    expect(router.currentRoute.value.query.sql_mode).toBe("true");
    expect(search.mock.calls.map(sqlOf)).toContain(sql);
    expect(w.find(sel("security-events-detected")).text()).toContain("CloudTrail");
  });

  it("defaults to the Security source that reported last", async () => {
    lastReported.byName = { okta_auth: 1_000, aws_cloudtrail: 2_000 };
    const w = await mountView("?period=1h");
    expect(w.findComponent({ name: "SecurityEventsSources" }).props("selected")).toBe(
      "aws_cloudtrail",
    );
  });
  it("locks a refused stream search instead of showing the server's Unauthorized Access bar", async () => {
    search.mockImplementation((req: { query: { query: { sql: string } } }) =>
      req.query.query.sql.startsWith('SELECT * FROM "okta_auth"')
        ? Promise.reject(refusal("/api/default/_search"))
        : answer(req),
    );
    const w = await mountView("?stream=okta_auth&period=1h");
    const lock = w.find('[data-test="security-events-search-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("You can't view streams");
    expect(w.findComponent({ name: "SecurityEventsTable" }).exists()).toBe(false);
    expect(w.text()).not.toContain("Unauthorized Access");
  });

  it("locks a refused hunt and names the streams the server could not read", async () => {
    vi.mocked(securityInvestigate.searchEvents).mockRejectedValue(
      refusal("/api/default/security/events/search", "No read permission on streams: okta_auth"),
    );
    const w = await mountView(`?stream=__all__&period=1h&hunt_kind=ip&hunt=${ATTACKER_IP}`);
    expect(w.find('[data-test="security-events-hunt-lock"]').exists()).toBe(true);
    expect(w.find('[data-test="security-events-hunt-lock-reason"]').text()).toBe(
      "No read permission on streams: okta_auth",
    );
  });

  it("locks the hunt when the stream list behind its plans is refused", async () => {
    planState.plans = [];
    planState.failure = refusal("/api/default/streams");
    const w = await mountView(`?stream=__all__&period=1h&hunt_kind=ip&hunt=${ATTACKER_IP}`);
    expect(w.find('[data-test="security-events-hunt-lock"]').exists()).toBe(true);
    expect(securityInvestigate.searchEvents).not.toHaveBeenCalled();
  });
});
