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

// Host detail drawer (design 4.8/§6) — assertions run on the captured dashboard
// object, never ECharts. The Metrics tab is now the curated engine driven by the
// hosts pack (curated-pages design §7.3/§8.2); the Logs/Traces/footer cases below
// must stay green through that retrofit — they are its safety net.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent } from "vue";
import HostDetailDrawer from "./HostDetailDrawer.vue";
import searchService from "@/services/search";
import { b64DecodeUnicode } from "@/utils/zincutils";
import i18n from "@/locales";
import goldenDashboard from "./curated/packs/__fixtures__/hostDashboard.golden.json";

const { importHostMetricsDashboard, toastMock } = vi.hoisted(() => ({
  importHostMetricsDashboard: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/composables/useHostMetricsDashboard", () => ({ importHostMetricsDashboard }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/services/search", () => ({
  default: { search: vi.fn(), metrics_query: vi.fn(), metrics_query_range: vi.fn() },
}));

const { getStreamsMock, getStreamMock, loadSemanticGroupsMock } = vi.hoisted(() => ({
  getStreamsMock: vi.fn(),
  getStreamMock: vi.fn(),
  loadSemanticGroupsMock: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: getStreamsMock, getStream: getStreamMock }),
}));

vi.mock("@/utils/semanticGroupsCache", () => ({
  loadSemanticGroups: loadSemanticGroupsMock,
  clearSemanticGroupsCacheForOrg: vi.fn(),
  getCachedSemanticGroups: vi.fn(() => null),
}));

const searchMock = vi.mocked(searchService.search);

let lastDashboardData: any = null;
const renderChartsStub = defineComponent({
  name: "RenderDashboardCharts",
  props: ["dashboardData", "currentTimeObj", "viewOnly", "searchType", "initialVariableValues"],
  created() {
    lastDashboardData = (this as any).dashboardData;
  },
  updated() {
    lastDashboardData = (this as any).dashboardData;
  },
  template: "<div class='render-stub'><slot name='before_panels' /></div>",
});

// Captures all picker attrs so the init-from-page-range pin needn't hardcode the prop name.
const dateTimeCapture: Record<string, any> = {};
const dateTimeStub = defineComponent({
  name: "DateTime",
  inheritAttrs: false,
  created() {
    Object.assign(dateTimeCapture, (this as any).$attrs);
  },
  template: "<div data-test='drawer-datetime-stub' />",
});

const RANGE = { from: 1_700_000_000_000_000, to: 1_700_000_900_000_000 };
const NOW_US = RANGE.to;
const DAY_US = 24 * 60 * 60 * 1_000_000;

const HOST_STREAMS = [
  "system_cpu_time",
  "system_memory_usage",
  "system_cpu_load_average_1m",
  "system_cpu_load_average_5m",
  "system_cpu_load_average_15m",
  "system_disk_io",
  "system_filesystem_usage",
  "system_network_io",
];

const streamEntry = (name: string, docTimeMax = NOW_US - 60_000_000) => ({
  name,
  stream_type: "metrics",
  stats: {
    created_at: 0,
    doc_time_min: 0,
    doc_time_max: docTimeMax,
    doc_num: 1,
    file_num: 1,
    storage_size: 1,
    compressed_size: 1,
    index_size: 0,
  },
  schema: [{ name: "host_name", type: "Utf8" }],
});

/** A live fleet: every system_* stream present and fresh. */
const primeStreams = (names: string[] = HOST_STREAMS, docTimeMax?: number) => {
  getStreamsMock.mockImplementation(async (type: string) => ({
    name: type,
    schema: false,
    list: type === "metrics" ? names.map((n) => streamEntry(n, docTimeMax)) : [],
  }));
};

const allDashboardQueries = (): string[] => {
  const tabs = lastDashboardData?.tabs ?? [];
  return tabs.flatMap((t: any) =>
    (t.panels ?? []).flatMap((p: any) => (p.queries ?? []).map((q: any) => q.query as string)),
  );
};

const allDashboardPanels = (): any[] =>
  (lastDashboardData?.tabs ?? []).flatMap((t: any) => t.panels ?? []);

const t = (key: string) => i18n.global.t(key);

/** Delete exactly the §8.2 modulo set, so a new divergence fails loudly. */
const stripModuloKeys = (doc: any) => {
  const copy = JSON.parse(JSON.stringify(doc));
  delete copy.created;
  delete copy.title;
  for (const tab of copy.tabs ?? []) {
    delete tab.tabId;
    delete tab.name;
    for (const panel of tab.panels ?? []) {
      // buildDashboard is pure and i18n-free (§5.5 — every call site passes only
      // { timezone }), so it emits titleKey and can never reproduce the fixture's
      // translated copy. Titles are pinned by key in hosts.page.spec.ts instead.
      delete panel.title;
      delete panel.config?.curated_badge;
      // The pre-retrofit builder authored no drilldowns (all 8 fixture panels
      // carry `[]`), but §6.6's lint requires every non-probe chart panel to
      // declare one — without this key in the set the two rules are mutually
      // unsatisfiable. §8.2 records the widening.
      delete panel.config?.drilldown;
    }
  }
  return copy;
};

describe("HostDetailDrawer", () => {
  let wrapper: VueWrapper<any>;
  let router: any;

  const mountDrawer = async (props: Record<string, any> = {}) => {
    const store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        timezone: "UTC",
        theme: "light",
        zoConfig: {},
      },
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/logs", name: "logs", component: { template: "<div />" } },
        { path: "/traces", name: "traces", component: { template: "<div />" } },
        { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
      ],
    });
    vi.spyOn(router, "push");
    const w = mount(HostDetailDrawer, {
      props: { hostName: "web-01", status: "ACTIVE", range: { ...RANGE }, ...props },
      global: {
        plugins: [store, router, i18n],
        stubs: {
          RenderDashboardCharts: renderChartsStub,
          DateTime: dateTimeStub,
          ODrawer: { template: "<div><slot /><slot name='footer' /></div>" },
          teleport: true,
        },
      },
    });
    await flushPromises();
    return w;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastDashboardData = null;
    for (const k of Object.keys(dateTimeCapture)) delete dateTimeCapture[k];
    searchMock.mockResolvedValue({ data: { hits: [{ _timestamp: 1, log: "x" }] } } as any);
    importHostMetricsDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "dash-1",
      folderId: "default",
    });
    primeStreams();
    getStreamMock.mockResolvedValue(streamEntry("system_cpu_time"));
    loadSemanticGroupsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it("renders the Metrics / Logs / Traces tabs", async () => {
    wrapper = await mountDrawer();
    expect(wrapper.find('[data-test="host-drawer-tab-metrics"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="host-drawer-tab-logs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="host-drawer-tab-traces"]').exists()).toBe(true);
  });

  // ── §8.2 golden parity — the red-first bridge across the builder's deletion ─

  describe("golden parity with the pre-retrofit builder", () => {
    it("the ENGINE builds it AND it deep-equals the FROZEN fixture, modulo the enumerated keys", async () => {
      // Provenance and parity are ONE case on purpose. The fixture was generated
      // from buildHostDashboard("host-1") (§8.2 step 1), so parity alone is a
      // tautology the pre-retrofit builder passes today: it would accept any
      // implementation that emits the right JSON without going through the
      // engine. Asserting the resolution input was actually read in the same
      // case is what makes the deep-equal discriminate.
      wrapper = await mountDrawer({ hostName: "host-1" });
      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false, false, expect.anything());
      expect(lastDashboardData).toBeTruthy();
      expect(stripModuloKeys(lastDashboardData)).toEqual(stripModuloKeys(goldenDashboard));
    });

    it("is a v8 document with no variables, every query pinned to the literal host", async () => {
      wrapper = await mountDrawer();
      expect(lastDashboardData.version).toBe(8);
      // A single pinned host needs no selectors — a variables block renders dead ones.
      expect(lastDashboardData.variables?.list ?? []).toHaveLength(0);
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="web-01"');
        expect(q).not.toContain("$host_name");
        expect(q).not.toContain("${scope:");
        expect(q).not.toContain("${f:");
      }
    });

    it("backslash-escapes a double quote in the host name instead of excluding the host", async () => {
      wrapper = await mountDrawer({ hostName: 'he"llo' });
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="he\\"llo"');
      }
    });

    it("backslash-escapes a backslash in the host name in PromQL string values", async () => {
      // 4.8: escape " AND \ — an unescaped \ silently corrupts the matcher.
      wrapper = await mountDrawer({ hostName: "corp\\web-01" });
      const queries = allDashboardQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q).toContain('host_name="corp\\\\web-01"');
      }
    });
  });

  // ── pass-4 finding 17 — the no-new-spinner guarantee ───────────────────────

  describe("synchronous open", () => {
    it("resolves the Metrics tab WITHOUT awaiting any getStream or dictionary load", async () => {
      // Routing the drawer through the engine must not add a cold round trip its
      // synchronous builder never had. `getStreams` hard-forces schema=false, so
      // no list entry ever carries a schema and getStream(…, true) ALWAYS hits the
      // network. fieldOverrides is §5.4 rung 1 — authored certainty, no group
      // lookup and no schema fetch — which is what keeps that call from firing.
      wrapper = await mountDrawer();
      // The engine ran (red today — the builder reads no lists)…
      expect(getStreamsMock).toHaveBeenCalled();
      // …and it resolved entirely off the warm list.
      expect(getStreamMock).not.toHaveBeenCalled();
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
      // The dashboard is available on the first tick — no new spinner.
      expect(lastDashboardData).toBeTruthy();
    });
  });

  // ── Stale badges (§6.3, §5.3, pass-4 finding 18) ───────────────────────────

  describe("stale badges", () => {
    const STALE_LAST_SEEN = NOW_US - 3 * DAY_US;

    it("an INACTIVE row with an old lastSeenUs badges all 8 panels", async () => {
      wrapper = await mountDrawer({ status: "INACTIVE", lastSeenUs: STALE_LAST_SEEN });
      const badged = allDashboardPanels().filter((p: any) => p.config?.curated_badge);
      expect(badged).toHaveLength(8);
    });

    it("an UNKNOWN row badges too — that is exactly the case the badge exists for", async () => {
      wrapper = await mountDrawer({ status: "UNKNOWN", lastSeenUs: STALE_LAST_SEEN });
      expect(allDashboardPanels().filter((p: any) => p.config?.curated_badge)).toHaveLength(8);
    });

    it("an ACTIVE row SUPPRESSES every badge and the stale banner (finding 18)", async () => {
      // STALE_GRACE_US is an admitted guess; a hair too small would put eight amber
      // badges behind a row labelled ACTIVE and destroy badge trust everywhere.
      // The list's liveness query and the panels agree BY CONSTRUCTION, not by tuning.
      //
      // PAIRED GUARD: this is a toHaveLength(0), so it is green today only because
      // the pre-retrofit builder emits no badges at all. It discriminates ONLY
      // alongside the two INACTIVE/UNKNOWN rows above, which demand 8 — weaken or
      // delete either of those and this row silently stops asserting anything.
      wrapper = await mountDrawer({ status: "ACTIVE", lastSeenUs: STALE_LAST_SEEN });
      expect(allDashboardPanels().filter((p: any) => p.config?.curated_badge)).toHaveLength(0);
      expect(wrapper.find('[data-test="curated-stale-banner"]').exists()).toBe(false);
    });

    it("the per-host lastSeenUs BEATS a fleet-fresh stream max (§5.3 pin override)", async () => {
      // Stream stats are fleet-wide: a dead host behind a live fleet keeps every
      // system_* doc_time_max fresh, so per-stream staleness is the wrong granularity.
      primeStreams(HOST_STREAMS, NOW_US - 60_000_000);
      wrapper = await mountDrawer({ status: "INACTIVE", lastSeenUs: NOW_US - 5 * DAY_US });
      expect(allDashboardPanels().filter((p: any) => p.config?.curated_badge).length).toBe(8);
    });
  });

  // ── Hide+explain in the drawer (§7.3) ──────────────────────────────────────

  describe("partial installs", () => {
    it("a missing system_filesystem_usage hides that panel and adds a strip row", async () => {
      primeStreams(HOST_STREAMS.filter((n) => n !== "system_filesystem_usage"));
      wrapper = await mountDrawer();
      expect(allDashboardPanels().map((p: any) => p.id)).not.toContain("hd_fs_used_pct");
      expect(wrapper.find('[data-test="curated-strip"]').exists()).toBe(true);
    });
  });

  // ── Non-ready faces, sized for a drawer tab (§7.3) ─────────────────────────

  describe("non-ready faces", () => {
    it("`unknown` renders an inline spinner in the METRICS TAB BODY only", async () => {
      let release!: (v: any) => void;
      getStreamsMock.mockImplementation(() => new Promise((resolve) => (release = resolve)));
      wrapper = await mountDrawer();
      expect(wrapper.find('[data-test="host-drawer-metrics-spinner"]').exists()).toBe(true);
      release({ name: "metrics", schema: false, list: HOST_STREAMS.map((n) => streamEntry(n)) });
      await flushPromises();
      expect(wrapper.find('[data-test="host-drawer-metrics-spinner"]').exists()).toBe(false);
    });

    it("a lists failure renders an inline Retry that fires refresh({force:true})", async () => {
      getStreamsMock.mockRejectedValue(new Error("network"));
      wrapper = await mountDrawer();
      const retry = wrapper.find('[data-test="host-drawer-metrics-retry"]');
      expect(retry.exists()).toBe(true);
      getStreamsMock.mockClear();
      primeStreams();
      await retry.trigger("click");
      await flushPromises();
      expect(getStreamsMock).toHaveBeenCalledWith("metrics", false, false, true);
    });

    it("the Logs and Traces tabs render normally in BOTH non-ready states", async () => {
      // They never wait on metrics resolution.
      getStreamsMock.mockRejectedValue(new Error("network"));
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-tab-logs"]').trigger("click");
      await flushPromises();
      expect(searchMock).toHaveBeenCalled();
      await wrapper.find('[data-test="host-drawer-tab-traces"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="host-drawer-traces-link"]').exists()).toBe(true);
    });
  });

  // ── Everything below is UNCHANGED by the retrofit — the safety net ─────────

  // The Logs/Traces panes may render lazily — open the tab before asserting.
  const openTab = async (tab: string) => {
    await wrapper.find(`[data-test="host-drawer-tab-${tab}"]`).trigger("click");
    await flushPromises();
  };

  describe("logs tab", () => {
    it("previews the last 100 logs for the host over the picker window", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      expect(searchMock).toHaveBeenCalled();
      const args: any = searchMock.mock.calls[0][0];
      const sql: string = args.query.query.sql;
      expect(sql).toContain('FROM "default"');
      expect(sql).toContain("host_name = 'web-01'");
      expect(sql).toContain("ORDER BY _timestamp DESC");
      expect(sql).toContain("LIMIT 100");
      expect(args.query.query.start_time).toBe(RANGE.from);
      expect(args.query.query.end_time).toBe(RANGE.to);
    });

    it("doubles a single quote in the host name in the SQL literal", async () => {
      wrapper = await mountDrawer({ hostName: "o'brien" });
      await openTab("logs");
      const args: any = searchMock.mock.calls[0][0];
      expect(args.query.query.sql).toContain("'o''brien'");
    });

    it("names the stream in the zero-row state so a wrong constant self-diagnoses", async () => {
      searchMock.mockResolvedValue({ data: { hits: [] } } as any);
      wrapper = await mountDrawer();
      await openTab("logs");
      const empty = wrapper.find('[data-test="host-drawer-logs-empty"]');
      expect(empty.exists()).toBe(true);
      expect(empty.text()).toContain("No logs found in stream");
      // {stream} resolved to the LOGS_STREAM constant — scoped so "default" can't match elsewhere.
      expect(empty.text()).toContain("default");
    });

    it("builds the Explore-in-Logs URL with all nine constructLogsUrl params", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      const link = wrapper.find('[data-test="host-drawer-explore-logs"]');
      expect(link.exists()).toBe(true);
      const href = link.attributes("href") ?? "";
      for (const param of [
        "stream_type",
        "stream",
        "from",
        "to",
        "sql_mode",
        "query",
        "org_identifier",
        "quick_mode",
        "show_histogram",
      ]) {
        expect(href, param).toContain(`${param}=`);
      }
    });
  });

  describe("traces tab", () => {
    it("hands off to /traces with a b64 query that decodes to the host filter", async () => {
      wrapper = await mountDrawer();
      await openTab("traces");
      const link = wrapper.find('[data-test="host-drawer-traces-link"]');
      expect(link.exists()).toBe(true);
      const href = link.attributes("href") ?? "";
      expect(href).toContain("/traces");
      expect(href).toContain("from=");
      expect(href).toContain("to=");
      // The traces page b64-decodes ?query= (Index.vue restoreUrlQueryParams) — raw SQL would garble.
      const query = new URL(href, "http://localhost").searchParams.get("query") ?? "";
      expect(b64DecodeUnicode(query)).toBe("host_name = 'web-01'");
    });
  });

  describe("host switch while open (?host= edited)", () => {
    it("resets the logs preview and refetches for the new host", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      expect(searchMock).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ hostName: "web-02" });
      await flushPromises();
      // The previous host's hits must not linger behind the new host's name.
      expect(searchMock).toHaveBeenCalledTimes(2);
      const args: any = searchMock.mock.calls[1][0];
      expect(args.query.query.sql).toContain("host_name = 'web-02'");
    });

    it("drops a stale logs response that resolves after the host switched (out-of-order)", async () => {
      let resolveStale!: (v: any) => void;
      searchMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }) as any,
      );
      searchMock.mockResolvedValue({
        data: { hits: [{ _timestamp: 2, log: "NEW-HOST-LINE" }] },
      } as any);
      wrapper = await mountDrawer();
      await openTab("logs");
      // Host switches while web-01's fetch is still in flight; web-02's resolves first.
      await wrapper.setProps({ hostName: "web-02" });
      await flushPromises();
      resolveStale({ data: { hits: [{ _timestamp: 1, log: "OLD-HOST-LINE" }] } });
      await flushPromises();
      expect(wrapper.text()).toContain("NEW-HOST-LINE");
      expect(wrapper.text()).not.toContain("OLD-HOST-LINE");
    });

    it("EVERY metrics query carries the NEW host after the switch — the drawer instance is reused", async () => {
      // opts.pins was read once at setup, so the reused instance kept plotting the
      // host the drawer first opened on while the header said otherwise.
      wrapper = await mountDrawer();
      await flushPromises();
      const before = JSON.stringify(lastDashboardData);
      expect(before).toContain("web-01");

      await wrapper.setProps({ hostName: "web-02" });
      await flushPromises();

      const panels = (lastDashboardData?.tabs ?? []).flatMap((tab: any) => tab.panels ?? []);
      expect(panels.length).toBeGreaterThanOrEqual(8);
      for (const panel of panels) {
        for (const query of panel.queries ?? []) {
          expect(query.query).toContain("web-02");
          expect(query.query).not.toContain("web-01");
        }
      }
    });

    it("a lastSeenUs arriving AFTER mount engages the badge override", async () => {
      // The hosts list is usually still in flight at mount, so the row's last-seen
      // lands late — a snapshot read at setup meant it never engaged at all.
      wrapper = await mountDrawer({ status: "INACTIVE", lastSeenUs: null });
      await flushPromises();
      const badgedBefore = ((lastDashboardData?.tabs ?? []) as any[])
        .flatMap((tab) => tab.panels ?? [])
        .filter((panel: any) => panel.config?.curated_badge);
      expect(badgedBefore.length).toBe(0);

      await wrapper.setProps({ lastSeenUs: NOW_US - 3 * DAY_US });
      await flushPromises();

      const badgedAfter = ((lastDashboardData?.tabs ?? []) as any[])
        .flatMap((tab) => tab.panels ?? [])
        .filter((panel: any) => panel.config?.curated_badge);
      expect(badgedAfter.length).toBeGreaterThan(0);
    });

    it("clears the loaded flag when the host changes off the logs tab", async () => {
      wrapper = await mountDrawer();
      await openTab("logs");
      await openTab("metrics");
      searchMock.mockClear();
      await wrapper.setProps({ hostName: "web-02" });
      await flushPromises();
      expect(searchMock).not.toHaveBeenCalled();
      // Re-opening the tab fetches fresh for the new host instead of trusting stale hits.
      await openTab("logs");
      expect(searchMock).toHaveBeenCalledTimes(1);
      expect((searchMock.mock.calls[0][0] as any).query.query.sql).toContain("web-02");
    });
  });

  describe("header chips", () => {
    it("renders an os chip when os_type is known", async () => {
      wrapper = await mountDrawer({ osType: "linux" });
      const chip = wrapper.find('[data-test="host-drawer-os-chip"]');
      expect(chip.exists()).toBe(true);
      expect(chip.text()).toBe("linux");
    });

    it("renders no os chip when os_type is absent", async () => {
      wrapper = await mountDrawer({ osType: null });
      expect(wrapper.find('[data-test="host-drawer-os-chip"]').exists()).toBe(false);
    });
  });

  it("initializes its DateTime picker from the Hosts page picker's range", async () => {
    // The drawer must open showing the window the row was computed over.
    wrapper = await mountDrawer();
    const captured = JSON.stringify(dateTimeCapture);
    expect(captured).toContain(String(RANGE.from));
    expect(captured).toContain(String(RANGE.to));
  });

  describe("footer — Open Host Metrics dashboard", () => {
    it("imports if absent, then navigates carrying var-host_name plus the drawer range", async () => {
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      // A user can reach /infra/hosts without the setup flow (pass-4 finding 7).
      expect(importHostMetricsDashboard).toHaveBeenCalledWith("test-org");
      expect(router.push).toHaveBeenCalledTimes(1);
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.path).toBe("/dashboards/view");
      expect(target.query.dashboard).toBe("dash-1");
      expect(target.query.folder).toBe("default");
      expect(target.query["var-host_name"]).toBe("web-01");
      expect(Number(target.query.from)).toBe(RANGE.from);
      expect(Number(target.query.to)).toBe(RANGE.to);
    });

    it("navigates to the existing dashboard on exists", async () => {
      importHostMetricsDashboard.mockResolvedValue({
        status: "exists",
        dashboardId: "dash-old",
        folderId: "default",
      });
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      const target: any = vi.mocked(router.push).mock.calls[0][0];
      expect(target.query.dashboard).toBe("dash-old");
    });

    it("shows the cause-naming toast by kind and does NOT navigate on error", async () => {
      importHostMetricsDashboard.mockResolvedValue({
        status: "error",
        kind: "forbidden",
        message: "403",
      });
      wrapper = await mountDrawer();
      await wrapper.find('[data-test="host-drawer-open-dashboard"]').trigger("click");
      await flushPromises();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: t("ingestion.setupCard.hostDashboardImportForbidden"),
        }),
      );
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});
