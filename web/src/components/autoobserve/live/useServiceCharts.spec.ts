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
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { ChartRange } from "../coverageSeries";
import type { CoverageRow } from "../fixtures";
import { resetCorrelationCache, useServiceCharts } from "./useServiceCharts";

const api = vi.hoisted(() => ({
  correlate: vi.fn(),
  getStream: vi.fn(),
  fetch: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@/services/service_streams", () => ({
  default: { correlate: (...args: unknown[]) => api.correlate(...args) },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: (...args: unknown[]) => api.getStream(...args) }),
}));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => api.fetch(...args),
    cancelStreamQueryBasedOnRequestId: (...args: unknown[]) => api.cancel(...args),
  }),
}));

type Call = [
  { queryReq: { query: { sql: string } }; traceId: string; pageType: string },
  {
    data: (p: unknown, r: unknown) => void;
    error: (p: unknown, r: unknown) => void;
    complete: (p: unknown, r: unknown) => void;
  },
];

const calls = () => api.fetch.mock.calls as unknown as Call[];
const sqlOf = (call: Call) => b64DecodeUnicode(call[0].queryReq.query.sql) ?? "";

const row = (service: string, streams: { type: string; name: string }[]): CoverageRow =>
  ({
    service,
    stream: streams[0]?.name ?? "—",
    lastScanned: "",
    scannedMinutes: null,
    cells: {},
    identity: {
      serviceId: `id/${service}`,
      serviceName: service,
      cluster: null,
      namespace: null,
      streams,
    },
  }) as unknown as CoverageRow;

const info = (
  name: string,
  type: string,
  filters?: Record<string, string>,
  dropped?: string[],
) => ({
  stream_name: name,
  stream_type: type,
  filters,
  dropped_dimensions: dropped,
});

const correlation = (
  service: string,
  traces: ReturnType<typeof info>[],
  logs: ReturnType<typeof info>[],
) => ({
  data: {
    service_name: service,
    matched_dimensions: {},
    additional_dimensions: {},
    related_streams: { logs, traces, metrics: [], profiles: [] },
  },
});

const schema = (fields: Record<string, string>) => ({
  schema: Object.entries(fields).map(([name, type]) => ({ name, type })),
});

const TRACES = [{ type: "traces", name: "app_traces" }];
const LOGS = [{ type: "logs", name: "k8s_app_logs" }];

const chunk = (call: Call, hits: Record<string, unknown>[], partial = false) => {
  call[1].data(call[0], {
    type: "search_response_metadata",
    content: { results: { hits: [], is_partial: partial } },
  });
  call[1].data(call[0], { type: "search_response_hits", content: { results: { hits } } });
};

const hitsAt = (call: Call, hits: Record<string, unknown>[], partial = false) => {
  chunk(call, hits, partial);
  call[1].complete(call[0], {});
};

const lastBucket = (step = 15 * 60_000) =>
  new Date(Math.floor(Date.now() / step) * step - step).toISOString().slice(0, 19);

const mountCharts = (initial: CoverageRow | null, range: ChartRange = "24h") => {
  const rowRef = ref<CoverageRow | null>(initial);
  const rangeRef = ref<ChartRange>(range);
  let charts!: ReturnType<typeof useServiceCharts>;
  const Host = defineComponent({
    setup() {
      charts = useServiceCharts(rowRef, rangeRef);
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [i18n, store] } });
  return { wrapper, rowRef, rangeRef, charts: () => charts.charts.value };
};

beforeEach(() => {
  resetCorrelationCache();
  api.correlate.mockReset();
  api.getStream.mockReset();
  api.fetch.mockReset();
  api.cancel.mockReset();
  store.state.zoConfig.features = undefined;
});

afterEach(() => {
  store.state.zoConfig.features = undefined;
});

describe("useServiceCharts on a traces service", () => {
  beforeEach(() => {
    api.correlate.mockResolvedValue(
      correlation("svc-b", [info("app_traces", "traces", { service_name: "svc-b" })], []),
    );
    api.getStream.mockResolvedValue(
      schema({ _timestamp: "Int64", span_status: "Utf8", duration: "Int64" }),
    );
  });

  it("scopes by _correlate and charts all three classes from one traces query", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(api.correlate).toHaveBeenCalledTimes(1);
    expect(api.correlate.mock.calls[0][1]).toEqual({
      source_stream: "app_traces",
      source_type: "traces",
      available_dimensions: { service: "svc-b" },
    });
    expect(calls()).toHaveLength(1);
    const [call] = calls();
    expect(call[0].pageType).toBe("traces");
    expect(sqlOf(call)).toContain(`WHERE "service_name" = 'svc-b'`);
    expect(sqlOf(call)).toContain("approx_percentile_cont(duration, 0.95)");
    expect(charts().latency.status).toBe("loading");

    hitsAt(call, [{ t: lastBucket(), n: 300, e: 6, p95: 250_000 }]);
    await flushPromises();
    expect(charts().requests).toMatchObject({ status: "ready", unit: "perMin", partial: false });
    expect(charts().requests.facts.current).toBe(20);
    expect(charts().errors).toMatchObject({ status: "ready", unit: "percent" });
    expect(charts().errors.facts.current).toBe(2);
    expect(charts().latency).toMatchObject({ status: "ready", unit: "ms" });
    expect(charts().latency.facts.current).toBe(250);
  });

  it("charts a service with no namespace on its own spans, not every namespace's (T2-8)", async () => {
    api.getStream.mockResolvedValue(
      schema({
        _timestamp: "Int64",
        span_status: "Utf8",
        duration: "Int64",
        service_k8s_namespace_name: "Utf8",
      }),
    );
    mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(sqlOf(calls()[0])).toContain(
      `WHERE "service_name" = 'svc-b' AND ("service_k8s_namespace_name" IS NULL OR "service_k8s_namespace_name" = '')`,
    );
  });

  it("adds no namespace predicate for a service in a namespace", async () => {
    api.getStream.mockResolvedValue(
      schema({ _timestamp: "Int64", span_status: "Utf8", service_k8s_namespace_name: "Utf8" }),
    );
    api.correlate.mockResolvedValue(
      correlation(
        "svc-b",
        [
          info("app_traces", "traces", {
            service_name: "svc-b",
            service_k8s_namespace_name: "ns-b",
          }),
        ],
        [],
      ),
    );
    const inNs = row("svc-b", TRACES);
    inNs.identity!.namespace = "ns-b";
    mountCharts(inNs);
    await flushPromises();
    expect(sqlOf(calls()[0])).not.toContain("IS NULL");
  });

  it("re-queries on a range change without a second _correlate", async () => {
    const { rangeRef } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    hitsAt(calls()[0], []);
    rangeRef.value = "1h";
    await flushPromises();
    expect(api.correlate).toHaveBeenCalledTimes(1);
    expect(calls()).toHaveLength(2);
    expect(sqlOf(calls()[1])).toContain("'1 minute'");
  });

  it("cancels the first query on a range change and drops its late chunks", async () => {
    const { rangeRef, charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    const first = calls()[0];
    rangeRef.value = "7d";
    await flushPromises();
    expect(api.cancel).toHaveBeenCalledWith({ trace_id: first[0].traceId, org_id: "default" });
    const second = calls()[1];
    expect(second[0].traceId).not.toBe(first[0].traceId);
    hitsAt(first, [{ t: lastBucket(), n: 999_999, e: 0, p95: 1 }]);
    await flushPromises();
    expect(charts().requests.status).toBe("loading");
    hitsAt(second, []);
    await flushPromises();
    expect(charts().requests.status).toBe("empty");
  });

  it("cancels every running query when the drawer closes", async () => {
    const { wrapper } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    const id = calls()[0][0].traceId;
    wrapper.unmount();
    expect(api.cancel).toHaveBeenCalledWith({ trace_id: id, org_id: "default" });
  });

  it("says which query failed and why, and Retry sends that one query again", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    const [call] = calls();
    call[1].error(call[0], { type: "error", content: { status: 500, message: "boom" } });
    await flushPromises();
    expect(charts().errors).toMatchObject({
      status: "failed",
      reason: "Couldn't load this chart from app_traces",
      detail: "boom",
    });
    expect(charts().latency.status).toBe("failed");
    charts().latency.retry();
    await flushPromises();
    expect(calls()).toHaveLength(2);
    expect(api.correlate).toHaveBeenCalledTimes(1);
    expect(charts().latency.status).toBe("loading");
  });

  it("shows a 403 on the chart query as a denial naming the stream and the missing permission", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    const [call] = calls();
    call[1].error(call[0], { type: "error", content: { status: 403, message: "Unauthorized" } });
    await flushPromises();
    for (const chart of Object.values(charts()))
      expect(chart).toMatchObject({
        status: "denied",
        reason: "You can't view app_traces",
        detail: "Your role is missing the Get permission on app_traces.",
      });
  });

  it("shows a 403 on _correlate as a denial naming the service streams permission, with no search", async () => {
    api.correlate.mockRejectedValue({ response: { status: 403 } });
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(api.fetch).not.toHaveBeenCalled();
    for (const chart of Object.values(charts()))
      expect(chart).toMatchObject({
        status: "denied",
        reason: "You can't view service streams",
        detail: "Your role is missing the Get permission on Service streams.",
      });
  });

  it("names the stream, not service streams, when its schema read is denied", async () => {
    api.getStream.mockRejectedValue(
      Object.assign(new Error("Unauthorized Access"), { response: { status: 403 } }),
    );
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(api.fetch).not.toHaveBeenCalled();
    for (const chart of Object.values(charts()))
      expect(chart).toMatchObject({
        status: "denied",
        reason: "You can't view app_traces",
        detail: "Your role is missing the Get permission on app_traces.",
      });
  });

  it("names the stream when its schema read fails, and Retry reads it again", async () => {
    api.getStream.mockRejectedValueOnce(
      Object.assign(new Error("schema busy"), { response: { status: 500 } }),
    );
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(charts().latency).toMatchObject({
      status: "failed",
      reason: "Couldn't load this chart from app_traces",
      detail: "schema busy",
    });
    charts().latency.retry();
    await flushPromises();
    expect(calls()).toHaveLength(1);
  });

  it("says the stream lookup failed when _correlate errors, and Retry looks again", async () => {
    api.correlate.mockRejectedValueOnce({ response: { status: 500, data: { message: "busy" } } });
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(charts().requests).toMatchObject({
      status: "failed",
      reason: "Couldn't look up the streams of svc-b",
      detail: "busy",
    });
    charts().requests.retry();
    await flushPromises();
    expect(api.correlate).toHaveBeenCalledTimes(2);
    expect(calls()).toHaveLength(1);
  });

  it("draws each streamed chunk as it arrives, marked partial until the search completes", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES), "7d");
    await flushPromises();
    const [call] = calls();
    chunk(call, []);
    await flushPromises();
    expect(charts().requests.status).toBe("loading");
    chunk(call, [{ t: lastBucket(60 * 60_000), n: 600, e: 6, p95: 250_000 }]);
    await flushPromises();
    expect(charts().requests).toMatchObject({ status: "ready", partial: true });
    expect(charts().requests.facts.current).toBe(10);
    expect(charts().latency).toMatchObject({ status: "ready", partial: true });
    call[1].complete(call[0], {});
    await flushPromises();
    expect(charts().requests).toMatchObject({ status: "ready", partial: false });
    expect(charts().latency.facts.current).toBe(250);
  });

  it("keeps a partial response's flag when it found no rows, and says only part was searched", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    hitsAt(calls()[0], [], true);
    await flushPromises();
    expect(charts().requests).toMatchObject({
      status: "empty",
      partial: true,
      reason: "No data from svc-b in the searched part of the last 24 h",
    });
  });

  it("keeps the partial flag on a latency chart whose partial rows carry no p95", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    hitsAt(calls()[0], [{ t: lastBucket(), n: 3, e: 0, p95: null }], true);
    await flushPromises();
    expect(charts().latency).toMatchObject({ status: "empty", partial: true });
    expect(charts().requests).toMatchObject({ status: "ready", partial: true });
  });

  it("says no data, naming the service and range, when the range has no rows", async () => {
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    hitsAt(calls()[0], []);
    await flushPromises();
    expect(charts().requests.status).toBe("empty");
    expect(charts().requests.reason).toBe("No data from svc-b in the last 24 h");
  });

  it("marks a partial response, and a stream that matched wider than the service", async () => {
    api.correlate.mockResolvedValue(
      correlation(
        "svc-b",
        [info("app_traces", "traces", { service_name: "svc-b" }, ["k8s-namespace"])],
        [],
      ),
    );
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    hitsAt(calls()[0], [{ t: lastBucket(), n: 3, e: 0, p95: 1000 }], true);
    await flushPromises();
    expect(charts().requests).toMatchObject({ status: "ready", partial: true, wide: true });
  });

  it("names the missing field instead of charting a class its stream can't show", async () => {
    api.getStream.mockResolvedValue(schema({ _timestamp: "Int64" }));
    const { charts } = mountCharts(row("svc-b", TRACES));
    await flushPromises();
    expect(sqlOf(calls()[0])).not.toContain("span_status");
    expect(sqlOf(calls()[0])).not.toContain("duration");
    expect(charts().errors).toMatchObject({
      status: "noField",
      reason: "No span status in app_traces",
    });
    expect(charts().latency).toMatchObject({
      status: "noField",
      reason: "No duration field in app_traces",
    });
    expect(charts().latency.facts.missingField).toBe("duration");
  });
});

describe("useServiceCharts on a logs service", () => {
  beforeEach(() => {
    api.correlate.mockResolvedValue(
      correlation(
        "svc-c",
        [],
        [info("k8s_app_logs", "logs", { service_name: "svc-c", k8s_namespace_name: "ns'a" })],
      ),
    );
  });

  it("charts errors from stderr and gives latency's traces reason without a traces query", async () => {
    api.getStream.mockResolvedValue(schema({ _timestamp: "Int64", log_iostream: "Utf8" }));
    const { charts } = mountCharts(row("svc-c", LOGS));
    await flushPromises();
    expect(calls()).toHaveLength(1);
    const [call] = calls();
    expect(call[0].pageType).toBe("logs");
    expect(sqlOf(call)).toContain(`"log_iostream" = 'stderr'`);
    expect(sqlOf(call)).toContain(`"k8s_namespace_name" = 'ns''a'`);
    expect(charts().latency).toMatchObject({
      status: "noField",
      reason: "Latency is charted from traces. svc-c sends none.",
    });
    hitsAt(call, [{ t: lastBucket(), n: 30, e: 15 }]);
    await flushPromises();
    expect(charts().errors).toMatchObject({ status: "ready", unit: "perMin" });
    expect(charts().errors.facts.current).toBe(1);
  });

  it("names the stream when it has no log level field", async () => {
    api.getStream.mockResolvedValue(schema({ _timestamp: "Int64", body: "Utf8" }));
    const { charts } = mountCharts(row("svc-c", LOGS));
    await flushPromises();
    expect(sqlOf(calls()[0])).not.toContain("FILTER");
    expect(charts().errors).toMatchObject({
      status: "noField",
      reason: "No log level in k8s_app_logs",
    });
  });

  it("takes requests from logs and errors and latency from traces, in two queries", async () => {
    api.correlate.mockResolvedValue(
      correlation(
        "svc-c",
        [info("app_traces", "traces", { service_name: "svc-c" })],
        [info("k8s_app_logs", "logs", { service_name: "svc-c" })],
      ),
    );
    api.getStream.mockResolvedValue(
      schema({ _timestamp: "Int64", span_status: "Utf8", duration: "Int64", level: "Utf8" }),
    );
    mountCharts(row("svc-c", LOGS));
    await flushPromises();
    expect(api.correlate).toHaveBeenCalledTimes(1);
    expect(
      calls()
        .map((c) => c[0].pageType)
        .sort(),
    ).toEqual(["logs", "traces"]);
    const logs = calls().find((c) => c[0].pageType === "logs") as Call;
    expect(sqlOf(logs)).not.toContain("FILTER");
  });
});

describe("useServiceCharts when the service can't be matched", () => {
  it("refuses another service's correlation and sends no search", async () => {
    api.correlate.mockResolvedValue(
      correlation("svc-x", [info("app_traces", "traces", { service_name: "svc-x" })], []),
    );
    const { charts } = mountCharts(row("svc-c", TRACES));
    await flushPromises();
    expect(api.fetch).not.toHaveBeenCalled();
    for (const chart of Object.values(charts())) {
      expect(chart.status).toBe("noMatch");
      expect(chart.reason).toBe("This service can't be matched to its streams");
    }
  });

  it("calls no _correlate when correlation is licence-locked", async () => {
    store.state.zoConfig.features = { correlation: "locked" };
    const { charts } = mountCharts(row("svc-c", TRACES));
    await flushPromises();
    expect(api.correlate).not.toHaveBeenCalled();
    expect(charts().requests.status).toBe("noMatch");
  });

  it("treats a null answer or a stream with no filters as no match", async () => {
    api.correlate.mockResolvedValueOnce({ data: null });
    const first = mountCharts(row("svc-c", TRACES));
    await flushPromises();
    expect(first.charts().errors.status).toBe("noMatch");
    resetCorrelationCache();
    api.correlate.mockResolvedValueOnce(correlation("svc-c", [info("app_traces", "traces")], []));
    const second = mountCharts(row("svc-c", TRACES));
    await flushPromises();
    expect(second.charts().errors.status).toBe("noMatch");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("stays idle outside live mode", async () => {
    mountCharts(null);
    await flushPromises();
    expect(api.correlate).not.toHaveBeenCalled();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
