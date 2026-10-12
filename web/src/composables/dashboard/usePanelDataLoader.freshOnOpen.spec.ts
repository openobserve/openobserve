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
import { defineComponent, h, provide, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { usePanelDataLoader } from "./usePanelDataLoader";
import {
  createDashboardFreshOnOpen,
  DASHBOARD_FRESH_ON_OPEN,
  type DashboardFreshOnOpen,
} from "./dashboardFreshOnOpen";
import { isEffectivePanelTimeRelative } from "@/utils/dashboard/panelTimeUtils";

// Real loader, executors and search handlers; only the cache, the stream transport and the network are fakes.
const fakes = vi.hoisted(() => ({
  cache: new Map<string, any>(),
  saves: [] as any[],
  streams: [] as { payload: any; handlers: any }[],
  cancelStream: null as any,
  deleteRunningQueries: null as any,
  traceCounter: 0,
  streamLookup: null as any,
}));

vi.mock("./usePanelCache", () => ({
  usePanelCache: (_folderId: string, _dashboardId: string, panelId: string) => ({
    getPanelCache: async () => fakes.cache.get(panelId) ?? null,
    savePanelCache: async (key: any, value: any, cacheTimeRange: any) => {
      const entry = JSON.parse(JSON.stringify({ key, value, cacheTimeRange }));
      fakes.saves.push(entry);
      fakes.cache.set(panelId, entry);
    },
  }),
}));

vi.mock("../useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      fakes.streams.push({ payload, handlers });
    },
    cancelStreamQueryBasedOnRequestId: (...args: any[]) => fakes.cancelStream(...args),
  }),
}));

vi.mock("../../services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      delete_running_queries: (...args: any[]) => fakes.deleteRunningQueries(...args),
    },
  });
});

vi.mock("./useAnnotations", () => ({
  useAnnotations: () => ({ refreshAnnotations: async () => [] }),
}));

vi.mock("@/utils/query/sqlUtils", () => ({
  addLabelsToSQlQuery: async (query: string) => query,
  getStreamFromQuery: (...args: any[]) => fakes.streamLookup(...args),
}));

vi.mock("@/composables/useLogs/logsUtils", () => ({
  default: () => ({ checkTimestampAlias: () => true }),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/zincutils")>()),
  generateTraceContext: () => ({
    traceparent: "tp",
    traceId: `trace-${++fakes.traceCounter}`,
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "org-1" },
      zoConfig: {},
      timezone: "UTC",
      organizationData: { organizationSettings: { scrape_interval: 15 } },
    },
  }),
}));

const NOW = new Date("2026-10-12T10:00:00Z").getTime();
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const windowEndingAt = (end: number, span = FIFTEEN_MINUTES) => ({
  start_time: new Date(end - span),
  end_time: new Date(end),
});

const sqlPanel = (config: Record<string, any> = {}) => ({
  id: "panel-1",
  title: "Requests",
  type: "line",
  queryType: "sql",
  config,
  queries: [
    {
      query: "SELECT histogram(_timestamp) AS x, count(*) AS y FROM logs GROUP BY x",
      fields: { stream_type: "logs", x: [] },
      config: {},
    },
  ],
});

const RELATIVE = { valueType: "relative", relativeTimePeriod: "15m" };
const ABSOLUTE = { valueType: "absolute", startTime: 1, endTime: 2 };

// Mirrors ViewDashboard's provide: the Auto Run toggle plus the panel's effective range.
const createVisit = (autoRun = { value: true }, globalTime: any = RELATIVE, query: any = {}) =>
  createDashboardFreshOnOpen({
    isAutoRunOn: () => autoRun.value,
    isRelativeRange: (panel) => isEffectivePanelTimeRelative(panel, query, globalTime),
  });

const AUTO_RUN_OFF = { value: false };

const AD_HOC_FILTER = [
  {
    type: "dynamic_filters",
    name: "Dynamic filters",
    value: [{ name: "service", operator: "=", value: "api" }],
    isLoading: false,
    isVariableLoadingPending: false,
  },
];

const mounted: VueWrapper[] = [];

const mountPanel = ({
  visit,
  panel = sqlPanel(),
  time = windowEndingAt(NOW),
  withoutCache = false,
  variables = [],
}: {
  visit?: DashboardFreshOnOpen | null;
  panel?: any;
  time?: any;
  withoutCache?: boolean;
  variables?: any[];
} = {}) => {
  let loader: any;
  const selectedTimeObj = ref(time);
  const Panel = defineComponent({
    setup() {
      const chartPanelRef = ref(null);
      loader = usePanelDataLoader(
        ref(panel),
        selectedTimeObj,
        ref({ isVariablesLoading: false, values: variables }),
        chartPanelRef,
        ref(false),
        ref("dashboards"),
        ref("dashboard-1"),
        ref("folder-1"),
        ref(null), // reportId
        ref(null), // runId
        ref(null), // tabId
        ref(null), // tabName
        ref(null), // searchResponse
        ref(false), // is_ui_histogram
        ref("Dashboard"),
        ref("Folder"),
        ref(withoutCache),
      );
      return () => h("div", { ref: chartPanelRef });
    },
  });
  const Host = defineComponent({
    setup() {
      if (visit) provide(DASHBOARD_FRESH_ON_OPEN, visit);
      return () => h(Panel);
    },
  });
  const wrapper = mount(Host);
  mounted.push(wrapper);
  return { wrapper, loader, selectedTimeObj };
};

// Past the observer tick and the debounce; small steps let each awaited stage queue its next timer.
const settle = async () => {
  for (let step = 0; step < 20; step++) await vi.advanceTimersByTimeAsync(20);
};

const hits = (value: number) => [{ x: "2026-10-12T09:50:00", y: value }];

const sendHits = (streamIndex: number, value: number) => {
  const { payload, handlers } = fakes.streams[streamIndex];
  handlers.data(payload, { type: "search_response", content: { results: { hits: hits(value) } } });
};

const endStream = (streamIndex: number) => {
  const { payload, handlers } = fakes.streams[streamIndex];
  handlers.data(payload, { type: "end" });
};

// A cold load in its own earlier visit leaves a complete entry in the cache.
const seedCache = async (
  value: number,
  {
    time = windowEndingAt(NOW - 10 * 60 * 1000),
    visit = createVisit(),
    variables = [] as any[],
  } = {},
) => {
  vi.setSystemTime(time.end_time);
  const { wrapper } = mountPanel({ visit, time, variables });
  await settle();
  sendHits(fakes.streams.length - 1, value);
  endStream(fakes.streams.length - 1);
  await settle();
  wrapper.unmount();
  vi.setSystemTime(NOW);
  fakes.streams.length = 0;
  fakes.saves.length = 0;
};

describe("usePanelDataLoader: fresh on open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fakes.cache.clear();
    fakes.saves.length = 0;
    fakes.streams.length = 0;
    fakes.cancelStream = vi.fn();
    fakes.deleteRunningQueries = vi.fn().mockResolvedValue({});
    fakes.streamLookup = async () => "logs";
    global.IntersectionObserver = vi.fn(function (this: any, callback: any) {
      this.observe = () => callback([{ isIntersecting: true }]);
      this.disconnect = vi.fn();
    }) as any;
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.useRealTimers();
  });

  describe("gating", () => {
    it("re-queries a restored panel when Auto Run is on and the range is relative", async () => {
      await seedCache(10);
      const { loader } = mountPanel({ visit: createVisit() });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(1);
      expect(fakes.streams[0].payload.queryReq.query.end_time).toBe(NOW);
      expect(fakes.streams[0].payload.clear_cache).toBe(false);
    });

    it("keeps today's restore-only open when Auto Run is off", async () => {
      await seedCache(10);
      const { loader } = mountPanel({ visit: createVisit({ value: false }) });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(0);
    });

    it("never re-queries outside a dashboard view", async () => {
      await seedCache(10);
      const { loader } = mountPanel({ visit: null });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(0);
    });

    it("leaves an absolute global range on its cached result", async () => {
      const absolute = createVisit({ value: true }, ABSOLUTE);
      await seedCache(10, { time: windowEndingAt(NOW), visit: absolute });
      const { loader } = mountPanel({ visit: absolute });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(0);
    });

    it("follows the panel's own relative time over an absolute global range", async () => {
      const panel = sqlPanel({
        panel_time_enabled: true,
        panel_time_range: { type: "relative", relativeTimePeriod: "15m" },
      });
      vi.setSystemTime(NOW - 60_000);
      const first = mountPanel({ visit: createVisit({ value: true }, ABSOLUTE), panel });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();
      vi.setSystemTime(NOW);
      fakes.streams.length = 0;

      mountPanel({ visit: createVisit({ value: true }, ABSOLUTE), panel });
      await settle();

      expect(fakes.streams).toHaveLength(1);
    });

    it("leaves a panel with its own absolute time alone under a relative global range", async () => {
      const panel = sqlPanel({
        panel_time_enabled: true,
        panel_time_range: { type: "absolute", startTime: 1, endTime: 2 },
      });
      const first = mountPanel({ visit: createVisit(), panel });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();
      fakes.streams.length = 0;

      mountPanel({ visit: createVisit(), panel });
      await settle();

      expect(fakes.streams).toHaveLength(0);
    });

    it("loads normally, with nothing held, when there is no cache entry", async () => {
      const { loader } = mountPanel({ visit: createVisit() });
      await settle();

      expect(fakes.streams).toHaveLength(1);
      expect(loader.isRefreshingInBackground.value).toBe(false);
      sendHits(0, 7);
      expect(loader.data.value).toEqual([hits(7)]);
    });

    it("reads through the server cache even when Refresh cache & reload was used earlier", async () => {
      await seedCache(10);
      mountPanel({ visit: createVisit(), withoutCache: true });
      await settle();

      expect(fakes.streams).toHaveLength(1);
      expect(fakes.streams[0].payload.clear_cache).toBe(false);
    });

    it("still skips the server cache for a normal load that asked for it", async () => {
      mountPanel({ visit: createVisit(), withoutCache: true });
      await settle();

      expect(fakes.streams[0].payload.clear_cache).toBe(true);
    });

    it("reads the Auto Run gate when the panel loads, not live", async () => {
      await seedCache(10);
      const autoRun = { value: false };
      mountPanel({ visit: createVisit(autoRun) });
      await settle();
      autoRun.value = true;
      await settle();

      expect(fakes.streams).toHaveLength(0);
    });
  });

  describe("hold and swap", () => {
    it("keeps the restored chart while the refresh streams, then swaps on completion", async () => {
      await seedCache(10);
      const restoredAt = fakes.cache.get("panel-1").value.lastTriggeredAt;
      const { loader } = mountPanel({ visit: createVisit() });
      await settle();

      expect(loader.isRefreshingInBackground.value).toBe(true);
      expect(loader.loading.value).toBe(true);

      sendHits(0, 42);
      await settle();
      expect(loader.data.value).toEqual([hits(10)]);
      expect(loader.lastTriggeredAt.value).toBe(restoredAt);
      expect(loader.isPartialData.value).toBe(false);
      expect(fakes.saves).toHaveLength(0);

      endStream(0);
      expect(loader.isRefreshingInBackground.value).toBe(false);
      expect(loader.loading.value).toBe(false);
      expect(loader.data.value).toEqual([hits(42)]);
      expect(loader.lastTriggeredAt.value).toBeGreaterThan(restoredAt);
      await settle();
      expect(fakes.cache.get("panel-1").value.data).toEqual([hits(42)]);
    });

    it("replaces the restored chart with the error when the refresh fails", async () => {
      await seedCache(10);
      const { loader } = mountPanel({ visit: createVisit() });
      await settle();

      const { payload, handlers } = fakes.streams[0];
      handlers.error(payload, { content: { message: "querier timed out", code: 504 } });

      expect(loader.isRefreshingInBackground.value).toBe(false);
      expect(loader.errorDetail.value.message).toBe("querier timed out");
      expect(loader.data.value).not.toEqual([hits(10)]);
    });

    it("keeps the restored chart and its cache entry when the refresh is cancelled", async () => {
      await seedCache(10);
      const entryBefore = fakes.cache.get("panel-1");
      const { loader } = mountPanel({ visit: createVisit() });
      await settle();
      sendHits(0, 42);
      await settle();

      window.dispatchEvent(new Event("cancelQuery"));

      expect(loader.isRefreshingInBackground.value).toBe(false);
      expect(loader.loading.value).toBe(false);
      expect(loader.data.value).toEqual([hits(10)]);
      expect(loader.isPartialData.value).toBe(false);
      expect(fakes.cancelStream).toHaveBeenCalled();
      await settle();
      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
    });

    it("does not save the partial refresh over the cache when the panel unmounts mid-refresh", async () => {
      await seedCache(10);
      const entryBefore = fakes.cache.get("panel-1");
      const { wrapper } = mountPanel({ visit: createVisit() });
      await settle();
      sendHits(0, 42);
      await settle();

      wrapper.unmount();
      await settle();

      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
      expect(fakes.cancelStream).toHaveBeenCalled();
      expect(fakes.deleteRunningQueries).toHaveBeenCalled();
    });

    it("keeps holding when a newer run supersedes the refresh", async () => {
      await seedCache(10);
      const { loader, selectedTimeObj } = mountPanel({ visit: createVisit() });
      await settle();

      selectedTimeObj.value = windowEndingAt(NOW + 60_000);
      await settle();
      expect(fakes.streams).toHaveLength(2);
      sendHits(1, 99);
      await settle();
      expect(loader.data.value).toEqual([hits(10)]);

      endStream(1);
      expect(loader.data.value).toEqual([hits(99)]);
      expect(loader.isRefreshingInBackground.value).toBe(false);
    });
  });

  describe("once per visit", () => {
    it("restores a revisited tab's fresh entry without another query", async () => {
      await seedCache(10);
      const visit = createVisit();
      const first = mountPanel({ visit });
      await settle();
      sendHits(0, 42);
      endStream(0);
      await settle();
      first.wrapper.unmount();

      const revisit = mountPanel({ visit });
      await settle();

      expect(fakes.streams).toHaveLength(1);
      expect(revisit.loader.data.value).toEqual([hits(42)]);
    });

    it("refreshes again on a new visit", async () => {
      await seedCache(10);
      const first = mountPanel({ visit: createVisit() });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();

      mountPanel({ visit: createVisit() });
      await settle();

      expect(fakes.streams).toHaveLength(2);
    });

    it("refreshes a revisited tab whose earlier refresh never completed", async () => {
      await seedCache(10);
      const visit = createVisit();
      const first = mountPanel({ visit });
      await settle();
      first.wrapper.unmount();

      mountPanel({ visit });
      await settle();

      expect(fakes.streams).toHaveLength(2);
    });

    it("refreshes a revisited tab whose cached result is for another window length", async () => {
      await seedCache(10);
      const visit = createVisit();
      const first = mountPanel({ visit });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();

      mountPanel({ visit, time: windowEndingAt(NOW, 60 * 60 * 1000) });
      await settle();

      expect(fakes.streams).toHaveLength(2);
    });

    it("forgets the visit's refreshed panels on reset", async () => {
      await seedCache(10);
      const visit = createVisit();
      const first = mountPanel({ visit });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();

      visit.reset();
      mountPanel({ visit });
      await settle();

      expect(fakes.streams).toHaveLength(2);
    });
  });

  describe("an interrupted run keeps the last complete entry", () => {
    // A restored panel with Auto Run off, then a time change: a normal run, not a held refresh.
    const startNormalRun = async (visit: DashboardFreshOnOpen | null, variables: any[] = []) => {
      const panel = mountPanel({ visit, variables });
      await settle();
      expect(panel.loader.data.value).toEqual([hits(10)]);
      panel.selectedTimeObj.value = windowEndingAt(NOW + 60_000);
      await settle();
      return panel;
    };

    it("when the view unmounts mid-run", async () => {
      await seedCache(10, { visit: createVisit(AUTO_RUN_OFF) });
      const entryBefore = fakes.cache.get("panel-1");
      const { wrapper } = await startNormalRun(createVisit(AUTO_RUN_OFF));
      sendHits(0, 42);

      wrapper.unmount();
      await settle();

      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
    });

    it("when a first load is interrupted, by writing nothing", async () => {
      const { wrapper } = mountPanel({ visit: createVisit() });
      await settle();
      sendHits(0, 42);

      wrapper.unmount();
      await settle();

      expect(fakes.cache.size).toBe(0);
    });

    it("when the run is cancelled", async () => {
      await seedCache(10, { visit: createVisit(AUTO_RUN_OFF) });
      const entryBefore = fakes.cache.get("panel-1");
      await startNormalRun(createVisit(AUTO_RUN_OFF));
      sendHits(0, 42);

      window.dispatchEvent(new Event("cancelQuery"));
      await settle();

      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
    });

    it("when the executor drops an aborted run before it streams", async () => {
      const visit = createVisit(AUTO_RUN_OFF);
      await seedCache(10, { visit, variables: AD_HOC_FILTER });
      const entryBefore = fakes.cache.get("panel-1");
      let finishLookup: (stream: string) => void = () => {};
      fakes.streamLookup = () => new Promise((resolve) => (finishLookup = resolve));
      const { wrapper } = await startNormalRun(visit, AD_HOC_FILTER);

      wrapper.unmount();
      finishLookup("logs");
      await settle();

      expect(fakes.streams).toHaveLength(0);
      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
    });

    it("when an editor run outside the dashboard view is interrupted", async () => {
      await seedCache(10);
      const entryBefore = fakes.cache.get("panel-1");
      const { wrapper } = await startNormalRun(null);
      sendHits(0, 42);

      wrapper.unmount();
      await settle();

      expect(fakes.saves).toHaveLength(0);
      expect(fakes.cache.get("panel-1")).toBe(entryBefore);
    });
  });

  describe("absolute ranges restore only their own window", () => {
    const absolute = () => createVisit({ value: true }, ABSOLUTE);
    const earlier = () => windowEndingAt(NOW - 5 * 60_000);

    it("restores the exact same window", async () => {
      await seedCache(10, { time: earlier(), visit: absolute() });
      const { loader } = mountPanel({ visit: absolute(), time: earlier() });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(0);
    });

    it("loads another window of the same length instead of restoring it", async () => {
      await seedCache(10, { time: earlier(), visit: absolute() });
      const { loader } = mountPanel({ visit: absolute(), time: windowEndingAt(NOW) });
      await settle();

      expect(fakes.streams).toHaveLength(1);
      expect(loader.data.value).not.toEqual([hits(10)]);
      expect(loader.isRefreshingInBackground.value).toBe(false);
      sendHits(0, 7);
      endStream(0);
      expect(loader.data.value).toEqual([hits(7)]);
    });

    it("applies to a panel's own absolute time under a relative global range", async () => {
      const panel = sqlPanel({
        panel_time_enabled: true,
        panel_time_range: { type: "absolute", startTime: 1, endTime: 2 },
      });
      const first = mountPanel({ visit: createVisit(), panel, time: earlier() });
      await settle();
      endStream(0);
      await settle();
      first.wrapper.unmount();
      fakes.streams.length = 0;

      mountPanel({ visit: createVisit(), panel, time: windowEndingAt(NOW) });
      await settle();

      expect(fakes.streams).toHaveLength(1);
    });

    it("keeps restoring a relative range from an earlier window", async () => {
      await seedCache(10);
      const { loader } = mountPanel({ visit: createVisit(AUTO_RUN_OFF) });
      await settle();

      expect(loader.data.value).toEqual([hits(10)]);
      expect(fakes.streams).toHaveLength(0);
    });
  });
});
