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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { b64DecodeUnicode } from "@/utils/zincutils";

const { labelValues, labels, metricsQuery } = vi.hoisted(() => ({
  labelValues: vi.fn(),
  labels: vi.fn(),
  metricsQuery: vi.fn(),
}));

vi.mock("@/services/metrics", () => ({ default: { labelValues, labels } }));
vi.mock("@/services/search", () => ({ default: { metrics_query: metricsQuery } }));

import {
  getQueryVariableErrorMessage,
  loadQueryVariableValues,
  QueryVariableCancelledError,
  runSqlVariableQueryOnStream,
  toPromSeconds,
  type QueryVariableLoadParams,
} from "./queryVariableLoader";
import { buildAutoPromqlQuery, substituteQueryVariables } from "./queryVariableUtils";

const baseParams = (overrides: Partial<QueryVariableLoadParams>): QueryVariableLoadParams => ({
  query: "",
  language: "promql",
  maxRecords: 10,
  startTime: 1000,
  endTime: 2000,
  orgId: "org",
  runSql: vi.fn(),
  ...overrides,
});

const promOk = (data: unknown) => ({ data: { status: "success", data } });

describe("loadQueryVariableValues — PromQL", () => {
  beforeEach(() => {
    labelValues.mockReset();
    labels.mockReset();
    metricsQuery.mockReset();
  });

  it("label_values(label) asks /label/{label}/values without a matcher", async () => {
    labelValues.mockResolvedValue(promOk(["api", "web", "api"]));
    const result = await loadQueryVariableValues(baseParams({ query: "label_values(job)" }));
    expect(labelValues).toHaveBeenCalledWith({
      org_identifier: "org",
      start_time: 1000,
      end_time: 2000,
      label: "job",
      match: undefined,
    });
    expect(result.options).toEqual([
      { label: "api", value: "api" },
      { label: "web", value: "web" },
    ]);
  });

  it("sends Prometheus unix seconds whatever unit the caller passes", async () => {
    expect(toPromSeconds(1_792_062_830_486_000)).toBe(1_792_062_830);
    expect(toPromSeconds(1_792_062_830_486)).toBe(1_792_062_830);
    expect(toPromSeconds(1_792_062_830)).toBe(1_792_062_830);

    labelValues.mockResolvedValue(promOk(["api"]));
    metricsQuery.mockResolvedValue({ data: { status: "success", data: { result: [] } } });
    const dashboardRange = { startTime: 1_792_059_230_486_000, endTime: 1_792_062_830_486_000 };
    await loadQueryVariableValues(
      baseParams({ query: "label_values(up, job)", ...dashboardRange }),
    );
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ start_time: 1_792_059_230, end_time: 1_792_062_830 }),
    );
    await loadQueryVariableValues(baseParams({ query: "query_result(up)", ...dashboardRange }));
    expect(metricsQuery).toHaveBeenCalledWith(expect.objectContaining({ end_time: 1_792_062_830 }));
  });

  it("runs an auto PromQL variable as one scoped label lookup with its filters as matchers", async () => {
    labelValues.mockResolvedValue(promOk(["api", "web"]));
    const query = substituteQueryVariables(
      buildAutoPromqlQuery({
        stream: "http_requests_total",
        field: "job",
        filter: [
          { name: "env", operator: "=", value: "$env" },
          { name: "code", operator: "!=", value: "500" },
        ],
      }),
      [{ name: "env", value: ["prod", "stage"], multiSelect: true, isVariablePartialLoaded: true }],
      "promql",
    );
    const result = await loadQueryVariableValues(baseParams({ query }));
    expect(labelValues).toHaveBeenCalledTimes(1);
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "job",
        match: 'http_requests_total{env=~"prod|stage",code!="500"}',
      }),
    );
    expect(result.options.map((o) => o.value)).toEqual(["api", "web"]);
  });

  it("label_values(label) unions the label across metrics when the backend needs a metric", async () => {
    labelValues.mockImplementation(async ({ label, match }: any) => {
      if (label === "__name__") return promOk(["up", "kube_pod_info", "no_job"]);
      if (!match) return { data: { status: "error", error: "match[] must specify a metric" } };
      if (match === "no_job") throw new Error("label not found");
      return promOk(match === "up" ? ["web", "api"] : ["api", "kube"]);
    });
    const result = await loadQueryVariableValues(baseParams({ query: "label_values(job)" }));
    expect(result.options.map((o) => o.value)).toEqual(["api", "kube", "web"]);
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: "job", match: "up" }),
    );
  });

  it("label_values(selector, label) passes the selector as match[]", async () => {
    labelValues.mockResolvedValue(promOk(["a", "b", "c"]));
    const result = await loadQueryVariableValues(
      baseParams({ query: 'label_values(up{job="api"}, instance)', maxRecords: 2 }),
    );
    expect(labelValues).toHaveBeenCalledWith(
      expect.objectContaining({ label: "instance", match: 'up{job="api"}' }),
    );
    expect(result.options.map((o) => o.value)).toEqual(["a", "b"]);
    expect(result.capped).toBe(true);
  });

  it("label_names() reads /labels", async () => {
    labels.mockResolvedValue(promOk(["job", "instance"]));
    const result = await loadQueryVariableValues(baseParams({ query: "label_names()" }));
    expect(labels).toHaveBeenCalledWith(expect.objectContaining({ match: undefined }));
    expect(result.options.map((o) => o.value)).toEqual(["job", "instance"]);
  });

  it("metrics(regex) filters metric names", async () => {
    labelValues.mockResolvedValue(promOk(["node_cpu", "up", "node_memory"]));
    const result = await loadQueryVariableValues(baseParams({ query: "metrics(^node_)" }));
    expect(labelValues).toHaveBeenCalledWith(expect.objectContaining({ label: "__name__" }));
    expect(result.options.map((o) => o.value)).toEqual(["node_cpu", "node_memory"]);
  });

  it("metrics with an invalid regex fails with a readable message", async () => {
    labelValues.mockResolvedValue(promOk([]));
    await expect(loadQueryVariableValues(baseParams({ query: "metrics([)" }))).rejects.toThrow(
      "Invalid regular expression",
    );
  });

  it("query_result renders each series as text from an instant query at the end time", async () => {
    metricsQuery.mockResolvedValue({
      data: {
        status: "success",
        data: {
          resultType: "vector",
          result: [{ metric: { __name__: "up", job: "api" }, value: [1700000000, "1"] }],
        },
      },
    });
    const result = await loadQueryVariableValues(baseParams({ query: "query_result(up)" }));
    expect(metricsQuery).toHaveBeenCalledWith({
      org_identifier: "org",
      query: "up",
      end_time: 2000,
    });
    expect(result.options).toEqual([
      { label: 'up{job="api"} 1 1700000000000', value: 'up{job="api"} 1 1700000000000' },
    ]);
  });

  it("rejects an unsupported query before calling the API", async () => {
    await expect(loadQueryVariableValues(baseParams({ query: "up" }))).rejects.toThrow(
      "label_values",
    );
    expect(labelValues).not.toHaveBeenCalled();
  });

  it("surfaces a Prometheus error body", async () => {
    labelValues.mockResolvedValue({ data: { status: "error", error: "bad matcher" } });
    await expect(
      loadQueryVariableValues(baseParams({ query: "label_values(job)" })),
    ).rejects.toThrow("bad matcher");
  });
});

describe("loadQueryVariableValues — SQL", () => {
  it("asks for one row past the cap and maps value and label columns", async () => {
    const runSql = vi.fn().mockResolvedValue([
      { id: "1", name: "One" },
      { id: "2", name: "Two" },
      { id: "3", name: "Three" },
    ]);
    const result = await loadQueryVariableValues(
      baseParams({
        language: "sql",
        query: "SELECT id, name FROM t",
        streamType: "logs",
        valueField: "id",
        labelField: "name",
        maxRecords: 2,
        runSql,
      }),
    );
    expect(runSql).toHaveBeenCalledWith({
      sql: "SELECT id, name FROM t",
      streamType: "logs",
      startTime: 1000,
      endTime: 2000,
      size: 3,
    });
    expect(result.options).toEqual([
      { label: "One", value: "1" },
      { label: "Two", value: "2" },
    ]);
    expect(result.capped).toBe(true);
    expect(result.columns).toEqual(["id", "name"]);
  });
});

describe("runSqlVariableQueryOnStream", () => {
  const stream = () => {
    const calls: any[] = [];
    const fetchStream = vi.fn((payload: any, handlers: any) => {
      calls.push({ payload, handlers });
    });
    return { fetchStream, calls };
  };
  const request = {
    sql: "SELECT 1",
    startTime: 1,
    endTime: 2,
    size: 11,
    orgId: "org",
    traceId: "trace",
  };

  it("posts a base64 search request and collects the hits of every partition", async () => {
    const { fetchStream, calls } = stream();
    const promise = runSqlVariableQueryOnStream(fetchStream, { ...request, streamType: "traces" });
    const { payload, handlers } = calls[0];
    expect(payload.type).toBe("search");
    expect(payload.pageType).toBe("traces");
    expect(payload.queryReq.encoding).toBe("base64");
    expect(payload.queryReq.query.size).toBe(11);
    expect(b64DecodeUnicode(payload.queryReq.query.sql)).toBe("SELECT 1");

    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ a: 1 }] } },
    });
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ a: 2 }] } },
    });
    handlers.data(payload, { type: "end" });
    await expect(promise).resolves.toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("replaces rows on each partition of a streaming aggregation", async () => {
    const { fetchStream, calls } = stream();
    const promise = runSqlVariableQueryOnStream(fetchStream, request);
    const { payload, handlers } = calls[0];
    handlers.data(payload, {
      type: "search_response_metadata",
      content: { results: { streaming_aggs: true } },
    });
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ a: 1 }] } },
    });
    handlers.data(payload, {
      type: "search_response_hits",
      content: { results: { hits: [{ a: 3 }] } },
    });
    handlers.complete(payload, {});
    await expect(promise).resolves.toEqual([{ a: 3 }]);
  });

  it("rejects with the server message on an error event", async () => {
    const { fetchStream, calls } = stream();
    const promise = runSqlVariableQueryOnStream(fetchStream, request);
    const { payload, handlers } = calls[0];
    handlers.data(payload, {
      type: "error",
      content: { message: "Search error", error_detail: "column x not found" },
    });
    await expect(promise).rejects.toThrow("column x not found");
  });

  it("rejects with a cancelled error on cancel_response", async () => {
    const { fetchStream, calls } = stream();
    const promise = runSqlVariableQueryOnStream(fetchStream, request);
    calls[0].handlers.data(calls[0].payload, { type: "cancel_response", content: {} });
    await expect(promise).rejects.toBeInstanceOf(QueryVariableCancelledError);
  });

  it("rejects when the stream errors", async () => {
    const { fetchStream, calls } = stream();
    const promise = runSqlVariableQueryOnStream(fetchStream, request);
    calls[0].handlers.error(calls[0].payload, { status: 400, message: "bad sql" });
    await expect(promise).rejects.toThrow("bad sql");
  });
});

describe("getQueryVariableErrorMessage", () => {
  it("prefers the detailed message", () => {
    expect(getQueryVariableErrorMessage({ response: { data: { message: "m" } } })).toBe("m");
    expect(getQueryVariableErrorMessage(new Error("boom"))).toBe("boom");
  });
});
