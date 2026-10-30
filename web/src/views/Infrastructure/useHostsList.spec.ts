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

// The Hosts-list data plane (design 4.8/§6): 6 instant queries + 1 SQL last-seen joined on host_name.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { useHostsList, utilizationTint } from "./useHostsList";
import searchService from "@/services/search";
import { timestampToTimezoneDate } from "@/utils/timezone";

vi.mock("@/services/search", () => ({
  default: { metrics_query: vi.fn(), search: vi.fn() },
}));

vi.mock("@/utils/timezone", () => ({
  timestampToTimezoneDate: vi.fn((ts: number, tz: string) => `TZ:${ts}:${tz}`),
}));

const metricsQueryMock = vi.mocked(searchService.metrics_query);
const searchMock = vi.mocked(searchService.search);

const PICKER = { start: 1_700_000_000_000_000, end: 1_700_000_900_000_000 };

const vector = (rows: Array<{ metric: Record<string, string>; value: number }>) =>
  ({
    data: {
      status: "success",
      data: {
        resultType: "vector",
        result: rows.map((r) => ({ metric: r.metric, value: [1700000900, String(r.value)] })),
      },
    },
  }) as any;

const sqlHits = (
  rows: Array<{
    host_name: string;
    last_seen: number;
    first_seen?: number;
    k8s_node_name?: string;
  }>,
) => ({ data: { hits: rows } }) as any;

type FleetResponses = Partial<{
  liveness: any;
  cpu: any;
  memUtilization: any;
  memUsage: any;
  disk: any;
  load: any;
  cores: any;
  lastSeen: any;
}>;

const MEMORY_STATES = [
  "used",
  "free",
  "cached",
  "buffered",
  "slab_reclaimable",
  "slab_unreclaimable",
] as const;

// Shape of a real host (live fleet): `used` overlaps slab and cache, so the six
// ratios sum ABOVE 1.0 and a sum-of-states denominator over-counts. A fixture whose
// states summed to exactly 1.0 cannot tell the two formulas apart.
const NON_USED_RATIOS: Record<string, number> = {
  free: 0.174356,
  cached: 0.26811,
  buffered: 0.031671,
  slab_reclaimable: 0.020617,
  slab_unreclaimable: 0.008239,
};

/** The per-state vectors the collector really emits: one MemTotal, ratio(state, MemTotal). */
const memoryFixture = (
  hosts: Array<{ host_name: string; total: number; usedFraction: number }>,
) => {
  const utilization: Array<{ metric: Record<string, string>; value: number }> = [];
  const usage: typeof utilization = [];
  for (const { host_name, total, usedFraction } of hosts) {
    for (const state of MEMORY_STATES) {
      const ratio = state === "used" ? usedFraction : NON_USED_RATIOS[state];
      utilization.push({ metric: { host_name, state }, value: ratio });
      // Every state's bytes come from the SAME MemTotal, exactly as the collector computes them.
      usage.push({ metric: { host_name, state }, value: ratio * total });
    }
  }
  return { utilization: vector(utilization), usage: vector(usage) };
};

/** What a sum-of-states denominator would report — the degraded fallback figure. */
const fallbackPct = (usedFraction: number) => {
  const sum = usedFraction + Object.values(NON_USED_RATIOS).reduce((a, b) => a + b, 0);
  return (usedFraction / sum) * 100;
};

const DEFAULT_MEMORY = memoryFixture([
  { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.5 },
  { host_name: "web-02", total: 16_000_000_000, usedFraction: 0.25 },
]);

/** Uniform memory for a bulk host list, keyed to primeFleet's field names. */
const memoryFixtureFor = (rows: Array<{ metric: Record<string, string> }>) => {
  const fixture = memoryFixture(
    rows.map((r) => ({ host_name: r.metric.host_name, total: 100, usedFraction: 0.1 })),
  );
  return { memUtilization: fixture.utilization, memUsage: fixture.usage };
};

// Routes each fan-out call by its DECODED query, so response wiring is order-independent.
function primeFleet(overrides: FleetResponses = {}) {
  const r: Required<FleetResponses> = {
    liveness: vector([
      { metric: { host_name: "web-01", os_type: "linux" }, value: 1 },
      { metric: { host_name: "web-02" }, value: 1 },
    ]),
    cpu: vector([
      { metric: { host_name: "web-01" }, value: 95 },
      { metric: { host_name: "web-02" }, value: 42 },
    ]),
    memUtilization: DEFAULT_MEMORY.utilization,
    memUsage: DEFAULT_MEMORY.usage,
    disk: vector([
      { metric: { host_name: "web-01" }, value: 91 },
      { metric: { host_name: "web-02" }, value: 30 },
    ]),
    load: vector([
      { metric: { host_name: "web-01" }, value: 1.5 },
      { metric: { host_name: "web-02" }, value: 0.4 },
    ]),
    cores: vector([
      { metric: { host_name: "web-01" }, value: 4 },
      { metric: { host_name: "web-02" }, value: 2 },
    ]),
    lastSeen: sqlHits([
      { host_name: "web-01", last_seen: 1_700_000_890_000_000 },
      { host_name: "web-02", last_seen: 1_700_000_880_000_000 },
      { host_name: "db-01", last_seen: 1_700_000_100_000_000 },
    ]),
    ...overrides,
  };

  metricsQueryMock.mockImplementation((args: any) => {
    const q = decodeURIComponent(args.query);
    const pick = () => {
      if (q.includes("last_over_time")) return r.liveness;
      // Cores also reads system_cpu_time, so it must be matched before the CPU % shape.
      if (q.includes("count by (host_name, cpu)")) return r.cores;
      if (q.includes("system_cpu_time")) return r.cpu;
      if (q.includes("system_filesystem_usage")) return r.disk;
      if (q.includes("system_memory_utilization")) return r.memUtilization;
      if (q.includes("system_memory_usage")) return r.memUsage;
      if (q.includes("system_cpu_load_average_15m")) return r.load;
      return vector([]);
    };
    const res = pick();
    return res instanceof Error ? Promise.reject(res) : Promise.resolve(res);
  });
  searchMock.mockImplementation(() =>
    r.lastSeen instanceof Error ? Promise.reject(r.lastSeen) : Promise.resolve(r.lastSeen),
  );
}

function withHostsList() {
  const store = createStore({
    state: {
      timezone: "America/Los_Angeles",
      selectedOrganization: { identifier: "test-org" },
    },
  });
  let list!: ReturnType<typeof useHostsList>;
  const wrapper = mount(
    defineComponent({
      setup() {
        list = useHostsList();
        return () => null;
      },
    }),
    { global: { plugins: [store] } },
  );
  return { list, wrapper };
}

const refreshArgs = { orgId: "test-org", start: PICKER.start, end: PICKER.end };
const rowByName = (list: any, name: string) =>
  list.rows.value.find((row: any) => row.host_name === name);

describe("useHostsList — join & window anchoring", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("joins the 6 instant vectors and the SQL last-seen on host_name", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value).toHaveLength(3);
    const web01 = rowByName(h.list, "web-01");
    expect(web01.status).toBe("ACTIVE");
    expect(web01.cpu).toBe(95);
    expect(web01.disk).toBe(91);
    expect(web01.load).toBe(1.5);
  });

  it("blanks a cell whose sample is Prometheus 'NaN' (0/0) instead of rendering NaN", async () => {
    primeFleet({
      cpu: vector([
        { metric: { host_name: "web-01" }, value: NaN },
        { metric: { host_name: "web-02" }, value: 42 },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(rowByName(h.list, "web-01").cpu).toBeNull();
    expect(rowByName(h.list, "web-02").cpu).toBe(42);
  });

  it("derives fleetCount from the joined rows (N total, M ACTIVE)", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    // web-01/web-02 are ACTIVE from liveness; db-01 is SQL-only ⇒ INACTIVE.
    expect(h.list.fleetCount.value).toEqual({ total: 3, active: 2 });
  });

  it("anchors the SQL window to the picker [start, end] and liveness to the picker end", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const sqlArgs: any = searchMock.mock.calls[0][0];
    // No fixed 24h anywhere: widening the picker must reach older hosts.
    expect(sqlArgs.query.query.start_time).toBe(PICKER.start);
    expect(sqlArgs.query.query.end_time).toBe(PICKER.end);
    for (const call of metricsQueryMock.mock.calls) {
      expect((call[0] as any).end_time).toBe(PICKER.end);
    }
  });

  it("renders a host present in SQL but absent from liveness as INACTIVE with formatted last-seen", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const db01 = rowByName(h.list, "db-01");
    expect(db01.status).toBe("INACTIVE");
    // Timezone-aware formatter with the store timezone — never browser-local.
    expect(timestampToTimezoneDate).toHaveBeenCalledWith(
      expect.anything(),
      "America/Los_Angeles",
      expect.anything(),
    );
    expect(db01.lastSeen).toMatch(/^TZ:.*:America\/Los_Angeles$/);
  });

  // The curated drawer badges off the row's OWN last-seen, not the fleet-wide
  // stream doc_time_max — a dead host behind a live fleet must still badge
  // (curated-pages design §5.3/§7.3). The raw µs was fetched and then discarded.
  it("carries the raw µs last-seen in lastSeenUs ALONGSIDE the formatted string", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const db01 = rowByName(h.list, "db-01");
    expect(db01.lastSeenUs).toBe(1_700_000_100_000_000);
    // Both, off one row — the formatted string is not replaced by the raw value.
    expect(db01.lastSeen).toMatch(/^TZ:.*:America\/Los_Angeles$/);
    expect(rowByName(h.list, "web-01").lastSeenUs).toBe(1_700_000_890_000_000);
  });

  // A window-bounded min(_timestamp) reports the window floor, not the host's first
  // sample, so no row may carry a first-seen for anything to date a banner off.
  it("carries no first-seen, which the window-bounded aggregate cannot know", async () => {
    primeFleet({
      lastSeen: sqlHits([
        {
          host_name: "web-01",
          last_seen: 1_700_000_890_000_000,
          first_seen: 1_700_000_600_000_000,
        },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(rowByName(h.list, "web-01")).not.toHaveProperty("firstSeenUs");
  });

  it("a host with no last-seen hit blanks BOTH lastSeen and lastSeenUs", async () => {
    primeFleet({ lastSeen: sqlHits([{ host_name: "web-01", last_seen: 1_700_000_890_000_000 }]) });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const web02 = rowByName(h.list, "web-02");
    expect(web02.lastSeen).toBeNull();
    expect(web02.lastSeenUs).toBeNull();
  });

  it("encodes every PromQL string passed to metrics_query", async () => {
    // metrics_query interpolates query=${query} RAW into the URL (search.ts).
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(metricsQueryMock).toHaveBeenCalledTimes(7);
    for (const call of metricsQueryMock.mock.calls) {
      const raw = (call[0] as any).query as string;
      const decoded = decodeURIComponent(raw);
      // Canonical round-trip: partial encoders (spaces-only, brace-only) fail this.
      expect(raw).toBe(encodeURIComponent(decoded));
      expect(raw).not.toContain("{");
      if (decoded.includes("[")) expect(raw).not.toContain("[");
    }
  });

  it("displays the node name, falling back to the series key off-cluster", async () => {
    primeFleet({
      liveness: vector([
        {
          metric: { host_name: "web-01", os_type: "linux", k8s_node_name: "ip-10-1-4-86" },
          value: 1,
        },
        { metric: { host_name: "web-02", os_type: "linux" }, value: 1 },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const onCluster = rowByName(h.list, "web-01");
    expect(onCluster.k8s_node_name).toBe("ip-10-1-4-86");
    expect(onCluster.display_name).toBe("ip-10-1-4-86");
    // host_name stays the series key: every panel query still filters on it.
    expect(onCluster.host_name).toBe("web-01");
    const offCluster = rowByName(h.list, "web-02");
    expect(offCluster.k8s_node_name).toBeNull();
    expect(offCluster.display_name).toBe("web-02");
  });

  it("adding k8s_node_name to the liveness grouping must not split one host into two rows", async () => {
    primeFleet({
      liveness: vector([
        { metric: { host_name: "web-01", k8s_node_name: "node-a" }, value: 1 },
        { metric: { host_name: "web-01", os_type: "linux", k8s_node_name: "node-a" }, value: 1 },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value.filter((r: any) => r.host_name === "web-01")).toHaveLength(1);
    expect(rowByName(h.list, "web-01").k8s_node_name).toBe("node-a");
  });

  it("names INACTIVE hosts by their node, which liveness never covers", async () => {
    // k8s_node_name rode liveness alone, so every dead host — the ones an operator
    // is actually hunting — displayed the collector's pod name instead.
    primeFleet({
      liveness: vector([{ metric: { host_name: "web-01", os_type: "linux" }, value: 1 }]),
      lastSeen: sqlHits([
        { host_name: "web-01", last_seen: 1_700_000_890_000_000, k8s_node_name: "node-live" },
        { host_name: "dead-01", last_seen: 1_700_000_100_000_000, k8s_node_name: "node-dead" },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const dead = rowByName(h.list, "dead-01");
    expect(dead.status).toBe("INACTIVE");
    expect(dead.display_name).toBe("node-dead");
    // The series key is untouched: the drawer and every panel still query by it.
    expect(dead.host_name).toBe("dead-01");
  });

  it("prefers the liveness node when both sources carry one", async () => {
    primeFleet({
      liveness: vector([
        { metric: { host_name: "web-01", os_type: "linux", k8s_node_name: "node-live" }, value: 1 },
      ]),
      lastSeen: sqlHits([
        { host_name: "web-01", last_seen: 1_700_000_890_000_000, k8s_node_name: "node-stale" },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(rowByName(h.list, "web-01").display_name).toBe("node-live");
  });

  it("collapses a host that mapped to two nodes, keeping the most recent one", async () => {
    // GROUP BY host_name, k8s_node_name can emit a row per node; the row count must
    // not grow, and the node shown must be the one from the latest sample.
    primeFleet({
      liveness: vector([]),
      lastSeen: sqlHits([
        { host_name: "roamer", last_seen: 1_700_000_100_000_000, k8s_node_name: "node-old" },
        { host_name: "roamer", last_seen: 1_700_000_890_000_000, k8s_node_name: "node-new" },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value.filter((r: any) => r.host_name === "roamer")).toHaveLength(1);
    const row = rowByName(h.list, "roamer");
    expect(row.display_name).toBe("node-new");
    expect(row.lastSeenUs).toBe(1_700_000_890_000_000);
  });

  it("keeps the most recent last_seen regardless of the order rows arrive in", async () => {
    primeFleet({
      liveness: vector([]),
      lastSeen: sqlHits([
        { host_name: "roamer", last_seen: 1_700_000_890_000_000, k8s_node_name: "node-new" },
        { host_name: "roamer", last_seen: 1_700_000_100_000_000, k8s_node_name: "node-old" },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const row = rowByName(h.list, "roamer");
    expect(row.display_name).toBe("node-new");
    expect(row.lastSeenUs).toBe(1_700_000_890_000_000);
  });

  it("guards the ROW SOURCES too, so the row set and the value columns agree", async () => {
    // Row membership is liveness union last-seen. An unguarded row source lets a
    // non-hostmetrics producer conjure a row whose every value column is blank.
    const GUARD = 'instrumentation_library_name!~".*instrumentation.system_metrics.*"';
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const promql = metricsQueryMock.mock.calls.map((c: any) => decodeURIComponent(c[0].query));
    expect(promql.length).toBeGreaterThan(0);
    for (const q of promql) expect(q, q).toContain(GUARD);
    const sql: string = (searchMock.mock.calls[0][0] as any).query.query.sql;
    expect(sql).toContain("instrumentation_library_name IS NULL");
    expect(sql).toContain("NOT LIKE '%instrumentation.system_metrics%'");
  });

  it("reduces duplicate liveness entries to one row per host with the first non-empty os_type", async () => {
    primeFleet({
      liveness: vector([
        { metric: { host_name: "web-01" }, value: 1 },
        { metric: { host_name: "web-01", os_type: "linux" }, value: 1 },
        { metric: { host_name: "web-02" }, value: 1 },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value.filter((r: any) => r.host_name === "web-01")).toHaveLength(1);
    expect(rowByName(h.list, "web-01").os_type).toBe("linux");
    expect(rowByName(h.list, "web-02").os_type).toBeNull();
  });
});

describe("useHostsList — memory reads OTel's own utilization gauge", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const loadRows = async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    return h.list;
  };

  it("takes the % straight from utilization{used}, never from a sum of states", async () => {
    // The collector ratios every state against ONE MemTotal; `used` already absorbs
    // reclaimable cache, so a sum-of-states denominator double-counts it.
    const fixture = memoryFixture([
      { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.37 },
    ]);
    primeFleet({ memUtilization: fixture.utilization, memUsage: fixture.usage });
    const h = await loadRows();
    expect(rowByName(h, "web-01").memoryPct).toBeCloseTo(37, 6);
    // The two formulas must genuinely disagree here, or this proves nothing.
    expect(fallbackPct(0.37)).not.toBeCloseTo(37, 1);
    expect(rowByName(h, "web-01").memoryPct).not.toBeCloseTo(fallbackPct(0.37), 1);
  });

  it("reports the real byte pair from usage and the utilization-derived MemTotal", async () => {
    const h = await loadRows();
    const web01 = rowByName(h, "web-01");
    expect(web01.memoryUsedBytes).toBe(8_000_000_000);
    expect(web01.memoryTotalBytes).toBeCloseTo(16_000_000_000, 0);
  });

  // usage{s}/utilization{s} is a MemTotal estimate per state; states are scraped
  // separately, so one skewed state must not move the reported total.
  it("takes the MEDIAN MemTotal across states, rejecting a single skewed scrape", async () => {
    const fixture = memoryFixture([
      { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.5 },
    ]);
    // Halve only `used`'s bytes: its own estimate drops to 8e9, the other five hold 16e9.
    const usage = fixture.usage.data.data.result;
    const used = usage.find((r: any) => r.metric.state === "used");
    used.value = [used.value[0], String(Number(used.value[1]) / 2)];
    primeFleet({ memUtilization: fixture.utilization, memUsage: fixture.usage });
    const h = await loadRows();
    const web01 = rowByName(h, "web-01");
    expect(web01.memoryTotalBytes).toBeCloseTo(16_000_000_000, 0);
    // A mean, or a single-`used` divide, would have landed near 8e9 here.
    expect(web01.memoryTotalBytes).toBeGreaterThan(12_000_000_000);
  });

  // A zeroed state divides to Infinity. With enough of them the median lands ON an
  // Infinity, so the guard must DROP those estimates rather than rank them.
  it("skips every state whose utilization is zero rather than dividing by it", async () => {
    const fixture = memoryFixture([
      { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.5 },
    ]);
    const zeroed = ["buffered", "slab_reclaimable", "slab_unreclaimable", "cached"];
    for (const r of fixture.utilization.data.data.result) {
      if (zeroed.includes(r.metric.state)) r.value = [r.value[0], "0"];
    }
    primeFleet({ memUtilization: fixture.utilization, memUsage: fixture.usage });
    const h = await loadRows();
    const total = rowByName(h, "web-01").memoryTotalBytes;
    expect(Number.isFinite(total)).toBe(true);
    // Only `used` and `free` still carry a usable ratio, and both say 16e9.
    expect(total).toBeCloseTo(16_000_000_000, 0);
  });

  describe("fallback when the opt-in utilization gauge is absent", () => {
    // system.memory.utilization is `enabled: false` upstream, so a stock collector
    // emits only system.memory.usage and the column would otherwise go blank.
    const stockCollector = (usedFraction: number, total = 16_000_000_000) => {
      const fixture = memoryFixture([{ host_name: "web-01", total, usedFraction }]);
      return { memUtilization: vector([]), memUsage: fixture.usage };
    };

    it("still reports a % from the usage states alone", async () => {
      primeFleet(stockCollector(0.5));
      const h = await loadRows();
      const web01 = rowByName(h, "web-01");
      // The degraded figure, not the primary 50 — this path cannot know MemTotal.
      expect(web01.memoryPct).toBeCloseTo(fallbackPct(0.5), 6);
      expect(web01.memoryPct).not.toBeNull();
    });

    it("keeps the % and the byte pair on the SAME source — both degraded, never mixed", async () => {
      primeFleet(stockCollector(0.5));
      const h = await loadRows();
      const web01 = rowByName(h, "web-01");
      // The sum-of-states total IS the fallback denominator, so % === used/total exactly.
      expect(web01.memoryPct).toBeCloseTo(
        (web01.memoryUsedBytes / web01.memoryTotalBytes) * 100,
        6,
      );
      // It over-counts the true 16e9 — that is the cost of the degraded path, and the
      // tooltip must show the SAME inflated total the % was computed against.
      expect(web01.memoryTotalBytes).toBeGreaterThan(16_000_000_000);
    });

    it("falls back per host, so a mixed fleet keeps the primary where it exists", async () => {
      const primary = memoryFixture([
        { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.8 },
      ]);
      const both = memoryFixture([
        { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.8 },
        { host_name: "web-02", total: 8_000_000_000, usedFraction: 0.25 },
      ]);
      primeFleet({ memUtilization: primary.utilization, memUsage: both.usage });
      const h = await loadRows();
      expect(rowByName(h, "web-01").memoryPct).toBeCloseTo(80, 6);
      // web-02 has no utilization series at all and must still read a value.
      expect(rowByName(h, "web-02").memoryPct).toBeCloseTo(fallbackPct(0.25), 6);
    });

    it("survives the utilization query REJECTING, not merely returning empty", async () => {
      const fixture = memoryFixture([
        { host_name: "web-01", total: 16_000_000_000, usedFraction: 0.5 },
      ]);
      primeFleet({
        memUtilization: new Error("utilization down") as any,
        memUsage: fixture.usage,
      });
      const h = await loadRows();
      expect(rowByName(h, "web-01").memoryPct).toBeCloseTo(fallbackPct(0.5), 6);
    });
  });

  it("blanks the memory column when usage — the only non-optional metric — is gone", async () => {
    primeFleet({
      memUtilization: new Error("boom") as any,
      memUsage: new Error("boom") as any,
    });
    const h = await loadRows();
    for (const row of h.rows.value) {
      expect(row.memoryPct).toBeNull();
      expect(row.memoryUsedBytes).toBeNull();
      expect(row.memoryTotalBytes).toBeNull();
    }
  });
});

describe("useHostsList — load is raw, ranked per-core", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  const loadRows = async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    return h.list;
  };

  // system.cpu.load_average.15m has unit {thread} — an absolute count. Rewriting it
  // as a ratio would contradict what `uptime` prints on the host itself.
  it("keeps load RAW, and exposes the per-core figure as a separate value", async () => {
    const h = await loadRows();
    const web01 = rowByName(h, "web-01");
    expect(web01.load).toBe(1.5);
    expect(web01.cores).toBe(4);
    expect(web01.loadPerCore).toBeCloseTo(0.375, 6);
  });

  it("carries the core count for the Cores column", async () => {
    const h = await loadRows();
    expect(rowByName(h, "web-02").cores).toBe(2);
    // A host the cores query never covered must still be a row, with a blank count.
    expect(rowByName(h, "db-01").cores).toBeNull();
  });

  it("keeps a host whose cores never resolved, blanking only the per-core figure", async () => {
    primeFleet({ cores: vector([{ metric: { host_name: "web-01" }, value: 4 }]) });
    const h = await loadRows();
    const web02 = rowByName(h, "web-02");
    expect(web02).toBeDefined();
    expect(web02.load).toBe(0.4);
    expect(web02.cores).toBeNull();
    expect(web02.loadPerCore).toBeNull();
  });

  it("ranks the Load column by load/cores, not by the raw count", async () => {
    // A 2-core box at 4.0 (2.0/core) is saturated; an 8-core box at 6.0 (0.75/core) is fine.
    primeFleet({
      liveness: vector([
        { metric: { host_name: "big" }, value: 1 },
        { metric: { host_name: "small" }, value: 1 },
      ]),
      load: vector([
        { metric: { host_name: "big" }, value: 6 },
        { metric: { host_name: "small" }, value: 4 },
      ]),
      cores: vector([
        { metric: { host_name: "big" }, value: 8 },
        { metric: { host_name: "small" }, value: 2 },
      ]),
      lastSeen: sqlHits([]),
    });
    const h = await loadRows();
    h.sortBy.value = "load";
    h.sortDesc.value = true;
    await flushPromises();
    expect(h.filteredRows.value.map((r: any) => r.host_name)).toEqual(["small", "big"]);
    // Sorting must not have rewritten the displayed value.
    expect(rowByName(h, "big").load).toBe(6);
  });

  it("ranks a host with no core count by its raw load", async () => {
    primeFleet({
      liveness: vector([
        { metric: { host_name: "known" }, value: 1 },
        { metric: { host_name: "unknown-cores" }, value: 1 },
      ]),
      load: vector([
        { metric: { host_name: "known" }, value: 4 },
        { metric: { host_name: "unknown-cores" }, value: 9 },
      ]),
      cores: vector([{ metric: { host_name: "known" }, value: 8 }]),
      lastSeen: sqlHits([]),
    });
    const h = await loadRows();
    h.sortBy.value = "load";
    h.sortDesc.value = true;
    await flushPromises();
    // 9 raw beats 0.5/core, and the row is never dropped for missing cores.
    expect(h.filteredRows.value.map((r: any) => r.host_name)).toEqual(["unknown-cores", "known"]);
  });

  // The loadscraper's cpu_average option makes the COLLECTOR divide by cores under
  // the same metric name; dividing again would report a fraction of a fraction.
  describe("double-normalization guard", () => {
    const normalizedFleet = (loads: Record<string, number>) =>
      primeFleet({
        liveness: vector(Object.keys(loads).map((h) => ({ metric: { host_name: h }, value: 1 }))),
        load: vector(
          Object.entries(loads).map(([h, v]) => ({ metric: { host_name: h }, value: v })),
        ),
        cores: vector(Object.keys(loads).map((h) => ({ metric: { host_name: h }, value: 4 }))),
        lastSeen: sqlHits([]),
      });

    it("suppresses the per-core figure when NO host exceeds 1.0", async () => {
      normalizedFleet({ "node-a": 0.9, "node-b": 0.2 });
      const h = await loadRows();
      for (const row of h.rows.value) {
        expect(row.loadPerCore).toBeNull();
        // The raw reading and the core count are still reported.
        expect(row.cores).toBe(4);
      }
      expect(rowByName(h, "node-a").load).toBe(0.9);
    });

    it("sorts on the raw load once the guard has suppressed per-core", async () => {
      normalizedFleet({ "node-a": 0.9, "node-b": 0.2 });
      const h = await loadRows();
      h.sortBy.value = "load";
      h.sortDesc.value = true;
      await flushPromises();
      expect(h.filteredRows.value.map((r: any) => r.host_name)).toEqual(["node-a", "node-b"]);
    });

    it("keeps per-core the moment ONE host reports a raw load above 1.0", async () => {
      normalizedFleet({ "node-a": 0.9, "node-b": 1.2 });
      const h = await loadRows();
      expect(rowByName(h, "node-a").loadPerCore).toBeCloseTo(0.225, 6);
      expect(rowByName(h, "node-b").loadPerCore).toBeCloseTo(0.3, 6);
    });
  });
});

describe("useHostsList — tri-state status & failure isolation", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("liveness rejected + SQL ok ⇒ every row UNKNOWN with the liveness banner, never INACTIVE", async () => {
    primeFleet({ liveness: new Error("liveness down") as any });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value.length).toBeGreaterThan(0);
    for (const row of h.list.rows.value) {
      // INACTIVE here would read as a false "fleet down".
      expect(row.status).toBe("UNKNOWN");
    }
    expect(h.list.banners.value.liveness).toBe(true);
  });

  it("SQL rejected + liveness ok ⇒ ACTIVE rows render, last-seen dashes, lastSeen banner", async () => {
    primeFleet({ lastSeen: new Error("sql down") as any });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const active = h.list.rows.value.filter((r: any) => r.status === "ACTIVE");
    expect(active.length).toBeGreaterThan(0);
    for (const row of h.list.rows.value) {
      expect(row.lastSeen).toBeNull();
      expect(row.lastSeenUs).toBeNull();
    }
    expect(h.list.banners.value.lastSeen).toBe(true);
  });

  it("a rejected utilization query blanks only its column (allSettled)", async () => {
    primeFleet({ cpu: new Error("cpu down") as any });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    for (const row of h.list.rows.value) expect(row.cpu).toBeNull();
    // Rows survive with their other columns.
    expect(rowByName(h.list, "web-01").disk).toBe(91);
    expect(h.list.pageError.value).toBeNull();
  });

  it("every call rejected ⇒ one page-level error, not a stack of column warnings", async () => {
    primeFleet({
      liveness: new Error("x") as any,
      cpu: new Error("x") as any,
      memUtilization: new Error("x") as any,
      memUsage: new Error("x") as any,
      cores: new Error("x") as any,
      disk: new Error("x") as any,
      load: new Error("x") as any,
      lastSeen: new Error("x") as any,
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.pageError.value).toBeTruthy();
    expect(h.list.banners.value.liveness).toBe(false);
    expect(h.list.banners.value.lastSeen).toBe(false);
  });
});

describe("useHostsList — sort, tint, staleness, facets, filter, paging", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("defaults to CPU % descending with blanked sort values last", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const names = h.list.filteredRows.value.map((r: any) => r.host_name);
    // db-01 is INACTIVE (cpu null) so it sorts last under the default sort.
    expect(names).toEqual(["web-01", "web-02", "db-01"]);
  });

  it("utilizationTint maps the 70/90 thresholds exactly", () => {
    expect(utilizationTint(69.9)).toBe("");
    expect(utilizationTint(70)).toBe("warn");
    expect(utilizationTint(89.9)).toBe("warn");
    expect(utilizationTint(90)).toBe("critical");
    expect(utilizationTint(null)).toBe("");
  });

  it("drops a late response from a superseded request generation", async () => {
    // metrics_query takes no AbortSignal: stale responses can only be ignored.
    const h = withHostsList();
    wrapper = h.wrapper;

    let releaseGen1: Array<() => void> = [];
    metricsQueryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGen1.push(() =>
            resolve(vector([{ metric: { host_name: "stale-host" }, value: 1 }])),
          );
        }),
    );
    searchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGen1.push(() => resolve(sqlHits([{ host_name: "stale-host", last_seen: 1 }])));
        }),
    );
    const gen1 = h.list.refresh({ ...refreshArgs, orgId: "old-org" });

    primeFleet();
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.rows.value.map((r: any) => r.host_name)).toContain("web-01");

    releaseGen1.forEach((release) => release());
    await gen1.catch(() => {});
    await flushPromises();
    expect(h.list.rows.value.map((r: any) => r.host_name)).not.toContain("stale-host");
    expect(h.list.rows.value.map((r: any) => r.host_name)).toContain("web-01");
  });

  it("computes facet counts, adding UNKNOWN only when present", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const statusValues = h.list.facets.value.status.map((f: any) => f.value);
    expect(statusValues).toEqual(["ACTIVE", "INACTIVE"]);
    const active = h.list.facets.value.status.find((f: any) => f.value === "ACTIVE");
    expect(active.count).toBe(2);

    primeFleet({ liveness: new Error("down") as any });
    await h.list.refresh(refreshArgs);
    await flushPromises();
    // Fixed order with zero-count rows kept in place — UNKNOWN appended last (4.8).
    expect(h.list.facets.value.status.map((f: any) => f.value)).toEqual([
      "ACTIVE",
      "INACTIVE",
      "UNKNOWN",
    ]);
    expect(h.list.facets.value.status.map((f: any) => f.count)).toEqual([0, 0, 3]);
  });

  it("derives the OS facet from distinct os_type values with counts", async () => {
    primeFleet({
      liveness: vector([
        { metric: { host_name: "web-01", os_type: "linux" }, value: 1 },
        { metric: { host_name: "web-02", os_type: "windows" }, value: 1 },
        { metric: { host_name: "web-03", os_type: "linux" }, value: 1 },
        { metric: { host_name: "web-04" }, value: 1 },
      ]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const os = h.list.facets.value.os;
    // Distinct os_type only (4.8) — a host without the label gets no bucket.
    expect(os.map((f: any) => f.value).sort()).toEqual(["linux", "windows"]);
    expect(os.find((f: any) => f.value === "linux").count).toBe(2);
    expect(os.find((f: any) => f.value === "windows").count).toBe(1);
  });

  it("debounces the name filter by 300ms", async () => {
    vi.useFakeTimers();
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    h.list.nameFilter.value = "web";
    await flushPromises();
    expect(h.list.filteredRows.value).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(300);
    expect(h.list.filteredRows.value).toHaveLength(2);
  });

  it("paginates the filtered rows 50 per page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      metric: { host_name: `host-${String(i).padStart(2, "0")}` },
      value: 10,
    }));
    primeFleet({
      liveness: vector(many),
      cpu: vector(many),
      ...memoryFixtureFor(many),
      disk: vector(many),
      load: vector(many),
      lastSeen: sqlHits([]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    expect(h.list.pagedRows.value).toHaveLength(50);
    h.list.page.value = 2;
    await flushPromises();
    expect(h.list.pagedRows.value).toHaveLength(10);
  });

  it("clamps the page to the last available page when filteredRows shrinks", async () => {
    vi.useFakeTimers();
    const many = Array.from({ length: 60 }, (_, i) => ({
      metric: { host_name: `host-${String(i).padStart(2, "0")}` },
      value: 10,
    }));
    primeFleet({
      liveness: vector(many),
      cpu: vector(many),
      ...memoryFixtureFor(many),
      disk: vector(many),
      load: vector(many),
      lastSeen: sqlHits([]),
    });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    h.list.page.value = 2;
    // A filter narrows the list below one page — page 2 would render empty.
    h.list.nameFilter.value = "host-01";
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(h.list.page.value).toBe(1);
    expect(h.list.pagedRows.value).toHaveLength(1);
  });

  it("pins the last-seen SQL row ceiling at 10000 (hosts beyond it silently drop)", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const sqlArgs: any = searchMock.mock.calls[0][0];
    expect(sqlArgs.query.query.size).toBe(10000);
  });
});
