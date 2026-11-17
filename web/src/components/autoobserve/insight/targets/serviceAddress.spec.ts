// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const { stream, cancel } = vi.hoisted(() => ({ stream: vi.fn(), cancel: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream,
    cancelStreamQueryBasedOnRequestId: cancel,
  }),
}));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "demo-org" } } },
}));

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import config from "@/aws-exports";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { ServiceScope } from "@/utils/alerts/prefill/fromAutoObserve";
import { addressFromRow, serviceAddressSql, useServiceAddress } from "./serviceAddress";

const scope: ServiceScope = {
  service: "svc-c",
  cluster: "cluster-k",
  namespace: "ns-a",
  stream: { type: "traces", name: "app_traces" },
  schema: [
    "_timestamp",
    "service_name",
    "k8s_cluster",
    "k8s_namespace_name",
    "span_kind",
    "server_address",
    "server_port",
    "http_route",
  ],
};

type Handlers = { data: Function; error: Function; complete: Function };
const handlersOf = (call = 0): Handlers => stream.mock.calls[call][1];

const hits = (rows: Record<string, unknown>[]) => ({
  type: "search_response_hits",
  content: { results: { hits: rows } },
});

beforeEach(() => {
  stream.mockReset();
  cancel.mockReset();
});

afterEach(() => {
  config.isEnterprise = "true";
});

describe("serviceAddressSql", () => {
  it("reads the newest server span with an address and a health route", () => {
    expect(serviceAddressSql({ ...scope, service: "o'brien" })).toBe(
      `SELECT "server_address", "server_port", "http_route", max(_timestamp) AS seen_at FROM "app_traces" WHERE "service_name" = 'o''brien' AND "k8s_cluster" = 'cluster-k' AND "k8s_namespace_name" = 'ns-a' AND "span_kind" = '2' AND "server_address" IS NOT NULL AND (lower("http_route") LIKE '%health%' OR lower("http_route") LIKE '%ready%' OR lower("http_route") LIKE '%live%') GROUP BY "server_address", "server_port", "http_route" ORDER BY seen_at DESC LIMIT 1`,
    );
  });
});

describe("serviceAddressSql against the stream's schema", () => {
  const TRACES = [
    "_timestamp",
    "service_name",
    "k8s_cluster",
    "k8s_namespace_name",
    "span_kind",
    "server_address",
    "server_port",
    "http_route",
  ];
  const full: ServiceScope = { ...scope, schema: TRACES };
  const without = (field: string) => TRACES.filter((f) => f !== field);
  const parser = new Parser();
  const columnsOf = (sql: string): string[] => {
    const aliases = new Set([...sql.matchAll(/ AS (\w+)/g)].map((m) => m[1]));
    return parser
      .columnList(sql)
      .map((c: string) => c.split("::")[2])
      .filter((c: string) => !aliases.has(c));
  };

  it("filters on the schema's cluster field, so another cluster's span cannot answer", () => {
    const k = serviceAddressSql({ ...full, cluster: "cluster-k" });
    const j = serviceAddressSql({ ...full, cluster: "cluster-j" });

    expect(k).not.toBe(j);
    expect(k).toContain(`"k8s_cluster" = 'cluster-k'`);
    expect(serviceAddressSql({ ...full, cluster: "o'c" })).toContain(`"k8s_cluster" = 'o''c'`);
  });

  it("reads the cluster and namespace a traces stream keeps under its service_ resource prefix", () => {
    const schema = [
      ...without("k8s_cluster").filter((f) => f !== "k8s_namespace_name"),
      "service_k8s_cluster_name",
      "service_k8s_namespace_name",
    ];
    const sql = serviceAddressSql({ ...full, schema })!;

    expect(sql).toContain(`"service_k8s_cluster_name" = 'cluster-k'`);
    expect(sql).toContain(`"service_k8s_namespace_name" = 'ns-a'`);
  });

  it("reads only columns the stream has", () => {
    const sql = serviceAddressSql(full)!;

    expect(columnsOf(sql).filter((c) => !TRACES.includes(c))).toEqual([]);
  });

  it("leaves out a port the stream does not record, so the default-port URL still comes back", () => {
    const schema = without("server_port");
    const sql = serviceAddressSql({ ...full, schema })!;

    expect(sql).toContain("NULL AS server_port");
    expect(columnsOf(sql).filter((c) => !schema.includes(c))).toEqual([]);
  });

  it("is empty when the stream has no address, route or service field", () => {
    for (const field of ["server_address", "http_route", "service_name"])
      expect(serviceAddressSql({ ...full, schema: without(field) }), field).toBeNull();
  });

  it("sends nothing for such a stream, and reads as looked-and-none", () => {
    const run = effectScope();
    const result = run.run(() =>
      useServiceAddress({ ...full, schema: without("server_address") }),
    )!;

    expect(stream).not.toHaveBeenCalled();
    expect(result.address.value).toBeNull();
    expect(result.state.value).toBe("ready");
    run.stop();
  });
});

describe("addressFromRow", () => {
  it("builds the URL a person would type", () => {
    expect(
      addressFromRow({
        server_address: "svc-c.ns-a.svc.cluster.local",
        server_port: 8080,
        http_route: "/healthz",
      }),
    ).toEqual({ url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz", from: "traces" });
    expect(
      addressFromRow({
        server_address: "api.example.com",
        server_port: "443",
        http_route: "ready",
      }),
    ).toEqual({
      url: "https://api.example.com/ready",
      from: "traces",
    });
    expect(
      addressFromRow({ server_address: "svc-c", server_port: 80, http_route: "/livez" })?.url,
    ).toBe("http://svc-c/livez");
  });

  it("is empty without a host or a route", () => {
    expect(addressFromRow(undefined)).toBeNull();
    expect(addressFromRow({ server_address: "", http_route: "/healthz" })).toBeNull();
    expect(addressFromRow({ server_address: "svc-c", http_route: null })).toBeNull();
  });
});

describe("useServiceAddress", () => {
  it("sends one streaming search and reads the newest health route", async () => {
    const run = effectScope();
    const result = run.run(() => useServiceAddress(scope))!;

    expect(stream).toHaveBeenCalledTimes(1);
    const [request] = stream.mock.calls[0];
    expect(request).toMatchObject({ type: "search", org_id: "demo-org", pageType: "traces" });
    expect(b64DecodeUnicode(request.queryReq.query.sql)).toBe(serviceAddressSql(scope));
    expect(request.queryReq.query.end_time - request.queryReq.query.start_time).toBe(
      24 * 3_600_000_000,
    );
    expect(result.state.value).toBe("loading");

    handlersOf().data(
      {},
      hits([{ server_address: "svc-c", server_port: 8080, http_route: "/healthz" }]),
    );
    handlersOf().complete({}, {});
    expect(result.address.value).toEqual({ url: "http://svc-c:8080/healthz", from: "traces" });
    expect(result.state.value).toBe("ready");

    run.stop();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("reads through the streaming composable only, never a one-shot search", () => {
    const source = readFileSync(resolve(__dirname, "./serviceAddress.ts"), "utf8");

    expect(source).toContain('from "@/composables/useStreamingSearch"');
    expect(source).not.toMatch(/services\/search|_search(?!_stream)|_search_multi/);
  });

  it("is null when no span carries an address", () => {
    const run = effectScope();
    const result = run.run(() => useServiceAddress(scope))!;
    handlersOf().data({}, hits([]));
    handlersOf().complete({}, {});

    expect(result.address.value).toBeNull();
    expect(result.state.value).toBe("ready");
    run.stop();
  });

  it("cancels the old query when the service changes, and ignores its late rows", async () => {
    const current = ref<ServiceScope>(scope);
    const run = effectScope();
    const result = run.run(() => useServiceAddress(current))!;
    current.value = { ...scope, service: "svc-d" };
    await nextTick();

    expect(stream).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    handlersOf(0).data(
      {},
      hits([{ server_address: "old", server_port: 1, http_route: "/health" }]),
    );
    expect(result.address.value).toBeNull();
    run.stop();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("reports a failed query as an error, with no address", () => {
    const run = effectScope();
    const result = run.run(() => useServiceAddress(scope))!;
    handlersOf().error({}, {});

    expect(result.state.value).toBe("error");
    expect(result.address.value).toBeNull();
    run.stop();
  });

  it("does not query a stream that has no spans", () => {
    const run = effectScope();
    const result = run.run(() =>
      useServiceAddress({ ...scope, stream: { type: "logs", name: "app_logs" } }),
    )!;

    expect(stream).not.toHaveBeenCalled();
    expect(result.state.value).toBe("idle");
    run.stop();
  });

  it("sends nothing on an OSS build", () => {
    config.isEnterprise = "false";
    const run = effectScope();
    const result = run.run(() => useServiceAddress(scope))!;

    expect(stream).not.toHaveBeenCalled();
    expect(result.address.value).toBeNull();
    run.stop();
  });
});
