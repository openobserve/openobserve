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

const sqlHits = (rows: Array<{ host_name: string; last_seen: number }>) =>
  ({ data: { hits: rows } }) as any;

type FleetResponses = Partial<{
  liveness: any;
  cpu: any;
  memUsed: any;
  memTotal: any;
  disk: any;
  load: any;
  lastSeen: any;
}>;

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
    memUsed: vector([
      { metric: { host_name: "web-01" }, value: 8_000_000_000 },
      { metric: { host_name: "web-02" }, value: 4_000_000_000 },
    ]),
    memTotal: vector([
      { metric: { host_name: "web-01" }, value: 16_000_000_000 },
      { metric: { host_name: "web-02" }, value: 16_000_000_000 },
    ]),
    disk: vector([
      { metric: { host_name: "web-01" }, value: 91 },
      { metric: { host_name: "web-02" }, value: 30 },
    ]),
    load: vector([
      { metric: { host_name: "web-01" }, value: 1.5 },
      { metric: { host_name: "web-02" }, value: 0.4 },
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
      if (q.includes("system_cpu_time")) return r.cpu;
      if (q.includes("system_filesystem_usage")) return r.disk;
      if (q.includes('system_memory_usage{state="used"}')) return r.memUsed;
      if (q.includes("system_memory_usage")) return r.memTotal;
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

  it("encodes every PromQL string passed to metrics_query", async () => {
    // metrics_query interpolates query=${query} RAW into the URL (search.ts).
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    for (const call of metricsQueryMock.mock.calls) {
      const raw = (call[0] as any).query as string;
      expect(raw).not.toContain("{");
      expect(decodeURIComponent(raw)).toContain("(");
    }
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

describe("useHostsList — memory pair", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    primeFleet();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("computes memory % client-side and keeps both raw byte values for the GB tooltip", async () => {
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    const web01 = rowByName(h.list, "web-01");
    expect(web01.memoryPct).toBe(50);
    expect(web01.memoryUsedBytes).toBe(8_000_000_000);
    expect(web01.memoryTotalBytes).toBe(16_000_000_000);
  });

  it("blanks the whole memory column when EITHER memory query rejects", async () => {
    primeFleet({ memTotal: new Error("boom") as any });
    const h = withHostsList();
    wrapper = h.wrapper;
    await h.list.refresh(refreshArgs);
    await flushPromises();
    for (const row of h.list.rows.value) {
      expect(row.memoryPct).toBeNull();
      expect(row.memoryUsedBytes).toBeNull();
      expect(row.memoryTotalBytes).toBeNull();
    }
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
    for (const row of h.list.rows.value) expect(row.lastSeen).toBeNull();
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

  it("all seven calls rejected ⇒ one page-level error, not seven stacked warnings", async () => {
    primeFleet({
      liveness: new Error("x") as any,
      cpu: new Error("x") as any,
      memUsed: new Error("x") as any,
      memTotal: new Error("x") as any,
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
      memUsed: vector(many),
      memTotal: vector(many.map((r) => ({ ...r, value: 100 }))),
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
});
