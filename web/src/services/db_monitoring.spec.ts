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

import dbMonitoringService from "./db_monitoring";
import http from "./http";

vi.mock("./http", () => {
  const mockClient = { get: vi.fn() };
  return { default: vi.fn(() => mockClient) };
});

/**
 * The activity endpoint's params are pinned against the Rust `ActivityQuery`
 * struct (`api.rs`), which deserializes exactly: start_time, end_time, stream,
 * system, instance, database|namespace, limit. A key this file spells
 * differently is silently DROPPED by serde — the request still 200s with an
 * unfiltered result, so a typo here fails as wrong data rather than as an error.
 */
describe("db_monitoring service · getActivity", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("GETs the activity endpoint under the org", () => {
    dbMonitoringService.getActivity("myorg");
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/myorg/traces/db_monitoring/activity",
      expect.anything(),
    );
  });

  it("sends camelCase options as the snake_case params the handler reads", () => {
    dbMonitoringService.getActivity("myorg", {
      startTime: 1_754_880_000_000_000,
      endTime: 1_754_883_600_000_000,
      stream: "dbm_server",
      system: "postgresql",
      instance: "orders-db.prod.internal",
      namespace: "orders",
      limit: 100,
    });
    expect(paramsOf()).toEqual({
      start_time: 1_754_880_000_000_000,
      end_time: 1_754_883_600_000_000,
      stream: "dbm_server",
      system: "postgresql",
      instance: "orders-db.prod.internal",
      namespace: "orders",
      limit: 100,
    });
  });

  it("sends no params at all when the caller passed no options", () => {
    dbMonitoringService.getActivity("myorg");
    expect(paramsOf()).toEqual({});
  });

  /**
   * `all` is the UI's "no filter" sentinel. Letting it reach the backend turns
   * a cleared dropdown into a filter for a database literally named `all`,
   * which matches nothing — an empty page that looks like a healthy one.
   */
  it("filters the UI's `all` sentinel out of every filter param", () => {
    dbMonitoringService.getActivity("myorg", {
      system: "all",
      instance: "all",
      namespace: "all",
    });
    expect(paramsOf()).toEqual({});
  });

  it("drops empty and nullish values rather than sending blanks", () => {
    dbMonitoringService.getActivity("myorg", {
      system: "",
      instance: undefined,
      stream: "",
      startTime: undefined,
    });
    expect(paramsOf()).toEqual({});
  });

  /**
   * The negative control for the sentinel filter above, which would otherwise
   * pass trivially against an implementation that drops everything. Each filter
   * is exercised on its own so a hardcoded skip of one of them is visible.
   */
  it.each([
    ["system", "mysql"],
    ["instance", "orders-db.prod.internal"],
    ["namespace", "orders"],
    ["stream", "dbm_server"],
  ])("keeps a genuine %s value", (key, value) => {
    dbMonitoringService.getActivity("myorg", { [key]: value });
    expect(paramsOf()).toEqual({ [key]: value });
  });

  it("keeps the real filters while dropping only the sentinel ones", () => {
    dbMonitoringService.getActivity("myorg", {
      system: "mysql",
      instance: "all",
      namespace: "orders",
    });
    expect(paramsOf()).toEqual({ system: "mysql", namespace: "orders" });
  });

  /**
   * `ActivityQuery` accepts `database` OR `namespace` and prefers `database`.
   * Every sibling method spells it `namespace`, so this one must too — a
   * divergent spelling still works against the backend and is therefore
   * invisible until someone greps for the param.
   */
  it("spells the database filter `namespace`, as its sibling endpoints do", () => {
    dbMonitoringService.getActivity("myorg", { namespace: "orders" });
    expect(paramsOf()).toHaveProperty("namespace", "orders");
    expect(paramsOf()).not.toHaveProperty("database");
  });

  /** `limit: 0` is a real value the handler clamps; it must not be dropped. */
  it("does not drop a zero limit as if it were absent", () => {
    dbMonitoringService.getActivity("myorg", { limit: 0 });
    expect(paramsOf()).toEqual({ limit: 0 });
  });
});

/**
 * The plans endpoint's params are pinned against the Rust `PlansQuery` struct
 * (`api.rs`): fingerprint, stream, start_time, end_time. Both fingerprint and
 * stream are REQUIRED server-side — a missing one is a 400, not an unfiltered
 * scan.
 */
describe("db_monitoring service · getQueryPlans", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("GETs the plans endpoint under the org", () => {
    dbMonitoringService.getQueryPlans("myorg", { fingerprint: "3a74e60b4bd45cc6" });
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/myorg/traces/db_monitoring/query/plans",
      expect.anything(),
    );
  });

  it("always sends the fingerprint, which the handler requires", () => {
    dbMonitoringService.getQueryPlans("myorg", { fingerprint: "3a74e60b4bd45cc6" });
    expect(paramsOf()).toEqual({ fingerprint: "3a74e60b4bd45cc6" });
  });

  it("omits the stream so the handler applies its own default", () => {
    // The server-vantage stream name is a backend constant; sending a guess
    // from the UI would break the moment the default changed.
    dbMonitoringService.getQueryPlans("myorg", { fingerprint: "fp" });
    expect(paramsOf()).not.toHaveProperty("stream");
  });

  it("passes an explicit stream through when the caller names one", () => {
    dbMonitoringService.getQueryPlans("myorg", { fingerprint: "fp", stream: "custom_dbm" });
    expect(paramsOf().stream).toBe("custom_dbm");
  });

  it("sends camelCase options as the snake_case params the handler reads", () => {
    dbMonitoringService.getQueryPlans("myorg", {
      fingerprint: "fp",
      startTime: 1_754_880_000_000_000,
      endTime: 1_754_883_600_000_000,
    });
    expect(paramsOf()).toEqual({
      fingerprint: "fp",
      start_time: 1_754_880_000_000_000,
      end_time: 1_754_883_600_000_000,
    });
  });

  it("omits an absent window rather than sending blanks", () => {
    dbMonitoringService.getQueryPlans("myorg", { fingerprint: "fp" });
    expect(paramsOf()).not.toHaveProperty("start_time");
    expect(paramsOf()).not.toHaveProperty("end_time");
  });
});

/**
 * The overview's opt-in per-instance split. Pinned against the Rust
 * `DatabasesQuery` struct: `include_breakdown` is the exact key serde reads,
 * and a key spelled differently is silently DROPPED — the request still 200s,
 * just without the section, so every expanded row would show a load error and
 * nothing would say why.
 */
describe("db_monitoring service · getDatabases", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("asks for the breakdown section only when the caller wants it", () => {
    dbMonitoringService.getDatabases("myorg", { includeBreakdown: true });
    expect(paramsOf().include_breakdown).toBe("true");
  });

  /**
   * A `false` on the wire and an absent param mean the same thing to the
   * server, and the shorter URL is the honest one — the same convention
   * `include_indexes` follows.
   */
  it("omits the flag entirely when the caller did not ask", () => {
    dbMonitoringService.getDatabases("myorg", { includeBreakdown: false });
    expect(paramsOf()).not.toHaveProperty("include_breakdown");
    dbMonitoringService.getDatabases("myorg", {});
    expect((mockClient.get as ReturnType<typeof vi.fn>).mock.calls[1][1].params).not.toHaveProperty(
      "include_breakdown",
    );
  });
});

/**
 * The per-query slow-samples scope. This param is what let the query detail
 * page STOP building raw SQL in the browser, so a typo here does not merely
 * lose a filter — it silently returns the slowest calls across every query in
 * the org under a heading naming one statement.
 */
describe("db_monitoring service · getSamples", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("GETs the samples endpoint under the org", () => {
    dbMonitoringService.getSamples("myorg");
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/myorg/traces/db_monitoring/samples",
      expect.anything(),
    );
  });

  it("sends the fingerprint scope as the param the handler reads", () => {
    dbMonitoringService.getSamples("myorg", {
      fingerprint: "deadbeef",
      stream: "otel_demo",
      startTime: 1_754_880_000_000_000,
      endTime: 1_754_883_600_000_000,
      limit: 100,
    });
    expect(paramsOf()).toEqual({
      fingerprint: "deadbeef",
      stream: "otel_demo",
      start_time: 1_754_880_000_000_000,
      end_time: 1_754_883_600_000_000,
      limit: 100,
    });
  });

  /** The global FR-6 list is the unscoped call and must stay unscoped. */
  it("omits the fingerprint when the caller wants the global list", () => {
    dbMonitoringService.getSamples("myorg", { limit: 50 });
    expect(paramsOf()).not.toHaveProperty("fingerprint");
  });
});

/**
 * The query-detail page's merged Logs-side pair. `engine` and `database` are
 * the server-metrics join key: omitting either is MEANINGFUL — it tells the
 * server not to run that read — so a blank must never be sent in their place,
 * or the request becomes a 400 where it should have been a null section.
 */
describe("db_monitoring service · getQueryInsights", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("GETs the merged endpoint under the org", () => {
    dbMonitoringService.getQueryInsights("myorg", { fingerprint: "fp" });
    expect(mockClient.get).toHaveBeenCalledWith(
      "/api/myorg/traces/db_monitoring/query/insights",
      expect.anything(),
    );
  });

  it("sends the fingerprint, the window and the whole join key", () => {
    dbMonitoringService.getQueryInsights("myorg", {
      fingerprint: "fp",
      engine: "postgresql",
      database: "orders",
      startTime: 1_754_880_000_000_000,
      endTime: 1_754_883_600_000_000,
    });
    expect(paramsOf()).toEqual({
      fingerprint: "fp",
      engine: "postgresql",
      database: "orders",
      start_time: 1_754_880_000_000_000,
      end_time: 1_754_883_600_000_000,
    });
  });

  /**
   * The instance is deliberately NOT part of the key: behind a connection
   * pooler the client records the pooler's address while the server records
   * the real host, so an instance-keyed join drops every match.
   */
  it("never sends an instance", () => {
    dbMonitoringService.getQueryInsights("myorg", {
      fingerprint: "fp",
      engine: "postgresql",
      database: "orders",
    });
    expect(paramsOf()).not.toHaveProperty("instance");
  });

  /** No join key: the params carry the fingerprint alone and nothing blank. */
  it("omits an absent join key rather than sending blanks", () => {
    dbMonitoringService.getQueryInsights("myorg", { fingerprint: "fp" });
    expect(paramsOf()).toEqual({ fingerprint: "fp" });
  });

  /**
   * The server-vantage stream is a backend constant; sending a guess from the
   * UI would break the moment the default changed.
   */
  it("lets the stream default, and passes an explicit one through", () => {
    dbMonitoringService.getQueryInsights("myorg", { fingerprint: "fp" });
    expect(paramsOf()).not.toHaveProperty("stream");
    dbMonitoringService.getQueryInsights("myorg", { fingerprint: "fp", stream: "custom_dbm" });
    expect((mockClient.get as ReturnType<typeof vi.fn>).mock.calls[1][1].params.stream).toBe(
      "custom_dbm",
    );
  });
});

/**
 * The history endpoint's folded calling-endpoints section. Endpoints REQUIRES a
 * trace stream, and the stream this page uses is the one history itself
 * resolves — so the flag is what lets one request answer both, instead of the
 * second waiting on the first to learn where to read.
 */
describe("db_monitoring service · getQueryHistory", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("asks for the endpoints section only when the caller wants it", () => {
    dbMonitoringService.getQueryHistory("myorg", { fingerprint: "fp", includeEndpoints: true });
    expect(paramsOf().include_endpoints).toBe("true");
  });

  it("omits the flag entirely when the caller did not ask", () => {
    dbMonitoringService.getQueryHistory("myorg", { fingerprint: "fp" });
    expect(paramsOf()).not.toHaveProperty("include_endpoints");
    expect(paramsOf()).not.toHaveProperty("endpoints_limit");
  });

  it("passes an explicit endpoints cap through", () => {
    dbMonitoringService.getQueryHistory("myorg", {
      fingerprint: "fp",
      includeEndpoints: true,
      endpointsLimit: 25,
    });
    expect(paramsOf().endpoints_limit).toBe(25);
  });
});

/**
 * The zero-trace fallback flag on both trace-derived list endpoints.
 *
 * A typo here does not lose a filter — it loses the ENTIRE answer on the
 * deployment the fallback exists for: the collector is wired, the databases are
 * reporting, and the page renders "no data" because the section it needed never
 * came back.
 */
describe("db_monitoring service · include_server_fallback", () => {
  const mockClient = (http as unknown as ReturnType<typeof vi.fn>)();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const paramsOf = () => (mockClient.get as ReturnType<typeof vi.fn>).mock.calls[0][1].params;

  it("getQueries sends the flag when asked", () => {
    dbMonitoringService.getQueries("myorg", { includeServerFallback: true });
    expect(paramsOf().include_server_fallback).toBe("true");
  });

  it("getSamples sends the flag when asked", () => {
    dbMonitoringService.getSamples("myorg", { includeServerFallback: true });
    expect(paramsOf().include_server_fallback).toBe("true");
  });

  it("neither sends it unasked", () => {
    dbMonitoringService.getQueries("myorg", {});
    expect(paramsOf()).not.toHaveProperty("include_server_fallback");
    dbMonitoringService.getSamples("myorg", { includeServerFallback: false });
    expect((mockClient.get as ReturnType<typeof vi.fn>).mock.calls[1][1].params).not.toHaveProperty(
      "include_server_fallback",
    );
  });
});
