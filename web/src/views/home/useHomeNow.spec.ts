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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";

import { wireContextOf } from "@/composables/assistant/context/serialize";
import { useHomeContextProvider } from "@/composables/contextProviders/homeContextProvider";
import { contextRegistry } from "@/composables/contextProviders/registry";
import type { OverviewNowRow } from "@/composables/contextProviders/types";
import type { Incident } from "@/services/incidents";
import type { ServiceTrend, ServicesTrendResponse } from "@/services/service_graph";

import {
  buildOverviewNow,
  snapshotOf,
  trendPoints,
  useHomeNow,
  type OverviewNowInput,
  type OverviewNowState,
} from "./useHomeNow";

const START = 1_762_296_400_000_000;
const END = 1_762_300_000_000_000;
const NOW = END;

const incident = (id: string, over: Partial<Incident> = {}): Incident =>
  ({
    id,
    org_id: "acme",
    status: "open",
    severity: "P1",
    first_alert_at: START,
    last_alert_at: END - 10,
    alert_count: 3,
    title: `Incident ${id}`,
    created_at: START,
    updated_at: END,
    rca: null,
    ...over,
  }) as Incident;

const svc = (service: string, over: Partial<ServiceTrend> = {}): ServiceTrend => ({
  service,
  current: { requests: 1000, failed: 61, error_rate: 6.1, p99_latency_ns: 2_900_000_000 },
  baseline: {
    error_rate: 0.4,
    p99_latency_ns: 1_000_000_000,
    requests_per_min: 20,
    covered_hours: 24,
  },
  p99_ratio: 2.9,
  error_rate_delta: 5.7,
  signal: "errors",
  included: false,
  series: [],
  ...over,
});

const trend = (services: ServiceTrend[], over: Partial<ServicesTrendResponse> = {}) =>
  ({
    window: { start_time: START, end_time: END - 60_000_000 },
    baseline_window: { start_time: START - 86_400_000_000, end_time: START },
    data_until: END - 60_000_000,
    source: "v4",
    step_micros: 360_000_000,
    partial: false,
    warnings: [],
    services,
    total_services: services.length,
    degraded_total: services.filter((s) => s.signal === "errors" || s.signal === "latency").length,
    ...over,
  }) as ServicesTrendResponse;

const input = (over: Partial<OverviewNowInput> = {}): OverviewNowInput => ({
  resetKey: "acme|1h",
  window: { start: START, end: END },
  nowUs: NOW,
  incidents: null,
  trend: null,
  topology: null,
  anomalies: null,
  alertHits: null,
  alertList: null,
  allRegions: false,
  ...over,
});

const keys = (state: OverviewNowState) => state.rows.map((row) => row.key);
const serviceOf = (state: OverviewNowState, name: string) =>
  state.rows.find((row) => row.key === `service:${name}`) as
    Extract<OverviewNowRow, { kind: "service" }> | undefined;

describe("buildOverviewNow", () => {
  it("orders the four buckets with recovered last", () => {
    const state = buildOverviewNow(
      input({
        incidents: {
          open: [incident("p3", { severity: "P3" }), incident("p1")],
          acknowledged: [],
          resolved: [incident("done", { status: "resolved", resolved_at: END - 100 })],
        },
        trend: trend([svc("checkout-api"), svc("search", { signal: "latency", p99_ratio: 2.4 })]),
        anomalies: [
          { configId: "an-1", name: "Orders", stream: "orders", anomalyCount: 4, at: END },
        ],
        alertHits: [{ alert_name: "High CPU", status: "firing", timestamp: END - 5 }],
      }),
      null,
    );
    expect(state.rows.map((row) => row.bucket)).toEqual([
      "critical",
      "critical",
      "degraded",
      "degraded",
      "degraded",
      "anomaly",
      "recovered",
    ]);
    expect(keys(state)).toEqual([
      "incident:p1",
      "service:checkout-api",
      "alert:High CPU",
      "service:search",
      "incident:p3",
      "anomaly:an-1",
      "incident:done",
    ]);
  });

  it("shows a resolved incident as Recovered only inside the window", () => {
    const state = buildOverviewNow(
      input({
        incidents: {
          open: [],
          acknowledged: [],
          resolved: [
            incident("in", { status: "resolved", resolved_at: START + 1 }),
            incident("out", { status: "resolved", resolved_at: START - 1 }),
          ],
        },
      }),
      null,
    );
    expect(keys(state)).toEqual(["incident:in"]);
  });

  it("never lists normal or low-traffic services", () => {
    const state = buildOverviewNow(
      input({
        trend: trend([
          svc("quiet", {
            signal: "low_traffic",
            current: { requests: 3, failed: 3, error_rate: 100, p99_latency_ns: null },
          }),
          svc("fine", { signal: "normal", error_rate_delta: 0.1 }),
        ]),
      }),
      null,
    );
    expect(state.rows).toEqual([]);
  });

  describe("hysteresis", () => {
    const first = () =>
      buildOverviewNow(
        input({
          trend: trend([
            svc("api"),
            svc("slow", { signal: "latency", p99_ratio: 2.5, error_rate_delta: 0 }),
          ]),
        }),
        null,
      );

    it("holds errors above 0.5 pp and leaves below it", () => {
      const prev = first();
      const held = buildOverviewNow(
        input({
          trend: trend([svc("api", { signal: "normal", error_rate_delta: 0.6, included: true })]),
        }),
        prev,
      );
      expect(serviceOf(held, "api")?.signal).toBe("errors");
      const left = buildOverviewNow(
        input({
          trend: trend([svc("api", { signal: "normal", error_rate_delta: 0.4, included: true })]),
        }),
        prev,
      );
      expect(serviceOf(left, "api")).toBeUndefined();
    });

    it("drops a held errors row under 20 requests", () => {
      const next = buildOverviewNow(
        input({
          trend: trend([
            svc("api", {
              signal: "low_traffic",
              current: { requests: 19, failed: 5, error_rate: 26, p99_latency_ns: null },
              included: true,
            }),
          ]),
        }),
        first(),
      );
      expect(serviceOf(next, "api")).toBeUndefined();
    });

    it("holds latency for an included row at 1.8x and leaves at 1.5x", () => {
      const prev = first();
      const held = buildOverviewNow(
        input({
          trend: trend([
            svc("slow", { signal: "normal", p99_ratio: 1.8, error_rate_delta: 0, included: true }),
          ]),
        }),
        prev,
      );
      expect(serviceOf(held, "slow")?.signal).toBe("latency");
      const left = buildOverviewNow(
        input({
          trend: trend([
            svc("slow", { signal: "normal", p99_ratio: 1.5, error_rate_delta: 0, included: true }),
          ]),
        }),
        prev,
      );
      expect(serviceOf(left, "slow")).toBeUndefined();
    });

    it("enters only at the server's thresholds", () => {
      const state = buildOverviewNow(
        input({
          trend: trend([svc("new", { signal: "normal", p99_ratio: 1.8, error_rate_delta: 0.9 })]),
        }),
        null,
      );
      expect(state.rows).toEqual([]);
    });

    it("lets a held service absent from the response leave, never as Recovered", () => {
      const next = buildOverviewNow(input({ trend: trend([]) }), first());
      expect(next.rows).toEqual([]);
    });

    it("forgets the held rows on a range change and on a fallback to topology", () => {
      const prev = first();
      const otherRange = buildOverviewNow(
        input({
          resetKey: "acme|24h",
          trend: trend([svc("api", { signal: "normal", error_rate_delta: 0.6 })]),
        }),
        prev,
      );
      expect(serviceOf(otherRange, "api")).toBeUndefined();
      const fallback = buildOverviewNow(
        input({ topology: { nodes: [{ id: "api", requests: 100, error_rate: 1 }], edges: [] } }),
        prev,
      );
      expect(fallback.rows).toEqual([]);
    });
  });

  it("counts +N more from the server's degraded total, not held normal rows", () => {
    const prev = buildOverviewNow(input({ trend: trend([svc("api")]) }), null);
    const next = buildOverviewNow(
      input({
        trend: trend(
          [svc("api", { signal: "normal", error_rate_delta: 0.7, included: true }), svc("b")],
          { degraded_total: 5 },
        ),
      }),
      prev,
    );
    expect(keys(next)).toEqual(["service:b", "service:api"]);
    expect(next.moreDegraded).toBe(4);
  });

  it("marks partial service rows without moving them", () => {
    const whole = buildOverviewNow(input({ trend: trend([svc("a"), svc("b")]) }), null);
    const partial = buildOverviewNow(
      input({ trend: trend([svc("a"), svc("b")], { partial: true }) }),
      whole,
    );
    expect(keys(partial)).toEqual(keys(whole));
    expect(partial.rows.every((row) => row.kind === "service" && row.partial)).toBe(true);
    expect(partial.services.partial).toBe(true);
  });

  it("keeps order inside a bucket, puts new rows on top and stamps changedAt on a move", () => {
    const prev = buildOverviewNow(input({ trend: trend([svc("a"), svc("b")]), nowUs: 1 }), null);
    const next = buildOverviewNow(
      input({ trend: trend([svc("c"), svc("b"), svc("a")]), nowUs: 2 }),
      prev,
    );
    expect(keys(next)).toEqual(["service:c", "service:a", "service:b"]);
    expect(next.rows.map((row) => row.changedAt)).toEqual([2, 1, 1]);
    const moved = buildOverviewNow(
      input({
        trend: trend([svc("a", { signal: "latency", error_rate_delta: 0.1 }), svc("b")]),
        nowUs: 3,
      }),
      next,
    );
    expect(moved.rows.find((row) => row.key === "service:a")).toMatchObject({
      bucket: "degraded",
      changedAt: 3,
    });
  });

  it("never makes a Recovered row from service data", () => {
    const prev = buildOverviewNow(input({ trend: trend([svc("api")]) }), null);
    const next = buildOverviewNow(
      input({ trend: trend([svc("api", { signal: "normal", error_rate_delta: 0 })]) }),
      prev,
    );
    expect(next.rows.some((row) => row.bucket === "recovered")).toBe(false);
  });

  describe("alerts", () => {
    const item = (over: Record<string, unknown>) => ({
      alert_id: "al-1",
      name: "High CPU",
      enabled: true,
      stream_type: "metrics",
      last_triggered_at: END - 100,
      last_satisfied_at: END - 100,
      last_outcome: "normal",
      last_outcome_at: END - 50,
      ...over,
    });

    it("groups three firing hits of one alert into one row with x3", () => {
      const hit = { alert_name: "High CPU", status: "firing" };
      const state = buildOverviewNow(
        input({
          alertHits: [
            { ...hit, timestamp: END - 3 },
            { ...hit, timestamp: END - 2 },
            { ...hit, timestamp: END - 1 },
          ],
          alertList: [item({ last_outcome: "firing", last_outcome_at: END - 1 })],
        }),
        null,
      );
      expect(state.rows).toEqual([
        expect.objectContaining({ key: "alert:al-1", state: "firing", count: 3, lastAt: END - 1 }),
      ]);
    });

    it("recovers an alert only on an OK outcome newer than its last trigger", () => {
      const recovered = buildOverviewNow(input({ alertList: [item({})] }), null);
      expect(recovered.rows).toEqual([
        expect.objectContaining({ key: "alert:al-1", state: "recovered", bucket: "recovered" }),
      ]);
      const older = buildOverviewNow(
        input({ alertList: [item({ last_outcome_at: END - 200 })] }),
        null,
      );
      expect(older.rows).toEqual([]);
    });

    it("never calls an alert that never fired Recovered, though every run sets last_triggered_at", () => {
      const state = buildOverviewNow(
        input({ alertList: [item({ last_satisfied_at: null, last_outcome_at: END - 10 })] }),
        null,
      );
      expect(state.rows).toEqual([]);
    });

    it("keeps an alert firing on an error last outcome", () => {
      const state = buildOverviewNow(
        input({
          alertHits: [{ alert_name: "High CPU", status: "firing", timestamp: END - 5 }],
          alertList: [item({ last_outcome: "error" })],
        }),
        null,
      );
      expect(state.rows).toEqual([
        expect.objectContaining({ state: "firing", bucket: "degraded" }),
      ]);
    });

    it("keeps firing when the name matches several list items", () => {
      const state = buildOverviewNow(
        input({
          alertHits: [{ alert_name: "High CPU", status: "firing", timestamp: END - 5 }],
          alertList: [item({ alert_id: "a" }), item({ alert_id: "b", last_outcome: "firing" })],
        }),
        null,
      );
      expect(state.rows.find((row) => row.bucket === "degraded")).toMatchObject({
        key: "alert:High CPU",
        state: "firing",
      });
    });
  });

  it("marks coverage from the alert list", () => {
    const state = buildOverviewNow(
      input({
        trend: trend([svc("search"), svc("api")]),
        alertList: [
          {
            alert_id: "x",
            name: "search errors",
            enabled: true,
            stream_type: "logs",
            condition: {
              type: "sql",
              sql: `SELECT count(*) FROM "default" WHERE service = 'search'`,
            },
          },
        ],
      }),
      null,
    );
    expect(serviceOf(state, "search")?.coverage).toBe("covered");
    expect(serviceOf(state, "api")?.coverage).toBe("none");
    const unknown = buildOverviewNow(input({ trend: trend([svc("api")]) }), null);
    expect(serviceOf(unknown, "api")?.coverage).toBe("unknown");
  });

  it("falls back to topology figures without a trend", () => {
    const state = buildOverviewNow(
      input({
        topology: {
          nodes: [
            { id: "api", requests: 100, error_rate: 7 },
            { id: "slow", requests: 100, error_rate: 0 },
            { id: "tiny", requests: 3, error_rate: 50 },
          ],
          edges: [{ to: "slow", p99_latency_ns: 300, baseline_p99_latency_ns: 100 }],
        },
      }),
      null,
    );
    expect(keys(state)).toEqual(["service:api", "service:slow"]);
    expect(serviceOf(state, "slow")).toMatchObject({ p99Ratio: 3, baselineErrorRate: null });
    expect(state.services.available).toBe(false);
  });
});

describe("useHomeNow", () => {
  it("sends the shown services as include until the range changes", () => {
    const now = useHomeNow();
    expect(now.includeFor("acme|1h")).toEqual([]);
    now.commit(input({ trend: trend([svc("a"), svc("b")]) }));
    expect(now.includeFor("acme|1h")).toEqual(["a", "b"]);
    expect(now.includeFor("acme|24h")).toEqual([]);
    now.reset();
    expect(now.includeFor("acme|1h")).toEqual([]);
  });

  it("drops a selected key whose row is gone", () => {
    const now = useHomeNow();
    now.commit(input({ trend: trend([svc("a")]) }));
    now.selectedKey.value = "service:a";
    expect(now.snapshot.value.selectedKey).toBe("service:a");
    now.commit(input({ trend: trend([]) }));
    expect(now.snapshot.value.selectedKey).toBeNull();
  });
});

describe("useHomeNow refreshAlertList", () => {
  const covering = {
    alert_id: "x",
    name: "a errors",
    enabled: true,
    stream_type: "logs",
    condition: { type: "sql", sql: `SELECT count(*) FROM "default" WHERE service = 'a'` },
  };

  it("rebuilds the committed rows' coverage with the newer list, keeping the window", () => {
    const now = useHomeNow();
    now.commit(input({ trend: trend([svc("a")]), alertList: [] }));
    expect(serviceOf(now.state.value!, "a")?.coverage).toBe("none");
    now.refreshAlertList("acme|1h", [covering]);
    expect(serviceOf(now.state.value!, "a")?.coverage).toBe("covered");
    expect(now.snapshot.value.window).toEqual({ start: START, end: END });
  });

  it("ignores a list for another range or before any commit", () => {
    const now = useHomeNow();
    expect(now.refreshAlertList("acme|1h", [covering])).toBeNull();
    now.commit(input({ trend: trend([svc("a")]), alertList: [] }));
    expect(now.refreshAlertList("acme|24h", [covering])).toBeNull();
    expect(serviceOf(now.state.value!, "a")?.coverage).toBe("none");
    now.reset();
    expect(now.refreshAlertList("acme|1h", [covering])).toBeNull();
  });
});

describe("trendPoints", () => {
  const STEP = 360_000_000;
  const DATA_UNTIL = END - 60_000_000 - 13_000_000;
  const BASELINE_START = START - 13_000_000 - 86_400_000_000;
  const SERIES_START = Math.ceil(BASELINE_START / STEP) * STEP;
  const gridTrend = () => {
    const grid: number[] = [];
    for (let at = SERIES_START; at <= DATA_UNTIL; at += STEP) grid.push(at);
    const series = grid.map((timestamp) => ({
      timestamp,
      requests: 10,
      failed: 1,
      p99_latency_ns: 2_000_000,
    }));
    return trend([svc("checkout-api", { series })], {
      window: { start_time: START - 13_000_000, end_time: DATA_UNTIL },
      baseline_window: { start_time: BASELINE_START, end_time: START - 13_000_000 },
      data_until: DATA_UNTIL,
      step_micros: STEP,
      series_start: SERIES_START,
    });
  };

  it("reads every window step from the step-aligned grid when the bounds are not aligned", () => {
    expect(BASELINE_START % STEP).not.toBe(0);
    const errors = trendPoints(gridTrend(), "checkout-api", "errors");
    const expected = Math.floor((DATA_UNTIL - (START - 13_000_000)) / STEP);
    expect(errors?.points.length).toBeGreaterThanOrEqual(expected);
    expect(errors?.points.every((point) => point === 10)).toBe(true);
    const latency = trendPoints(gridTrend(), "checkout-api", "latency");
    expect(latency?.points.every((point) => point === 2)).toBe(true);
  });
});

describe("the real snapshot through the Home context provider", () => {
  afterEach(() => contextRegistry.cleanup());

  it("reaches the wire with page, currentPage and every overview key", async () => {
    const now = useHomeNow();
    now.commit(
      input({
        incidents: { open: [incident("inc-7")], acknowledged: [], resolved: [] },
        trend: trend([svc("checkout-api")]),
        anomalies: [
          { configId: "an-1", name: "Orders", stream: "orders", anomalyCount: 2, at: END },
        ],
        alertHits: [{ alert_name: "High CPU", status: "firing", timestamp: END - 1 }],
        alertList: [],
        allRegions: true,
      }),
    );
    now.selectedKey.value = "service:checkout-api";
    const store = { state: { selectedOrganization: { identifier: "acme" } } };
    const Host = defineComponent({
      setup() {
        useHomeContextProvider(() => now.snapshot.value, store);
        return () => h("div");
      },
    });
    const wrapper = mount(Host);
    const page = await contextRegistry.getActiveContext();
    const wire = wireContextOf(
      page,
      { chips: [], timeOverride: null, removedPageKeys: [] },
      {
        org: "acme",
      },
    );
    expect(wire).toMatchObject({
      page: "home_overview",
      currentPage: "home",
      overviewSelected: { kind: "service", id: "checkout-api" },
      overviewIncidents: [expect.objectContaining({ id: "inc-7", severity: "P1", alert_count: 3 })],
      overviewServices: [
        expect.objectContaining({
          service: "checkout-api",
          error_rate: 6.1,
          baseline_error_rate: 0.4,
          baseline_hours: 24,
          p99_ms: 2900,
          p99_ratio: 2.9,
          signal: "errors",
          alert_coverage: "none",
        }),
      ],
      overviewServicesMeta: {
        all_regions: true,
        partial: false,
        data_until: END - 60_000_000,
        window_start: START,
        window_end: END - 60_000_000,
      },
      overviewAnomalies: [expect.objectContaining({ config_id: "an-1", anomaly_count: 2 })],
      overviewAlerts: [
        expect.objectContaining({ alert_id: "High CPU", state: "firing", count: 1 }),
      ],
    });
    wrapper.unmount();
    expect(snapshotOf(null, null).rows).toEqual([]);
  });
});
