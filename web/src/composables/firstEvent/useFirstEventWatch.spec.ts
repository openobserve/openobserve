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
import { effectScope, ref, type EffectScope, type Ref } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import { streamKeys } from "@/services/stream.querykeys";
import { useFirstEventWatch, type StreamSignal } from "./useFirstEventWatch";

interface FakeRow {
  name: string;
  stream_type?: string;
  stats?: { doc_num?: number; doc_time_min?: number; doc_time_max?: number };
}

const rows: Record<string, FakeRow[]> = { logs: [], metrics: [], traces: [], profiles: [] };
const nameList = vi.fn(
  async (_org: string, type: string, _schema: boolean, offset = -1, limit = -1, keyword = "") => {
    const all = (rows[type] ?? []).filter((r) => !keyword || r.name.includes(keyword));
    const list = offset === -1 ? all : all.slice(offset, offset + limit);
    return { data: { list: list.map((r) => ({ stream_type: type, ...r })), total: all.length } };
  },
);
const schema = vi.fn(async () => ({ data: { schema: [{ name: "_timestamp" }] } }));
vi.mock("@/services/stream", () => ({
  default: {
    nameList: (...a: Parameters<typeof nameList>) => nameList(...a),
    schema: () => schema(),
  },
}));

const countHits = vi.fn((): Record<string, unknown>[] => [{ zo_count: 0, zo_min: 0 }]);
const anchorHits = vi.fn((): Record<string, unknown>[] => [{ zo_count: 0, zo_now: 0 }]);
const search = vi.fn(async (req: { query: { query: { sql: string } } }) => {
  const sql = req.query.query.sql;
  if (sql.includes("zo_now")) return { data: { hits: anchorHits() } };
  if (sql.startsWith("SELECT COUNT")) return { data: { hits: countHits() } };
  return { data: { hits: [{ _timestamp: 1, level: "info", _o2_id: "x" }] } };
});
vi.mock("@/services/search", () => ({
  default: { search: (req: { query: { query: { sql: string } } }) => search(req) },
}));

const recentRejections = vi.fn(
  async (): Promise<{ data: { tracked?: boolean; list: unknown[] } }> => ({
    data: { tracked: true, list: [] },
  }),
);
vi.mock("@/services/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/ingestion")>()),
  default: { recentRejections: () => recentRejections() },
}));

const zoConfig: Record<string, unknown> = {};
const storeState = {
  zoConfig,
  API_ENDPOINT: "http://o2.test",
  selectedOrganization: { identifier: "acme" },
  organizationData: { isDataIngested: false } as { isDataIngested?: boolean | null },
  streams: {
    logs: {},
    metrics: {},
    traces: {},
    enrichment_tables: {},
    index: {},
    metadata: {},
    streamsIndexMapping: {},
    areAllStreamsFetched: false,
  },
};
const dispatch = vi.fn();
vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState, dispatch, commit: vi.fn() }),
}));

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 10, 0, 0);

let scope: EffectScope;
interface WatchOpts {
  org?: Ref<string>;
  targetStream?: string | Ref<string | undefined>;
  filter?: string;
  match?: "exact" | "keyword";
  autoDiagnosis?: boolean;
}
const watchOf = (signal?: StreamSignal, opts: WatchOpts = {}) => {
  scope = effectScope();
  const targetStream =
    typeof opts.targetStream === "object" ? opts.targetStream : ref(opts.targetStream);
  return scope.run(() =>
    useFirstEventWatch(opts.org ?? ref("acme"), ref(signal), {
      targetStream,
      filter: ref(opts.filter),
      match: ref(opts.match),
      ...(opts.autoDiagnosis === undefined ? {} : { autoDiagnosis: ref(opts.autoDiagnosis) }),
    }),
  )!;
};

const probeCalls = () => nameList.mock.calls.filter((c) => c[3] === 0 && c[4] === 1).length;
const unpagedCalls = () => nameList.mock.calls.filter((c) => c[3] === undefined || c[3] === -1);
const countCalls = () =>
  search.mock.calls
    .map((c) => c[0] as { query: { query: { sql: string; start_time: number; end_time: number } } })
    .filter(
      (r) => r.query.query.sql.startsWith("SELECT COUNT") && !r.query.query.sql.includes("zo_now"),
    );
const keywordPageCalls = (type: string, keyword: string) =>
  nameList.mock.calls.filter((c) => c[1] === type && c[5] === keyword);
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  storeState.selectedOrganization.identifier = "acme";
  storeState.organizationData.isDataIngested = false;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  rows.logs = [];
  rows.metrics = [];
  rows.traces = [];
  rows.profiles = [];
  for (const k of Object.keys(zoConfig)) delete zoConfig[k];
  setVisibility("visible");
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  scope?.stop();
  queryClient.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("useFirstEventWatch — budget", () => {
  it("probes 120 times in the first 10 minutes, 100 more to 60 minutes, then never again", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(600_000 - 1);
    expect(probeCalls()).toBe(120);
    await vi.advanceTimersByTimeAsync(3_000_000);
    expect(probeCalls()).toBe(220);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(probeCalls()).toBe(220);
    expect(w.state.value).toBe("stopped");
  });

  it("sends nothing while the tab is hidden and probes within a second of it becoming visible", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(probeCalls()).toBe(1);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(probeCalls()).toBe(1);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(1000);
    expect(probeCalls()).toBe(2);
  });

  it("restarts the fast cadence on a copy", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(700_000);
    const before = probeCalls();
    w.start("copy");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probeCalls() - before).toBe(2);
  });
});

describe("useFirstEventWatch — confirmation", () => {
  it("never flips on a listed stream with doc_num 0 and a COUNT of 0", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 0 } }];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(countCalls().length).toBeGreaterThan(0);
    expect(w.state.value).toBe("waiting");
  });

  it("confirms a new stream over the ingest window on both sides, a record five hours ahead included", async () => {
    zoConfig.ingest_allowed_upto = 5;
    zoConfig.ingest_allowed_in_future = 24;
    const ahead = (NOW + 5 * HOUR) * 1000;
    countHits.mockReturnValue([{ zo_count: 3, zo_min: ahead }]);
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default" }];
    await vi.advanceTimersByTimeAsync(5000);
    const req = countCalls()[0].query.query;
    expect(req.start_time).toBe((NOW + 5000 - 6 * HOUR) * 1000);
    expect(req.end_time).toBe((NOW + 5000 + 25 * HOUR) * 1000);
    expect(w.state.value).toBe("received");
    expect(w.result.value).toMatchObject({ streamName: "default", streamType: "logs", count: 3 });
  });

  it("trims the future end first when max_query_range is set", async () => {
    zoConfig.max_query_range = 10;
    countHits.mockReturnValue([{ zo_count: 1, zo_min: NOW * 1000 }]);
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default" }];
    await vi.advanceTimersByTimeAsync(5000);
    const req = countCalls()[0].query.query;
    expect(req.end_time - req.start_time).toBe(10 * HOUR * 1000);
    expect(req.start_time).toBe((NOW + 5000 - 6 * HOUR) * 1000);
    expect(w.state.value).toBe("received");
  });

  it("takes the range from zo_min when doc_time_min is 0, even before the watch started", async () => {
    const zoMin = (NOW - HOUR) * 1000;
    countHits.mockReturnValue([{ zo_count: 1, zo_min: zoMin }]);
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 0, doc_time_min: 0 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.result.value?.rangeStart).toBe(1 - 900_000_000);
    expect(w.result.value?.firstRecord).toEqual({ _timestamp: 1, level: "info", _o2_id: "x" });
  });

  it("confirms on doc_num without a COUNT and ranges around doc_time_min", async () => {
    const docMin = (NOW - 2 * HOUR) * 1000;
    search.mockImplementation(async () => ({ data: { hits: [{ _timestamp: docMin }] } }));
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 1284, doc_time_min: docMin } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(countCalls()).toHaveLength(0);
    expect(w.result.value).toMatchObject({
      count: 1284,
      rangeStart: docMin - 900_000_000,
      rangeEnd: docMin + 900_000_000,
    });
  });

  it("detects a new profiles stream on the profiles setup page", async () => {
    const docMin = (NOW - HOUR) * 1000;
    search.mockImplementation(async () => ({ data: { hits: [{ _timestamp: docMin }] } }));
    const w = watchOf("profiles");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.profiles = [{ name: "default", stats: { doc_num: 40, doc_time_min: docMin } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value).toMatchObject({ streamName: "default", streamType: "profiles" });
  });

  it("does not count internal streams or non-user types", async () => {
    const w = watchOf();
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "usage", stats: { doc_num: 9, doc_time_min: 9 } }];
    rows.metrics = [{ name: "_o2_db_stats", stats: { doc_num: 9, doc_time_min: 9 } }];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(w.state.value).toBe("waiting");
  });

  it("gates the filter on the schema: no filtered COUNT until every filter field exists", async () => {
    const w = watchOf("logs", {
      targetStream: "default",
      filter: "k8s_namespace_name IS NOT NULL",
    });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default" }];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(countCalls()).toHaveLength(0);
    expect(w.state.value).toBe("waiting");
    schema.mockResolvedValue({
      data: { schema: [{ name: "_timestamp" }, { name: "k8s_namespace_name" }] },
    });
    countHits.mockReturnValue([{ zo_count: 7, zo_min: NOW * 1000 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(countCalls()[0].query.query.sql).toContain("WHERE (k8s_namespace_name IS NOT NULL)");
    expect(w.state.value).toBe("received");
  });
});

describe("useFirstEventWatch — an org with data", () => {
  it("ignores streams that existed at the first probe and confirms one absent from the snapshot", async () => {
    rows.logs = [
      { name: "old_a", stats: { doc_num: 50, doc_time_min: 1 } },
      { name: "old_b", stats: { doc_num: 50, doc_time_min: 1 } },
    ];
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.state.value).toBe("waiting");
    rows.logs.push({ name: "fresh", stats: { doc_num: 4, doc_time_min: NOW * 1000 } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value?.streamName).toBe("fresh");
  });

  it("bounds every poll after the first: the type list is fetched only when the total moves", async () => {
    rows.logs = [{ name: "old_a" }];
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(unpagedCalls()).toHaveLength(1);
    expect(nameList.mock.calls.every((c) => c[1] === "logs")).toBe(true);
    rows.logs.push({ name: "fresh" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(unpagedCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(unpagedCalls()).toHaveLength(2);
  });

  it.each([
    ["ahead", 10 * 60_000],
    ["behind", -10 * 60_000],
  ])(
    "counts a target stream from the server's zo_now with the browser clock 10 min %s",
    async (_label, skewMs) => {
      const serverNowS = Math.floor(NOW / 1000);
      vi.setSystemTime(NOW + skewMs);
      rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
      anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
      countHits.mockReturnValue([{ zo_count: 312, zo_min: serverNowS * 1_000_000 + 5 }]);
      const w = watchOf("logs", { targetStream: "default" });
      w.start("check");
      await vi.advanceTimersByTimeAsync(5000);
      const req = countCalls()[0].query.query;
      expect(req.sql).toContain(`_timestamp >= ${serverNowS * 1_000_000}`);
      expect(req.start_time).toBe(serverNowS * 1_000_000);
      expect(w.scope.value).toBe("since-watch-start");
      expect(w.result.value).toMatchObject({ count: 312, sinceUs: serverNowS * 1_000_000 });
    },
  );

  it("finds the exact target name across keyword pages", async () => {
    rows.logs = [
      ...Array.from({ length: 25 }, (_, i) => ({ name: `app_${String(i).padStart(2, "0")}` })),
    ];
    rows.logs.splice(22, 0, { name: "app" });
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: Math.floor(NOW / 1000) }]);
    const w = watchOf("logs", { targetStream: "app" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    const keywordCalls = nameList.mock.calls.filter((c) => c[5] === "app");
    expect(keywordCalls.map((c) => [c[3], c[4]])).toEqual([
      [0, 20],
      [20, 20],
    ]);
    expect(w.scope.value).toBe("since-watch-start");
  });
});

describe("useFirstEventWatch — keyword sources", () => {
  const keywordWatch = () => watchOf("metrics", { targetStream: "system_", match: "keyword" });

  it("confirms new records in the busiest existing match, counted from the server clock", async () => {
    const serverNowS = Math.floor(NOW / 1000);
    rows.metrics = [
      { name: "system_cpu_time", stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 5 } },
      { name: "system_memory_usage", stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 9 } },
      { name: "node_load1", stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 99 } },
    ];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = keywordWatch();
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.scope.value).toBe("since-watch-start");
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("waiting");
    expect(countCalls()[0]?.query.query.sql).toContain('"system_memory_usage"');
    countHits.mockReturnValue([{ zo_count: 12, zo_min: serverNowS * 1_000_000 + 7 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value).toMatchObject({
      streamName: "system_memory_usage",
      streamType: "metrics",
      count: 12,
      sinceUs: serverNowS * 1_000_000,
    });
  });

  it("confirms new records in an existing match other than the busiest, at most two COUNTs a poll", async () => {
    const serverNowS = Math.floor(NOW / 1000);
    rows.metrics = ["cpu_time", "memory_usage", "disk_io", "network_io"].map((n, i) => ({
      name: `system_${n}`,
      stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 10 - i },
    }));
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    search.mockImplementation(async (req) => {
      const sql = req.query.query.sql;
      if (sql.includes("zo_now")) return { data: { hits: anchorHits() } };
      if (sql.startsWith("SELECT COUNT")) {
        const live = sql.includes('"system_network_io"');
        return { data: { hits: [{ zo_count: live ? 3 : 0, zo_min: serverNowS * 1_000_000 }] } };
      }
      return { data: { hits: [{ _timestamp: serverNowS * 1_000_000 }] } };
    });
    const w = keywordWatch();
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    for (let poll = 1; poll <= 3 && w.state.value === "waiting"; poll++) {
      await vi.advanceTimersByTimeAsync(5000);
      expect(countCalls().length).toBeLessThanOrEqual(2 * poll);
    }
    expect(w.state.value).toBe("received");
    expect(w.result.value).toMatchObject({
      streamName: "system_network_io",
      count: 3,
      sinceUs: serverNowS * 1_000_000,
    });
  });

  it("counts an existing match whose stats moved before the rest of the rotation", async () => {
    const serverNowS = Math.floor(NOW / 1000);
    rows.metrics = Array.from({ length: 8 }, (_, i) => ({
      name: `system_m${i}`,
      stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 100 - i },
    }));
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = keywordWatch();
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    rows.metrics[6].stats = { doc_num: 15, doc_time_min: 1, doc_time_max: 100 };
    await vi.advanceTimersByTimeAsync(5000);
    const counted = countCalls().map((r) => r.query.query.sql);
    expect(counted).toHaveLength(2);
    expect(counted[0]).toContain('"system_m0"');
    expect(counted[1]).toContain('"system_m6"');
    expect(w.state.value).toBe("waiting");
  });

  it.each([
    ["moved once", true],
    ["lagging", false],
  ])(
    "counts a match with new records (stats %s) while another match's stats move every poll",
    async (_label, liveStatsMove) => {
      const serverNowS = Math.floor(NOW / 1000);
      rows.metrics = ["m0", "churn", "m2", "live"].map((n, i) => ({
        name: `system_${n}`,
        stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 10 - i },
      }));
      anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
      search.mockImplementation(async (req) => {
        const sql = req.query.query.sql;
        if (sql.includes("zo_now")) return { data: { hits: anchorHits() } };
        if (sql.startsWith("SELECT COUNT")) {
          const live = sql.includes('"system_live"');
          return { data: { hits: [{ zo_count: live ? 4 : 0, zo_min: serverNowS * 1_000_000 }] } };
        }
        return { data: { hits: [{ _timestamp: serverNowS * 1_000_000 }] } };
      });
      const w = keywordWatch();
      w.start("check");
      await vi.advanceTimersByTimeAsync(1);
      if (liveStatsMove) rows.metrics[3].stats = { doc_num: 13, doc_time_min: 1, doc_time_max: 7 };
      const others = rows.metrics.length - 1;
      for (let poll = 1; poll <= 2 * others && w.state.value === "waiting"; poll++) {
        rows.metrics[1].stats = { doc_num: 9 + poll, doc_time_min: 1, doc_time_max: 9 };
        await vi.advanceTimersByTimeAsync(5000);
        expect(countCalls().length).toBeLessThanOrEqual(2 * poll);
        expect(keywordPageCalls("metrics", "system_")).toHaveLength(poll + 1);
      }
      expect(w.state.value).toBe("received");
      expect(w.result.value).toMatchObject({ streamName: "system_live", count: 4 });
    },
  );

  it("ignores a new stream outside the keyword and confirms a new match", async () => {
    const w = keywordWatch();
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.scope.value).toBe("new-data");
    rows.metrics.push({ name: "node_cpu", stats: { doc_num: 5, doc_time_min: NOW * 1000 } });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(w.state.value).toBe("waiting");
    rows.metrics.push({ name: "system_cpu_time", stats: { doc_num: 4, doc_time_min: NOW * 1000 } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value?.streamName).toBe("system_cpu_time");
  });

  it("reads one keyword page per poll while the match count stays put", async () => {
    rows.metrics = Array.from({ length: 25 }, (_, i) => ({
      name: `system_m${String(i).padStart(2, "0")}`,
      stats: { doc_time_max: i },
    }));
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: Math.floor(NOW / 1000) }]);
    const w = keywordWatch();
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    expect(keywordPageCalls("metrics", "system_")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(keywordPageCalls("metrics", "system_")).toHaveLength(6);
    expect(unpagedCalls()).toHaveLength(0);
    expect(w.state.value).toBe("waiting");
  });
});

describe("useFirstEventWatch — a target that already has data waits for the user", () => {
  const serverNowS = Math.floor(NOW / 1000);

  it("goes idle on open when the exact target exists, and never searches", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    countHits.mockReturnValue([{ zo_count: 312, zo_min: serverNowS * 1_000_000 }]);
    const w = watchOf("logs", { targetStream: "default" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(w.targetExists.value).toBe(true);
    const listCalls = nameList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.state.value).toBe("idle");
    expect(search).not.toHaveBeenCalled();
    expect(nameList.mock.calls.length).toBe(listCalls);
  });

  it("goes idle on open when keyword matches exist, and never searches", async () => {
    rows.metrics = [{ name: "system_cpu_time", stats: { doc_num: 9, doc_time_min: 1 } }];
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.state.value).toBe("idle");
    expect(w.targetExists.value).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it.each(["check", "copy"] as const)(
    "counts from the server clock once %s starts it from idle",
    async (reason) => {
      rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
      anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
      countHits.mockReturnValue([{ zo_count: 312, zo_min: serverNowS * 1_000_000 + 5 }]);
      const w = watchOf("logs", { targetStream: "default" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state.value).toBe("idle");
      w.start(reason);
      expect(w.state.value).toBe("waiting");
      await vi.advanceTimersByTimeAsync(5000);
      expect(w.state.value).toBe("received");
      expect(w.result.value).toMatchObject({ count: 312, sinceUs: serverNowS * 1_000_000 });
    },
  );

  it("keeps checking on open when the exact target exists but holds no records", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 0, doc_time_min: 0 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = watchOf("logs", { targetStream: "default" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
    countHits.mockReturnValue([{ zo_count: 4, zo_min: serverNowS * 1_000_000 + 5 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
  });

  it("keeps checking on open when keyword matches exist but hold no records", async () => {
    rows.metrics = [{ name: "system_cpu_time", stats: { doc_num: 0, doc_time_min: 0 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
  });

  it("holds a populated target again after a target change, even after a copy", async () => {
    rows.logs = [
      { name: "a", stats: { doc_num: 9, doc_time_min: 1 } },
      { name: "b", stats: { doc_num: 9, doc_time_min: 1 } },
    ];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const target = ref<string | undefined>("a");
    const w = watchOf("logs", { targetStream: target });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
    target.value = "b";
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
  });

  it("starts the count when probeNow is called from idle", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = watchOf("logs", { targetStream: "default" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    await w.probeNow();
    expect(w.state.value).toBe("waiting");
  });

  it("keeps checking on open while the target does not exist yet", async () => {
    const w = watchOf("logs", { targetStream: "nginx_access" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.state.value).toBe("waiting");
    rows.logs = [{ name: "nginx_access", stats: { doc_num: 4, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value?.sinceUs).toBeUndefined();
  });

  it("probes a changed target from idle and holds it when it does not exist, since the org has data", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    const target = ref<string | undefined>("default");
    const w = watchOf("logs", { targetStream: target });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    target.value = "nginx_access";
    await vi.advanceTimersByTimeAsync(1);
    expect(keywordPageCalls("logs", "nginx_access")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.state.value).toBe("idle");
    expect(keywordPageCalls("logs", "nginx_access")).toHaveLength(1);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("useFirstEventWatch — an org with data waits for the user on a missing target", () => {
  it("goes idle on open when the exact target does not exist, and stops probing", async () => {
    storeState.organizationData.isDataIngested = true;
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    const listCalls = nameList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.state.value).toBe("idle");
    expect(nameList.mock.calls.length).toBe(listCalls);
    expect(search).not.toHaveBeenCalled();
    expect(recentRejections).not.toHaveBeenCalled();
    expect(w.targetExists.value).toBe(false);
  });

  it("goes idle on open when no keyword match exists, and stops probing", async () => {
    storeState.organizationData.isDataIngested = true;
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(w.targetExists.value).toBe(false);
    const listCalls = nameList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(w.state.value).toBe("idle");
    expect(nameList.mock.calls.length).toBe(listCalls);
    expect(search).not.toHaveBeenCalled();
    expect(recentRejections).not.toHaveBeenCalled();
  });

  it.each(["check", "copy"] as const)(
    "polls for the missing target once %s starts it from idle, and reports its first record",
    async (reason) => {
      storeState.organizationData.isDataIngested = true;
      const w = watchOf("logs", { targetStream: "syslog_ng" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state.value).toBe("idle");
      w.start(reason);
      expect(w.state.value).toBe("waiting");
      const before = keywordPageCalls("logs", "syslog_ng").length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(w.state.value).toBe("waiting");
      expect(keywordPageCalls("logs", "syslog_ng").length).toBeGreaterThan(before + 1);
      rows.logs = [{ name: "syslog_ng", stats: { doc_num: 4, doc_time_min: NOW * 1000 } }];
      await vi.advanceTimersByTimeAsync(5000);
      expect(w.state.value).toBe("received");
      expect(w.result.value).toMatchObject({ streamName: "syslog_ng", count: 4 });
      expect(w.result.value?.sinceUs).toBeUndefined();
      expect(w.scope.value).toBe("new-data");
    },
  );

  it("reports the first keyword match once Check now starts it from idle", async () => {
    storeState.organizationData.isDataIngested = true;
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    await w.probeNow();
    expect(w.state.value).toBe("waiting");
    await vi.advanceTimersByTimeAsync(5000);
    rows.metrics = [{ name: "system_cpu_time", stats: { doc_num: 7, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value).toMatchObject({ streamName: "system_cpu_time", count: 7 });
  });

  it.each([false, undefined, null])(
    "keeps checking on open for a missing target while isDataIngested is %s",
    async (ingested) => {
      storeState.organizationData.isDataIngested = ingested;
      const w = watchOf("logs", { targetStream: "syslog_ng" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state.value).toBe("waiting");
      const before = keywordPageCalls("logs", "syslog_ng").length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(keywordPageCalls("logs", "syslog_ng").length).toBeGreaterThan(before + 1);
      rows.logs = [{ name: "syslog_ng", stats: { doc_num: 4, doc_time_min: NOW * 1000 } }];
      await vi.advanceTimersByTimeAsync(5000);
      expect(w.state.value).toBe("received");
    },
  );

  it.each([false, undefined])(
    "keeps checking on open with no keyword match while isDataIngested is %s",
    async (ingested) => {
      storeState.organizationData.isDataIngested = ingested;
      const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(w.state.value).toBe("waiting");
      expect(keywordPageCalls("metrics", "system_").length).toBeGreaterThan(1);
    },
  );
});

describe("useFirstEventWatch — org data on a direct load, before the flag is set", () => {
  const unkeyedCalls = () => nameList.mock.calls.filter((c) => !c[5]);
  const userStreamIn = (type: string) => {
    rows[type] = [{ name: "cpu_load", stats: { doc_num: 5, doc_time_min: 1 } }];
  };

  it.each([false, undefined])(
    "reads the org's user streams and goes idle on a missing target while isDataIngested is %s",
    async (ingested) => {
      storeState.organizationData.isDataIngested = ingested;
      userStreamIn("metrics");
      const w = watchOf("logs", { targetStream: "syslog_ng" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state.value).toBe("idle");
      expect(dispatch).toHaveBeenCalledWith("setIsDataIngested", true);
      const listCalls = nameList.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(w.state.value).toBe("idle");
      expect(nameList.mock.calls.length).toBe(listCalls);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it("goes idle with no keyword match when the org's user streams show data", async () => {
    userStreamIn("logs");
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    const listCalls = nameList.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(nameList.mock.calls.length).toBe(listCalls);
  });

  it("reads the org's user streams only after the target lookup finds no target", async () => {
    userStreamIn("metrics");
    const lookup = deferred<Awaited<ReturnType<typeof nameList>>>();
    const real = nameList.getMockImplementation()!;
    nameList.mockImplementation((...a) => (a[5] ? lookup.promise : real(...a)));
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(unkeyedCalls()).toHaveLength(0);
    expect(w.deciding.value).toBe(true);
    lookup.resolve({ data: { list: [], total: 0 } });
    await vi.advanceTimersByTimeAsync(1);
    expect(unkeyedCalls().length).toBeGreaterThan(0);
    expect(w.deciding.value).toBe(false);
    expect(w.state.value).toBe("idle");
  });

  it.each([
    ["an exact target exists", "logs", "syslog_ng", undefined, "syslog_ng"],
    ["keyword matches exist", "metrics", "system_", "keyword", "system_cpu"],
  ] as const)("reads no org stream list when %s", async (_label, signal, name, match, row) => {
    userStreamIn("traces");
    rows[signal] = [{ name: row, stats: {} }];
    const w = watchOf(signal, { targetStream: name, match });
    w.start("open");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.state.value).toBe("waiting");
    expect(unkeyedCalls()).toHaveLength(0);
  });

  it("ignores the stored flag when it belongs to another selected org", async () => {
    storeState.organizationData.isDataIngested = true;
    storeState.selectedOrganization.identifier = "beta";
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
    expect(unkeyedCalls().length).toBeGreaterThan(0);
  });

  it("never sets the shared flag from an earlier visit's record alone", async () => {
    localStorage.setItem(
      "o2.onboarding.firstData.acme",
      JSON.stringify({ lastVisit: NOW, hadData: true }),
    );
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(dispatch).not.toHaveBeenCalledWith("setIsDataIngested", true);
  });

  it("never sets the shared flag from another org's streams", async () => {
    storeState.selectedOrganization.identifier = "beta";
    userStreamIn("metrics");
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(dispatch).not.toHaveBeenCalledWith("setIsDataIngested", true);
  });

  it("keeps checking when the org holds only internal streams", async () => {
    rows.logs = [
      { name: "usage", stats: { doc_num: 9, doc_time_min: 1 } },
      { name: "_o2_pipeline", stats: { doc_num: 9, doc_time_min: 1 } },
    ];
    rows.metrics = [{ name: "_anomalies", stats: { doc_num: 9, doc_time_min: 1 } }];
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
    const before = keywordPageCalls("logs", "syslog_ng").length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(keywordPageCalls("logs", "syslog_ng").length).toBeGreaterThan(before + 1);
    expect(dispatch).not.toHaveBeenCalledWith("setIsDataIngested", true);
  });

  it("keeps checking when reading the org's user streams fails", async () => {
    userStreamIn("metrics");
    const real = nameList.getMockImplementation()!;
    nameList.mockImplementation(async (...a) => {
      if (!a[5]) throw new Error("503");
      return real(...a);
    });
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("waiting");
    const before = keywordPageCalls("logs", "syslog_ng").length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(keywordPageCalls("logs", "syslog_ng").length).toBeGreaterThan(before + 1);
  });

  it("reads no stream list beyond the target lookup when isDataIngested is already true", async () => {
    storeState.organizationData.isDataIngested = true;
    userStreamIn("metrics");
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(unkeyedCalls()).toHaveLength(0);
  });

  it("reads no stream list beyond the target lookup when an earlier visit recorded user data", async () => {
    userStreamIn("metrics");
    localStorage.setItem(
      "o2.onboarding.firstData.acme",
      JSON.stringify({ lastVisit: NOW, hadData: true }),
    );
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(unkeyedCalls()).toHaveLength(0);
  });
});

describe("useFirstEventWatch — no claim before the first decision", () => {
  it.each([
    [true, "idle"],
    [false, "waiting"],
  ] as const)(
    "decides a missing target only once the lookup answers (org has data: %s)",
    async (ingested, decided) => {
      storeState.organizationData.isDataIngested = ingested;
      const lookup = deferred<Awaited<ReturnType<typeof nameList>>>();
      const real = nameList.getMockImplementation()!;
      nameList.mockImplementation((...a) => (a[5] ? lookup.promise : real(...a)));
      const w = watchOf("logs", { targetStream: "syslog_ng" });
      w.start("open");
      expect(w.deciding.value).toBe(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(w.deciding.value).toBe(true);
      lookup.resolve({ data: { list: [], total: 0 } });
      await vi.advanceTimersByTimeAsync(1);
      expect(w.deciding.value).toBe(false);
      expect(w.state.value).toBe(decided);
    },
  );

  it("falls back to waiting when the first lookup fails", async () => {
    const real = nameList.getMockImplementation()!;
    nameList.mockImplementation(async (...a) => {
      if (a[5]) throw new Error("503");
      return real(...a);
    });
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.deciding.value).toBe(false);
    expect(w.state.value).toBe("waiting");
  });

  it("never decides a watch without a target, and never on Check now from idle", async () => {
    const any = watchOf("logs");
    any.start("open");
    expect(any.deciding.value).toBe(false);
    scope.stop();
    storeState.organizationData.isDataIngested = true;
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    w.start("check");
    expect(w.deciding.value).toBe(false);
    expect(w.state.value).toBe("waiting");
  });

  it("keeps checking when an org stream page answers without a list", async () => {
    const real = nameList.getMockImplementation()!;
    nameList.mockImplementation(async (...a) =>
      a[5] ? real(...a) : { data: { list: "unavailable" as never, total: 1 } },
    );
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.deciding.value).toBe(false);
    expect(w.state.value).toBe("waiting");
  });

  it("lifts the placeholder and keeps checking when the first decision throws", async () => {
    const real = nameList.getMockImplementation()!;
    nameList.mockImplementation(async (...a) =>
      a[5] ? { data: { list: {} as never, total: 1 } } : real(...a),
    );
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.deciding.value).toBe(false);
    expect(w.state.value).toBe("waiting");
    const before = keywordPageCalls("logs", "syslog_ng").length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(keywordPageCalls("logs", "syslog_ng").length).toBeGreaterThan(before);
  });
});

describe("useFirstEventWatch — engagement survives a reload", () => {
  const serverNowS = Math.floor(NOW / 1000);
  const reload = (
    opts: WatchOpts = { targetStream: "syslog_ng" },
    signal: StreamSignal = "logs",
  ) => {
    scope.stop();
    const w = watchOf(signal, opts);
    w.start("open");
    return w;
  };
  const engagedKeys = () =>
    Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i) ?? "").filter(
      (k) => k.startsWith("o2.firstEvent.engaged:"),
    );

  beforeEach(() => {
    storeState.organizationData.isDataIngested = true;
  });

  it("resumes a copied watch after a reload instead of holding, timed from the copy", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    const copiedAt = w.startedAtMs.value;
    await vi.advanceTimersByTimeAsync(30_000);
    const after = reload();
    expect(after.deciding.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("waiting");
    expect(after.startedAtMs.value).toBe(copiedAt);
    rows.logs = [{ name: "syslog_ng", stats: { doc_num: 4, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(after.state.value).toBe("received");
    expect(engagedKeys()).toHaveLength(0);
  });

  it("counts a target created between the copy and the reload as new data", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("check");
    await vi.advanceTimersByTimeAsync(10_000);
    scope.stop();
    rows.logs = [{ name: "syslog_ng", stats: { doc_num: 4, doc_time_min: NOW * 1000 } }];
    const after = watchOf("logs", { targetStream: "syslog_ng" });
    after.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("received");
    expect(after.scope.value).toBe("new-data");
  });

  it("keeps the server-clock anchor of an existing target across a reload", async () => {
    rows.logs = [{ name: "default", stats: { doc_num: 99, doc_time_min: 1 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = watchOf("logs", { targetStream: "default" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    await vi.advanceTimersByTimeAsync(10_000);
    const anchors = search.mock.calls.filter((c) => c[0].query.query.sql.includes("zo_now")).length;
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS + 600 }]);
    const after = reload({ targetStream: "default" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(after.state.value).toBe("waiting");
    expect(search.mock.calls.filter((c) => c[0].query.query.sql.includes("zo_now")).length).toBe(
      anchors,
    );
    expect(countCalls().at(-1)?.query.query.sql).toContain(
      `_timestamp >= ${serverNowS * 1_000_000}`,
    );
    expect(after.sinceUs.value).toBe(serverNowS * 1_000_000);
  });

  it("counts a keyword match created between the copy and the reload", async () => {
    rows.metrics = [{ name: "system_cpu", stats: { doc_num: 9, doc_time_min: 1 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const opts: WatchOpts = { targetStream: "system_", match: "keyword" };
    const w = watchOf("metrics", opts);
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    await vi.advanceTimersByTimeAsync(10_000);
    scope.stop();
    rows.metrics.push({ name: "system_mem", stats: { doc_num: 3, doc_time_min: NOW * 1000 } });
    const after = watchOf("metrics", opts);
    after.start("open");
    await vi.advanceTimersByTimeAsync(5000);
    expect(after.state.value).toBe("received");
    expect(after.result.value?.streamName).toBe("system_mem");
  });

  it("reads rejections 120 s after the original copy, not after the reload", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    await vi.advanceTimersByTimeAsync(100_000);
    recentRejections.mockClear();
    reload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recentRejections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(recentRejections).toHaveBeenCalled();
  });

  it("holds again after a reload once the copy is past the 60-minute budget", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    scope.stop();
    await vi.advanceTimersByTimeAsync(61 * 60_000);
    const after = watchOf("logs", { targetStream: "syslog_ng" });
    after.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("idle");
    expect(engagedKeys()).toHaveLength(0);
  });

  it("forgets the copy when the watch is stopped", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    w.stop();
    const after = reload();
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("idle");
  });

  it("forgets the copy when the org changes", async () => {
    const org = ref("acme");
    const w = watchOf("logs", { org, targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    org.value = "beta";
    await vi.advanceTimersByTimeAsync(1);
    const after = reload({ targetStream: "syslog_ng" });
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("idle");
  });

  it("forgets the copy when the bar remounts for another org", async () => {
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    reload({ org: ref("beta"), targetStream: "syslog_ng" });
    await vi.advanceTimersByTimeAsync(1);
    const after = reload();
    await vi.advanceTimersByTimeAsync(1);
    expect(after.state.value).toBe("idle");
  });

  it("forgets the previous target's copy on a target change, so switching back holds", async () => {
    const target = ref<string | undefined>("syslog_ng");
    const w = watchOf("logs", { targetStream: target });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    expect(engagedKeys()).toHaveLength(1);
    target.value = "nginx_access";
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(engagedKeys()).toHaveLength(0);
    target.value = "syslog_ng";
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
  });

  it.each([
    ["a non-numeric start", { at: "now" }],
    ["a target that is not an object", { at: NOW, target: "system_" }],
    ["a non-boolean existed", { at: NOW, target: { existed: "yes" } }],
    ["a non-numeric anchor", { at: NOW, target: { existed: true, zoNowUs: "x" } }],
    ["a baseline that is not a list", { at: NOW, target: { existed: true, baseline: 5 } }],
    ["a baseline holding a non-name", { at: NOW, target: { existed: true, baseline: ["a", 1] } }],
    ["matches that are not a list", { at: NOW, target: { existed: true, matches: "system_a" } }],
  ])("drops a stored copy with %s and holds instead of resuming", async (_label, record) => {
    const key =
      "o2.firstEvent.engaged:" + JSON.stringify(["acme", ["metrics"], true, "system_", ""]);
    sessionStorage.setItem(key, JSON.stringify(record));
    const w = watchOf("metrics", { targetStream: "system_", match: "keyword" });
    expect(() => w.start("open")).not.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(engagedKeys()).toHaveLength(0);
  });

  it("sweeps another org's copy past a malformed stored key", async () => {
    const beta = "o2.firstEvent.engaged:" + JSON.stringify(["beta", ["logs"], false, "x", ""]);
    sessionStorage.setItem(beta, JSON.stringify({ at: NOW }));
    sessionStorage.setItem("o2.firstEvent.engaged:5", JSON.stringify({ at: NOW }));
    const w = watchOf("logs", { targetStream: "syslog_ng" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(engagedKeys()).not.toContain(beta);
  });

  it("resumes a keyword watch without re-counting matches whose stats never moved", async () => {
    rows.metrics = ["m0", "m1", "m2", "m3"].map((n, i) => ({
      name: `system_${n}`,
      stats: { doc_num: 9, doc_time_min: 1, doc_time_max: 10 - i },
    }));
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const opts: WatchOpts = { targetStream: "system_", match: "keyword" };
    const w = watchOf("metrics", opts);
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    w.start("copy");
    await vi.advanceTimersByTimeAsync(1);
    const before = countCalls().length;
    reload(opts, "metrics");
    await vi.advanceTimersByTimeAsync(10_001);
    const counted = countCalls()
      .slice(before)
      .map((r) => /"(system_m\d)"/.exec(r.query.query.sql)?.[1]);
    expect(counted).toEqual([
      "system_m0",
      "system_m1",
      "system_m0",
      "system_m2",
      "system_m0",
      "system_m3",
    ]);
  });

  it("keeps today's behaviour when session storage throws", async () => {
    const fail = () => {
      throw new Error("SecurityError");
    };
    const spies = [
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(fail),
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(fail),
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(fail),
      vi.spyOn(Storage.prototype, "key").mockImplementation(fail),
    ];
    try {
      const w = watchOf("logs", { targetStream: "syslog_ng" });
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      expect(w.state.value).toBe("idle");
      w.start("copy");
      expect(w.state.value).toBe("waiting");
      await vi.advanceTimersByTimeAsync(5000);
      const after = reload();
      await vi.advanceTimersByTimeAsync(1);
      expect(after.state.value).toBe("idle");
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("useFirstEventWatch — handoff and configuration changes (F1, F5)", () => {
  it("refreshes the detected type's name list and the stream store before it reports the arrival", async () => {
    queryClient.setQueryData(streamKeys.nameList("acme", "logs"), []);
    let stateAtStoreUpdate: string | undefined;
    const w = watchOf("logs", { targetStream: "default" });
    dispatch.mockImplementation((type: string) => {
      if (type === "streams/setStreams") stateAtStoreUpdate = w.state.value;
    });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 3, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    const cached = queryClient.getQueryData<Array<{ name: string }>>(
      streamKeys.nameList("acme", "logs"),
    );
    expect(cached?.map((s) => s.name)).toEqual(["default"]);
    expect(dispatch).toHaveBeenCalledWith("streams/setStreams", {
      streamType: "logs",
      streams: expect.objectContaining({ list: [expect.objectContaining({ name: "default" })] }),
    });
    expect(stateAtStoreUpdate).toBe("waiting");
  });

  it("keeps a late stream list for the previous org out of the shared store", async () => {
    const org = ref("acme");
    const pending = deferred<{ data: { list: FakeRow[]; total: number } }>();
    const realNameList = nameList.getMockImplementation()!;
    nameList.mockImplementation(async (o, type, sch, offset = -1, limit = -1, keyword = "") =>
      o === "acme" && offset === -1
        ? pending.promise
        : realNameList(o, type, sch, offset, limit, keyword),
    );
    const w = watchOf("logs", { org, targetStream: "default" });
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 3, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(nameList.mock.calls.some((c) => c[0] === "acme" && c[3] === undefined)).toBe(true);
    storeState.selectedOrganization.identifier = "beta";
    org.value = "beta";
    pending.resolve({ data: { list: [{ name: "default", stream_type: "logs" }], total: 1 } });
    await vi.advanceTimersByTimeAsync(1);
    expect(dispatch).not.toHaveBeenCalledWith("streams/setStreams", expect.anything());
    expect(dispatch).not.toHaveBeenCalledWith("setIsDataIngested", expect.anything());
    expect(w.state.value).toBe("idle");
    expect(w.result.value).toBeUndefined();
  });

  it("drops an answer for the previous target once the target changed", async () => {
    const serverNowS = Math.floor(NOW / 1000);
    rows.logs = [{ name: "old", stats: { doc_num: 1, doc_time_min: 1 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const target = ref<string | undefined>("old");
    const w = watchOf("logs", { targetStream: target });
    w.start("check");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.scope.value).toBe("since-watch-start");
    const pending = deferred<{ data: { hits: Record<string, unknown>[] } }>();
    const realSearch = search.getMockImplementation()!;
    search.mockImplementation(async (req) =>
      req.query.query.sql.startsWith("SELECT COUNT") && req.query.query.sql.includes('"old"')
        ? pending.promise
        : realSearch(req),
    );
    await vi.advanceTimersByTimeAsync(5000);
    target.value = "new";
    pending.resolve({ data: { hits: [{ zo_count: 5, zo_min: serverNowS * 1_000_000 }] } });
    await vi.advanceTimersByTimeAsync(1);
    expect(w.state.value).toBe("idle");
    expect(w.result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.state.value).toBe("idle");
    expect(w.scope.value).toBe("new-data");
  });
});

describe("useFirstEventWatch — diagnosis", () => {
  it("reads recent rejections at 120 s without a click and names the newest cause", async () => {
    recentRejections.mockResolvedValue({
      data: {
        tracked: true,
        list: [
          { first_seen: 1, status: 401, reason: "invalid_credentials", path: "/api/acme/x/_json" },
          { first_seen: 2, status: 413, reason: "batch_too_large", path: "/api/acme/x/_json" },
        ],
      },
    });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(115_000);
    expect(recentRejections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(recentRejections).toHaveBeenCalledTimes(1);
    expect(w.state.value).toBe("rejected");
    expect(w.diagnosis.value).toMatchObject({ form: "rejected", trigger: "auto" });
    expect(w.diagnosis.value?.rejections.map((r) => [r.reason, r.firstSeen])).toEqual([
      ["batch_too_large", 2],
      ["invalid_credentials", 1],
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recentRejections).toHaveBeenCalledTimes(2);
  });

  it("keeps the new-stream baseline on Troubleshoot and a copy, so a stream that already landed counts", async () => {
    const w = watchOf(undefined);
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs.push({ name: "default", stats: { doc_num: 1, doc_time_min: NOW * 1000 } });
    await w.troubleshoot();
    w.start("copy");
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(w.result.value?.streamName).toBe("default");
  });

  it("keeps a target's server-clock anchor on Troubleshoot", async () => {
    const serverNowS = Math.floor(NOW / 1000);
    rows.logs = [{ name: "default", stats: { doc_num: 0, doc_time_min: 0 } }];
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS }]);
    const w = watchOf("logs", { targetStream: "default" });
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.sinceUs.value).toBe(serverNowS * 1_000_000);
    anchorHits.mockReturnValue([{ zo_count: 0, zo_now: serverNowS + 60 }]);
    await vi.advanceTimersByTimeAsync(60_000);
    await w.troubleshoot();
    expect(w.sinceUs.value).toBe(serverNowS * 1_000_000);
    countHits.mockReturnValue([{ zo_count: 1, zo_min: serverNowS * 1_000_000 + 5 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.result.value).toMatchObject({ count: 1, sinceUs: serverNowS * 1_000_000 });
  });

  it("diagnoses at once on Troubleshoot and keeps polling", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    expect(w.state.value).toBe("no-requests");
    expect(w.diagnosis.value).toMatchObject({ form: "no-requests", trigger: "troubleshoot" });
    const before = probeCalls();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probeCalls()).toBeGreaterThan(before);
  });

  it.each([403, 404, 503])(
    "keeps a failed automatic read silent on %s and retries it",
    async (status) => {
      recentRejections.mockRejectedValue({ response: { status } });
      const w = watchOf("logs");
      w.start("open");
      await vi.advanceTimersByTimeAsync(120_000);
      expect(recentRejections).toHaveBeenCalledTimes(1);
      expect(w.state.value).toBe("waiting");
      expect(w.diagnosis.value).toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(recentRejections).toHaveBeenCalledTimes(2);
    },
  );

  it("opens the unavailable form after a failed Troubleshoot, then a later answer replaces it", async () => {
    recentRejections.mockRejectedValueOnce({ response: { status: 403 } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toMatchObject({ form: "unavailable", trigger: "troubleshoot" });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(w.state.value).toBe("no-requests");
    expect(w.diagnosis.value?.trigger).toBe("troubleshoot");
  });

  it("keeps the automatic read silent when the org is untracked, and never repeats it", async () => {
    recentRejections.mockResolvedValue({ data: { tracked: false, list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(recentRejections).toHaveBeenCalledTimes(1);
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(4 * 30_000);
    expect(recentRejections).toHaveBeenCalledTimes(1);
    expect(w.state.value).toBe("waiting");
  });

  it("after an untracked answer reads again only on Troubleshoot or a restart", async () => {
    recentRejections.mockResolvedValue({ data: { tracked: false, list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(recentRejections).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 30_000);
    expect(recentRejections).toHaveBeenCalledTimes(1);
    await w.troubleshoot();
    expect(recentRejections).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 30_000);
    expect(recentRejections).toHaveBeenCalledTimes(2);
    w.start("copy");
    await vi.advanceTimersByTimeAsync(35_000);
    expect(recentRejections).toHaveBeenCalledTimes(3);
  });

  it("opens the unavailable form, never no-requests, on Troubleshoot in an untracked org", async () => {
    recentRejections.mockResolvedValue({ data: { tracked: false, list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toMatchObject({ form: "unavailable", trigger: "troubleshoot" });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value?.form).toBe("unavailable");
  });

  it("returns a rejected bar to waiting and drops the cause when the org turns untracked", async () => {
    recentRejections.mockResolvedValueOnce({
      data: {
        tracked: true,
        list: [{ first_seen: 1, status: 401, reason: "invalid_credentials", path: "/api/x" }],
      },
    });
    recentRejections.mockResolvedValue({ data: { tracked: false, list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(w.state.value).toBe("rejected");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recentRejections).toHaveBeenCalledTimes(2);
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toBeUndefined();
    await w.troubleshoot();
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toMatchObject({ form: "unavailable", trigger: "troubleshoot" });
  });

  it("returns a no-requests bar to waiting and drops the diagnosis when the org turns untracked", async () => {
    recentRejections.mockResolvedValueOnce({ data: { tracked: true, list: [] } });
    recentRejections.mockResolvedValue({ data: { tracked: false, list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    expect(w.state.value).toBe("no-requests");
    await vi.advanceTimersByTimeAsync(35_000);
    expect(recentRejections).toHaveBeenCalledTimes(2);
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toBeUndefined();
  });

  it("keeps a named cause when a later read fails, since a failure says nothing new", async () => {
    recentRejections.mockResolvedValueOnce({ data: { tracked: true, list: [] } });
    recentRejections.mockRejectedValue({ response: { status: 503 } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(recentRejections).toHaveBeenCalledTimes(2);
    expect(w.state.value).toBe("no-requests");
    expect(w.diagnosis.value?.form).toBe("no-requests");
  });

  it("reads an answer without tracked as tracked", async () => {
    recentRejections.mockResolvedValue({ data: { list: [] } });
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    await w.troubleshoot();
    expect(w.state.value).toBe("no-requests");
  });

  it.each(["open", "copy"] as const)(
    "restarts the whole watch after the stop on %s: no diagnosis before 120 s again",
    async (reason) => {
      const w = watchOf("logs");
      w.start("open");
      await vi.advanceTimersByTimeAsync(1);
      await w.troubleshoot();
      expect(w.diagnosis.value?.trigger).toBe("troubleshoot");
      await vi.advanceTimersByTimeAsync(HOUR);
      expect(w.state.value).toBe("stopped");
      recentRejections.mockClear();

      w.start(reason);
      await vi.advanceTimersByTimeAsync(115_000);
      expect(recentRejections).not.toHaveBeenCalled();
      expect(w.state.value).toBe("waiting");
      expect(w.diagnosis.value).toBeUndefined();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(recentRejections).toHaveBeenCalledTimes(1);
      expect(w.state.value).toBe("no-requests");
      expect(w.diagnosis.value).toMatchObject({ form: "no-requests", trigger: "auto" });
    },
  );

  it("never reads recent rejections on its own with autoDiagnosis off (pill display)", async () => {
    const w = watchOf("logs", { autoDiagnosis: false });
    w.start("open");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(recentRejections).not.toHaveBeenCalled();
    expect(w.state.value).toBe("waiting");
    expect(w.diagnosis.value).toBeUndefined();
    expect(probeCalls()).toBeGreaterThan(100);
  });

  it("stops every request once data is received", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 1, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    const calls = nameList.mock.calls.length + search.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(nameList.mock.calls.length + search.mock.calls.length).toBe(calls);
    expect(recentRejections).not.toHaveBeenCalled();
  });

  it("marks the detection seen, and the stream it saw, so the next-visit banner never repeats it", async () => {
    const w = watchOf("logs");
    w.start("open");
    await vi.advanceTimersByTimeAsync(1);
    rows.logs = [{ name: "default", stats: { doc_num: 1, doc_time_min: NOW * 1000 } }];
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.state.value).toBe("received");
    expect(JSON.parse(localStorage.getItem("o2.onboarding.firstData.acme")!)).toMatchObject({
      seenDetection: true,
      detectedStream: { type: "logs", name: "default" },
    });
  });
});
