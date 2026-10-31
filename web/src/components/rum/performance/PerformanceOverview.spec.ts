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
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";

const mockSearch = vi.fn();
const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockRoute = reactive<{ query: Record<string, unknown> }>({ query: {} });

vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org" }, zoConfig: {} },
  }),
}));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => mockRoute,
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: { name: "PanelSchemaRenderer", template: "<div />" },
}));
vi.mock("@/services/search", () => ({
  default: { search: (...a: unknown[]) => mockSearch(...a) },
}));

import PerformanceOverview from "./PerformanceOverview.vue";
import { b64EncodeUnicode } from "@/utils/zincutils";

type Hits = Record<string, unknown>[];
type Responder = (sql: string) => Hits | { status: number } | Error;

const SCHEMA = new Set([
  "service",
  "env",
  "version",
  "session_id",
  "view_id",
  "view_url",
  "view_error_count",
  "error_handling",
  "view_largest_contentful_paint",
  "view_interaction_to_next_paint",
  "view_cumulative_layout_shift",
]);

const START = new Date(1_700_000_000_000);
const END = new Date(1_700_000_000_000 + 24 * 3_600_000);

const vitalsRow = (views: number) => ({
  views,
  lcp_p50: 1e9,
  lcp_p75: 2e9,
  lcp_p95: 3e9,
  lcp_n: views,
  lcp_good: views,
  lcp_poor: 0,
  inp_p50: 1e8,
  inp_p75: 1e8,
  inp_p95: 1e8,
  inp_n: views,
  inp_good: views,
  inp_poor: 0,
  cls_p50: 0.01,
  cls_p75: 0.02,
  cls_p95: 0.03,
  cls_n: views,
  cls_good: views,
  cls_poor: 0,
});

const healthy: Responder = (sql) => {
  if (sql.includes("approx_percentile_cont(lcp, 0.5)")) return [{ w: 1, ...vitalsRow(500) }];
  if (sql.includes("histogram")) return [];
  if (sql.includes("COUNT(DISTINCT session_id) AS sessions")) {
    return [{ w: 1, sessions: 200, err_sessions: 20, errors: 40, unhandled: 10 }];
  }
  return [];
};

let responder: Responder = healthy;

const OverviewPanelStateStub = {
  name: "OverviewPanelState",
  props: ["status", "dataTest", "emptyTitle", "busy"],
  template:
    '<section :data-status="status" :data-empty-title="emptyTitle" :data-test="dataTest"><slot /></section>',
};
const KpiTileStub = {
  name: "KpiTile",
  props: ["to", "dataTest", "delta", "value", "ariaLabel"],
  template: "<i />",
};
const VerdictCardStub = {
  name: "VerdictCard",
  props: ["percentile", "sessions"],
  template: "<i />",
};
const OSelectStub = { name: "OSelect", props: ["modelValue", "label"], template: "<i />" };

const mountOverview = async (props: Record<string, unknown> = {}) => {
  mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
    const out = responder(args.query.query.sql);
    if (out instanceof Error) throw out;
    if (!Array.isArray(out)) throw { response: { status: out.status, data: { message: "no" } } };
    return { data: { hits: out } };
  });
  const w = mount(PerformanceOverview, {
    props: {
      dateTime: { start_time: START, end_time: END },
      schema: SCHEMA,
      selectedDate: { valueType: "relative", relativeTimePeriod: "1d" },
      ...props,
    },
    global: {
      stubs: {
        OverviewPanelState: OverviewPanelStateStub,
        KpiTile: KpiTileStub,
        VerdictCard: VerdictCardStub,
        OSelect: OSelectStub,
        PagesToFix: true,
        SegmentPanel: true,
        ReleaseComparison: true,
        FrustrationPanel: true,
        SessionsErrorsChart: true,
        OCard: { template: "<div><slot /></div>" },
        OBanner: { template: "<div><slot /><slot name='actions' /></div>" },
        OEmptyState: {
          template:
            "<div><slot name='title' /><slot name='description' /><slot name='actions' /></div>",
        },
        OButton: { template: "<button><slot /></button>" },
      },
    },
  });
  await flushPromises();
  return w;
};

const tile = (w: Awaited<ReturnType<typeof mountOverview>>, key: string) =>
  w
    .findAllComponents({ name: "KpiTile" })
    .find((c) => c.props("dataTest") === `rum-overview-kpi-${key}`)!;

describe("PerformanceOverview", () => {
  beforeEach(() => {
    mockSearch.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
    mockRoute.query = {};
    responder = healthy;
  });

  describe("drill-down links", () => {
    it("sends the Sessions tile to Sessions with no query text and the relative period", async () => {
      const w = await mountOverview();
      expect(tile(w, "sessions").props("to")).toEqual({
        name: "Sessions",
        query: { org_identifier: "org", period: "1d" },
      });
    });

    it("sends the Error-free tile to Sessions with health=clean and no tautology", async () => {
      const w = await mountOverview();
      const to = tile(w, "errorFree").props("to") as { query: Record<string, string> };
      expect(to.query).toEqual({ org_identifier: "org", period: "1d", health: "clean" });
    });

    it("sends the unhandled tile to Error Tracking with a base64 filter", async () => {
      const w = await mountOverview();
      expect(tile(w, "unhandled").props("to")).toEqual({
        name: "ErrorTracking",
        query: {
          org_identifier: "org",
          period: "1d",
          query: b64EncodeUnicode("error_handling='unhandled'"),
        },
      });
    });

    it("passes the absolute range in microseconds for an absolute picker", async () => {
      const w = await mountOverview({ selectedDate: { valueType: "absolute" } });
      const to = tile(w, "errors").props("to") as { query: Record<string, string> };
      expect(to.query.from).toBe(String(START.getTime() * 1000));
      expect(to.query.to).toBe(String(END.getTime() * 1000));
      expect(to.query.period).toBeUndefined();
    });

    it("scopes drill links to browser rows when the stream has a source column", async () => {
      const w = await mountOverview({ schema: new Set([...SCHEMA, "source"]) });
      const to = tile(w, "sessions").props("to") as { query: Record<string, string> };
      expect(to.query.query).toBe(
        b64EncodeUnicode("(source IS NULL OR source IN ('', 'browser'))"),
      );
      expect(
        mockSearch.mock.calls.every((c) =>
          c[0].query.query.sql.includes("(source IS NULL OR source IN ('', 'browser'))"),
        ),
      ).toBe(true);
    });

    it("carries the selected filters into the drill scope", async () => {
      mockRoute.query = { ov_service: "web" };
      const w = await mountOverview();
      const to = tile(w, "unhandled").props("to") as { query: Record<string, string> };
      expect(to.query.query).toBe(
        b64EncodeUnicode("error_handling='unhandled' AND service IN ('web')"),
      );
    });
  });

  describe("reloads", () => {
    it("reloads on Refresh even when the absolute range is unchanged", async () => {
      const w = await mountOverview();
      const before = mockSearch.mock.calls.length;
      await w.setProps({ dateTime: { start_time: new Date(START), end_time: new Date(END) } });
      await flushPromises();
      expect(mockSearch.mock.calls.length).toBeGreaterThan(before);
    });

    it("keeps the previous panels on screen, marked busy, while a reload is in flight", async () => {
      const w = await mountOverview();
      let open: () => void = () => {};
      mockSearch.mockImplementation(async (args: { query: { query: { sql: string } } }) => {
        await new Promise<void>((r) => (open = r));
        return { data: { hits: healthy(args.query.query.sql) } };
      });
      await w.setProps({ dateTime: { start_time: new Date(START), end_time: new Date(END) } });
      await flushPromises();
      const verdict = w.find('[data-test="rum-overview-verdict"]');
      expect(verdict.attributes("data-status")).toBe("ok");
      expect(w.find('[data-test="rum-overview-kpis"]').attributes("data-status")).toBe("ok");
      expect(w.findComponent({ name: "VerdictCard" }).exists()).toBe(true);
      expect(w.findComponent({ name: "OverviewPanelState" }).props("busy")).toBe(true);
      open();
    });

    it("gives the chart its own error state whose Retry reruns only the series", async () => {
      responder = (sql) => (sql.includes("histogram") ? new Error("boom") : healthy(sql));
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-chart"]').attributes("data-status")).toBe("error");
      responder = healthy;
      const before = mockSearch.mock.calls.length;
      w.findAllComponents({ name: "OverviewPanelState" })
        .find((c) => c.props("dataTest") === "rum-overview-chart")!
        .vm.$emit("retry");
      await flushPromises();
      const rerun = mockSearch.mock.calls.slice(before).map((c) => c[0].query.query.sql as string);
      expect(rerun).toHaveLength(1);
      expect(rerun[0]).toContain("histogram");
    });
  });

  describe("empty page actions", () => {
    it("offers Clear filters first when a filter is active", async () => {
      responder = () => [];
      mockRoute.query = { ov_env: "stage" };
      const w = await mountOverview();
      const clear = w.find('[data-test="rum-overview-page-clear-filters"]');
      expect(clear.exists()).toBe(true);
      expect(w.find('[data-test="rum-overview-page-empty"]').text()).toContain(
        "Nothing matches these filters",
      );
      await clear.trigger("click");
      await flushPromises();
      expect(mockReplace).toHaveBeenLastCalledWith({ query: {} });
    });

    it("suggests widening a quiet range and keeps SDK setup as the other action", async () => {
      responder = () => [];
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-page-clear-filters"]').exists()).toBe(false);
      expect(w.find('[data-test="rum-overview-page-empty"]').text()).toContain(
        "Widen the time range",
      );
      expect(w.find('[data-test="rum-overview-page-setup"]').exists()).toBe(true);
    });
  });

  describe("panel links", () => {
    it("names each KPI tile's destination for assistive tech", async () => {
      const w = await mountOverview();
      expect(tile(w, "sessions").props("ariaLabel")).toBe("Sessions: 200. Open Sessions");
      expect(tile(w, "errors").props("ariaLabel")).toBe("Total errors: 40. Open Error Tracking");
    });

    it("opens Product Analytics Overview for all pages with the org and relative period", async () => {
      const w = await mountOverview();
      expect(w.findComponent({ name: "PagesToFix" }).props("allPagesLink")).toEqual({
        name: "productAnalyticsOverview",
        query: { org_identifier: "org", period: "1d" },
      });
    });

    it("carries an absolute range to Product Analytics as from/to microseconds", async () => {
      const w = await mountOverview({ selectedDate: { valueType: "absolute" } });
      expect(w.findComponent({ name: "PagesToFix" }).props("allPagesLink")).toEqual({
        name: "productAnalyticsOverview",
        query: {
          org_identifier: "org",
          from: String(START.getTime() * 1000),
          to: String(END.getTime() * 1000),
        },
      });
    });

    it("sends the replay link to frustrated sessions in the same range", async () => {
      const w = await mountOverview();
      expect(w.findComponent({ name: "FrustrationPanel" }).props("replaysLink")).toEqual({
        name: "Sessions",
        query: { org_identifier: "org", period: "1d", health: "frustrated" },
      });
    });
  });

  describe("lazy pages", () => {
    let observed: ((entries: { isIntersecting: boolean }[]) => void) | null;
    const pageCalls = () =>
      mockSearch.mock.calls.filter((c) => c[0].query.query.sql.includes("GROUP BY pg")).length;

    beforeEach(() => {
      observed = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
            observed = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("holds the pages query until its panel scrolls into view", async () => {
      const w = await mountOverview();
      expect(pageCalls()).toBe(0);
      expect(w.find('[data-test="rum-overview-pages"]').attributes("data-status")).toBe("loading");
      observed!([{ isIntersecting: false }]);
      await flushPromises();
      expect(pageCalls()).toBe(0);
      observed!([{ isIntersecting: true }]);
      await flushPromises();
      expect(pageCalls()).toBe(1);
    });

    it("does not count unrequested pages against the page-level error", async () => {
      responder = () => new Error("boom");
      const w = await mountOverview();
      expect(pageCalls()).toBe(0);
      expect(w.find('[data-test="rum-overview-page-error"]').exists()).toBe(true);
    });
  });

  describe("page states", () => {
    it("shows one page-level empty state with the setup action", async () => {
      responder = () => [];
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-page-empty"]').exists()).toBe(true);
      expect(w.find('[data-test="rum-overview-verdict"]').exists()).toBe(false);
    });

    it("shows one page-level error with a single Retry that reloads everything", async () => {
      responder = () => new Error("boom");
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-page-error"]').exists()).toBe(true);
      const before = mockSearch.mock.calls.length;
      responder = healthy;
      await w.find('[data-test="rum-overview-page-retry"]').trigger("click");
      await flushPromises();
      expect(mockSearch.mock.calls.length).toBeGreaterThan(before);
      expect(w.find('[data-test="rum-overview-page-error"]').exists()).toBe(false);
    });

    it("shows a distinct no-permission message without Retry when forbidden", async () => {
      responder = () => ({ status: 403 });
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-page-forbidden"]').exists()).toBe(true);
      expect(w.find('[data-test="rum-overview-page-retry"]').exists()).toBe(false);
      expect(w.find('[data-test="rum-overview-page-error"]').exists()).toBe(false);
    });

    it("marks the verdict panel low-data under 100 views", async () => {
      responder = (sql) =>
        sql.includes("approx_percentile_cont(lcp, 0.5)")
          ? [{ w: 1, ...vitalsRow(38) }]
          : healthy(sql);
      const w = await mountOverview();
      expect(w.find('[data-test="rum-overview-verdict"]').attributes("data-status")).toBe("low");
    });

    it("hands the verdict a session count only once the KPIs have loaded", async () => {
      const w = await mountOverview();
      expect(w.findComponent({ name: "VerdictCard" }).props("sessions")).toBe(200);
    });
  });

  it("gives the KPI panel sessions-specific empty copy, not page-view copy", async () => {
    const w = await mountOverview();
    expect(w.find('[data-test="rum-overview-kpis"]').attributes("data-empty-title")).toBe(
      "No sessions in this range",
    );
  });

  describe("filters and percentile in the route", () => {
    it("restores filters and percentile from the query on mount", async () => {
      mockRoute.query = { ov_env: ["prod", "stage"], ov_pct: "p95" };
      const w = await mountOverview();
      const env = w
        .findAllComponents({ name: "OSelect" })
        .find((c) => c.props("label") === "Environment")!;
      expect(env.props("modelValue")).toEqual(["prod", "stage"]);
      expect(w.findComponent({ name: "VerdictCard" }).props("percentile")).toBe("p95");
    });

    it("writes a changed filter to the route, merging the page's own params", async () => {
      mockRoute.query = { period: "1d", org_identifier: "org" };
      const w = await mountOverview();
      w.findAllComponents({ name: "OSelect" })
        .find((c) => c.props("label") === "Service")!
        .vm.$emit("update:modelValue", ["web"]);
      await flushPromises();
      expect(mockReplace).toHaveBeenLastCalledWith({
        query: { period: "1d", org_identifier: "org", ov_service: ["web"] },
      });
    });

    it("writes a changed percentile and drops it again at p75", async () => {
      const w = await mountOverview();
      w.findComponent({ name: "VerdictCard" }).vm.$emit("update:percentile", "p50");
      await flushPromises();
      expect(mockReplace).toHaveBeenLastCalledWith({ query: { ov_pct: "p50" } });
    });

    it("hides a filter whose column the stream lacks", async () => {
      const w = await mountOverview({ schema: new Set([...SCHEMA].filter((f) => f !== "env")) });
      const labels = w.findAllComponents({ name: "OSelect" }).map((c) => c.props("label"));
      expect(labels).toEqual(["Service", "Version"]);
    });
  });
});
