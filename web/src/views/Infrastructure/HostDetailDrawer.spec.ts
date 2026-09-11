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
// object, never ECharts. The drawer is metrics-only: it is the curated engine
// driven by the hosts pack (curated-pages design §7.3/§8.2), with no Logs or
// Traces surface and no logs-target schema walk behind one.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import { computed, defineComponent, inject, ref } from "vue";
import type { Ref } from "vue";
import HostDetailDrawer from "./HostDetailDrawer.vue";
import { __resetSchemaReadsForTest } from "./curated/useCuratedPage";
import searchService from "@/services/search";
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

/**
 * A PASSTHROUGH by default, so every case below still drives the real engine.
 * `curatedOverride` exists only to reach a shape resolveManifest cannot produce
 * (presentGroupIds is pushed ONLY when a panel is visible, resolve.ts:563), which
 * is exactly why the drawer's zero-panel guard needs a test of its own.
 */
const curatedOverride = vi.hoisted(() => ({ current: null as null | ((real: any) => any) }));

vi.mock("./curated/useCuratedPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./curated/useCuratedPage")>();
  return {
    ...actual,
    useCuratedPage: (...args: Parameters<typeof actual.useCuratedPage>) => {
      const real = actual.useCuratedPage(...args);
      return curatedOverride.current ? curatedOverride.current(real) : real;
    },
  };
});

const searchMock = vi.mocked(searchService.search);

let lastDashboardData: any = null;
let lastCurrentTimeObj: any = null;
const renderChartsStub = defineComponent({
  name: "RenderDashboardCharts",
  props: ["dashboardData", "currentTimeObj", "viewOnly", "searchType", "initialVariableValues"],
  created() {
    lastDashboardData = (this as any).dashboardData;
    lastCurrentTimeObj = (this as any).currentTimeObj;
  },
  updated() {
    lastDashboardData = (this as any).dashboardData;
    lastCurrentTimeObj = (this as any).currentTimeObj;
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

/**
 * A live fleet: every system_* stream present and fresh. The org has real LOG streams
 * too, so a drawer that regressed into resolving one would succeed rather than error —
 * the metrics-only assertions must fail on the call, not on an empty org.
 */
const primeStreams = (names: string[] = HOST_STREAMS, docTimeMax?: number) => {
  getStreamsMock.mockImplementation(async (type: string) => ({
    name: type,
    schema: false,
    list:
      type === "metrics"
        ? names.map((n) => streamEntry(n, docTimeMax))
        : type === "logs"
          ? [{ name: "applogs", stream_type: "logs" }]
          : [],
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

  const mountDrawer = async (
    props: Record<string, any> = {},
    renderStub: any = renderChartsStub,
  ) => {
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
          RenderDashboardCharts: renderStub,
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
    // Schema reads are cached MODULE-side, so one case's reads would answer the next one's.
    __resetSchemaReadsForTest();
    curatedOverride.current = null;
    lastDashboardData = null;
    for (const k of Object.keys(dateTimeCapture)) delete dateTimeCapture[k];
    searchMock.mockResolvedValue({ data: { hits: [] } } as any);
    importHostMetricsDashboard.mockResolvedValue({
      status: "created",
      dashboardId: "dash-1",
      folderId: "default",
    });
    // Resolvable on purpose: a regression that walked log schemas would otherwise
    // throw and read as a crash rather than as the metrics-only rule being broken.
    getStreamMock.mockImplementation(async (name: string, type: string) =>
      type === "logs" ? { name, schema: [{ name: "host_name", type: "Utf8" }] } : streamEntry(name),
    );
    primeStreams();
    loadSemanticGroupsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  // The drawer is metrics-ONLY. The Logs tab cost up to 25 schema reads per open just
  // to guess which stream held the host's logs; Traces was a bare link. Both are gone,
  // and nothing here may quietly bring back a tab strip or the reads behind it.
  describe("metrics-only — no Logs or Traces surface", () => {
    it("renders no tab strip at all", async () => {
      wrapper = await mountDrawer();
      for (const tab of ["metrics", "logs", "traces"]) {
        expect(wrapper.find(`[data-test="host-drawer-tab-${tab}"]`).exists()).toBe(false);
      }
      expect(wrapper.findComponent({ name: "OTabs" }).exists()).toBe(false);
    });

    it("renders the metrics dashboard directly, with no tab to click first", async () => {
      wrapper = await mountDrawer();
      expect(lastDashboardData).toBeTruthy();
    });

    it("renders no Logs or Traces affordance in any form", async () => {
      wrapper = await mountDrawer();
      for (const target of [
        "host-drawer-explore-logs",
        "host-drawer-traces-link",
        "host-drawer-logs-empty",
        "host-drawer-logs-unresolved",
        "host-drawer-metrics-undetected-logs",
      ]) {
        expect(wrapper.find(`[data-test="${target}"]`).exists(), target).toBe(false);
      }
      expect(wrapper.html()).not.toContain("/traces");
    });

    it("never runs a logs search, on open or on a host switch", async () => {
      wrapper = await mountDrawer();
      await wrapper.setProps({ hostName: "web-02" });
      await flushPromises();
      expect(searchMock).not.toHaveBeenCalled();
    });

    // The undetected face used to carry an Explore-in-Logs link, and resolving its
    // href is what dragged the whole schema walk into a metrics-only drawer.
    it("the undetected face names the missing receiver without resolving a log stream", async () => {
      primeStreams([]);
      wrapper = await mountDrawer();
      expect(wrapper.find('[data-test="host-drawer-metrics-undetected"]').exists()).toBe(true);
      expect(getStreamsMock).not.toHaveBeenCalledWith("logs", expect.anything(), expect.anything());
      expect(loadSemanticGroupsMock).not.toHaveBeenCalled();
      expect(searchMock).not.toHaveBeenCalled();
    });
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

    it("F6: the stale banner renders the BANNER copy with duration and date, not a capability line", async () => {
      // It used to print `capabilityKey` — a neutral description of what the group
      // DOES — under a warning chrome, dropping the duration and date entirely.
      // Under a warning banner that reads as a non-sequitur.
      wrapper = await mountDrawer({ status: "INACTIVE", lastSeenUs: STALE_LAST_SEEN });
      const banner = wrapper.find('[data-test="curated-stale-banner"]');
      expect(banner.exists()).toBe(true);
      const text = banner.text();
      // The banner's own copy: an elapsed duration, a last-seen date and the
      // "values are from before then" caveat — none of which the capability
      // sentence alone carried.
      expect(text).toContain("stopped");
      expect(text).toMatch(/stopped \d+ (minute|hour|day)s? ago/);
      expect(text).toContain("last seen");
      expect(text).toContain("Values below are from before then");
      expect(text).not.toContain("{duration}");
      expect(text).not.toContain("{date}");
      expect(text).not.toContain("{capability}");
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

    // The drawer handled `unknown` only, so `dormant` and `undetected` both fell
    // through to RenderDashboardCharts with tabs:[] — and its generic empty state
    // told the user to "Add a panel" on a read-only curated surface.
    it("`dormant` names the outage instead of handing the renderer an empty dashboard", async () => {
      primeStreams(HOST_STREAMS, NOW_US - 25 * 60 * 60 * 1_000_000);
      wrapper = await mountDrawer();
      expect(wrapper.find('[data-test="host-drawer-metrics-dormant"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("stopped reporting");
      expect(lastDashboardData).toBeNull();
    });

    it("`undetected` explains the missing receiver instead of offering a panel editor", async () => {
      primeStreams([]);
      wrapper = await mountDrawer();
      expect(wrapper.find('[data-test="host-drawer-metrics-undetected"]').exists()).toBe(true);
      expect(lastDashboardData).toBeNull();
    });

    // The `|| !hasPanels` catch-all, which no FACE reaches: resolveManifest only
    // marks a group present when a panel is visible (resolve.ts:563), so a ready
    // face always has one today. The guard defends the RENDERER contract instead —
    // buildDashboard drops panel-less tabs (resolve.ts:756), so if that ever emits
    // an empty tab set under a ready face, "Add a panel" must still not appear.
    describe("ready face whose dashboard has no panels", () => {
      const readyWithTabs = (tabs: unknown[]) => {
        curatedOverride.current = (real: any) => ({
          ...real,
          face: computed(() => "ready" as const),
          dashboard: ref({ version: 8, tabs }),
        });
      };

      it("renders the curated copy, not the panel editor, when tabs is empty", async () => {
        readyWithTabs([]);
        wrapper = await mountDrawer();
        expect(wrapper.find('[data-test="host-drawer-metrics-undetected"]').exists()).toBe(true);
        expect(wrapper.text()).not.toContain("Add a panel");
        // The renderer must never be handed it — that is what printed the copy.
        expect(lastDashboardData).toBeNull();
      });

      it("also covers a tab that exists but carries zero panels", async () => {
        readyWithTabs([{ tabId: "host", name: "host", panels: [] }]);
        wrapper = await mountDrawer();
        expect(wrapper.find('[data-test="host-drawer-metrics-undetected"]').exists()).toBe(true);
        expect(lastDashboardData).toBeNull();
      });
    });

    // A curated read-only surface must NEVER print the generic dashboard copy.
    it("never renders the generic 'Add a panel' empty state in any non-ready face", async () => {
      for (const prime of [
        () => primeStreams(HOST_STREAMS, NOW_US - 25 * 60 * 60 * 1_000_000),
        () => primeStreams([]),
      ]) {
        prime();
        wrapper = await mountDrawer();
        // tabs:[] is what made RenderDashboardCharts print it — never hand it one.
        expect((lastDashboardData?.tabs ?? []).length === 0 && lastDashboardData !== null).toBe(
          false,
        );
        wrapper.unmount();
      }
    });

    // Every case above asserts against a STUB, so the renderer's own tab selection
    // was never exercised: it reads `inject("selectedTabId", ref("default"))` and
    // scopes panels to THAT tab (RenderDashboardCharts.vue:452,590), while the
    // curated builder mints tabId = section id (resolve.ts:765) — never "default".
    describe("the tab the real renderer would select", () => {
      const tabAwareStub = defineComponent({
        name: "RenderDashboardCharts",
        props: ["dashboardData", "currentTimeObj", "viewOnly", "searchType"],
        setup(props) {
          const selectedTabId = inject<Ref<string | null>>("selectedTabId", ref("default"));
          const panels = computed(
            () =>
              (props.dashboardData?.tabs ?? []).find(
                (tab: any) => tab.tabId === selectedTabId.value,
              )?.panels ?? [],
          );
          return { panels };
        },
        template:
          "<div><div v-if='!panels.length' data-test='render-no-panel'>Add a panel to start visualizing</div><div v-else data-test='render-panels'>{{ panels.length }}</div></div>",
      });

      const mountWithRealTabSelection = () => mountDrawer({}, tabAwareStub);

      it("selects a tab that EXISTS, so the panels actually render", async () => {
        wrapper = await mountWithRealTabSelection();
        expect(wrapper.find('[data-test="render-no-panel"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="render-panels"]').exists()).toBe(true);
      });

      it("never leaves the renderer on the 'Add a panel' copy for a ready host", async () => {
        wrapper = await mountWithRealTabSelection();
        expect(wrapper.text()).not.toContain("Add a panel");
      });
    });
  });

  describe("host switch while open (?host= edited)", () => {
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
  // ── Time range handed to the shared renderer ─────────────────────────────

  describe("the window the inline dashboard queries", () => {
    it("hands RenderDashboardCharts Dates on the MICROSECOND epoch", async () => {
      // Same defect the curated page carried: `new Date(us / 1000)` builds a
      // ms-epoch Date, and usePanelDataLoader:418 reads it straight back as µs,
      // so convertPromQLData's gap-fill snapped the axis floor to 1970.
      // Every other producer feeds it undivided — plugins/metrics/Index.vue:425.
      wrapper = await mountDrawer();
      expect(lastCurrentTimeObj.__global.start_time.getTime()).toBe(RANGE.from);
      expect(lastCurrentTimeObj.__global.end_time.getTime()).toBe(RANGE.to);
    });
  });
});
