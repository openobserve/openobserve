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

import { describe, expect, it } from "vitest";
import type { RcaEvidenceTarget } from "@/services/incidents";
import { b64DecodeUnicode } from "@/utils/formatters";
import {
  rcaBlindSpotFeature,
  rcaBlindSpotRoute,
  rcaEvidenceLink,
  rcaEvidenceQuery,
  type RcaEvidenceLink,
} from "./rcaEvidenceLinks";

const START_US = 1_760_000_000_000_000;
const END_US = START_US + 1_800_000_000;
const SQL = "SELECT count(*) FROM \"checkout_api\" WHERE msg LIKE '%timeout→%'";

/** The logs page decodes `query` with the AI chat's `encodeForUrl` inverse. */
const decodeLogsQuery = (encoded: string) => decodeURIComponent(escape(atob(encoded)));

/** Path or name and query of a link's route; fails the test on a string route. */
function routeOf(link: RcaEvidenceLink | null) {
  const route = link?.route;
  if (!route || typeof route !== "object") throw new Error("no route object");
  return {
    path: "path" in route ? route.path : undefined,
    name: "name" in route ? route.name : undefined,
    query: (route.query ?? {}) as Record<string, string>,
  };
}

describe("rcaEvidenceLink (03 VE29)", () => {
  it("SQL on logs: /logs with stream, sql_mode=true, base64 query, µs from/to and type=rca_evidence_query", () => {
    const link = rcaEvidenceLink(
      { signal: "logs", streams: ["checkout_api"], sql: SQL, start_us: START_US, end_us: END_US },
      "default",
    );

    expect(link?.page).toBe("logs");
    expect(routeOf(link).path).toBe("/logs");
    const q = routeOf(link).query;
    expect(q).toMatchObject({
      org_identifier: "default",
      stream_type: "logs",
      stream: "checkout_api",
      sql_mode: "true",
      from: String(START_US),
      to: String(END_US),
      // Runs on arrival, unlike the AI chat's re-apply-only `ai_chat_query`.
      type: "rca_evidence_query",
    });
    expect(q.query).not.toContain("SELECT");
    expect(decodeLogsQuery(q.query)).toBe(SQL);
    expect(q.period).toBeUndefined();
  });

  it("SQL on metrics or traces keeps the signal as stream_type and label, and joins streams with ','", () => {
    const link = rcaEvidenceLink(
      {
        signal: "traces",
        streams: ["default", "other"],
        sql: "SELECT 1",
        start_us: START_US,
        end_us: END_US,
      },
      "acme",
    );
    expect(link?.page).toBe("traces");
    expect(routeOf(link).path).toBe("/logs");
    expect(routeOf(link).query).toMatchObject({
      org_identifier: "acme",
      stream_type: "traces",
      stream: "default,other",
    });
  });

  it("PromQL: metricsEditor with base64 query, query_type=promql and ms from/to", () => {
    const promql = 'max(db_pool_in_use{db="orders"})';
    const link = rcaEvidenceLink(
      { signal: "metrics", streams: [], promql, start_us: START_US, end_us: END_US },
      "default",
    );

    expect(link?.page).toBe("metrics");
    expect(routeOf(link).name).toBe("metricsEditor");
    const q = routeOf(link).query;
    expect(q).toMatchObject({
      org_identifier: "default",
      query_type: "promql",
      from: String(START_US / 1000),
      to: String(END_US / 1000),
    });
    expect(q.query).not.toContain("db_pool");
    expect(b64DecodeUnicode(q.query)).toBe(promql);
  });

  it("Traces: the traces page with the plain filter, the first stream and µs from/to", () => {
    const filter = "service_name='checkout-api' AND status_code=500";
    const link = rcaEvidenceLink(
      { signal: "traces", streams: ["default"], filter, start_us: START_US, end_us: END_US },
      "default",
    );

    expect(link?.page).toBe("traces");
    expect(routeOf(link).name).toBe("traces");
    expect(routeOf(link).query).toEqual({
      org_identifier: "default",
      stream: "default",
      filter,
      from: String(START_US),
      to: String(END_US),
    });
  });

  it("Traces: an unfiltered call (stream + range only) opens the stream with an empty filter", () => {
    const link = rcaEvidenceLink(
      { signal: "traces", streams: ["default"], start_us: START_US, end_us: END_US },
      "default",
    );

    expect(link?.page).toBe("traces");
    expect(routeOf(link).query).toEqual({
      org_identifier: "default",
      stream: "default",
      filter: "",
      from: String(START_US),
      to: String(END_US),
    });
  });

  it.each<[string, RcaEvidenceTarget]>([
    ["SQL", { signal: "logs", streams: ["s"], sql: "SELECT 1" }],
    ["PromQL", { signal: "metrics", streams: [], promql: "up" }],
    ["traces", { signal: "traces", streams: ["default"], filter: "x=1" }],
    [
      "half a range",
      { signal: "logs", streams: ["s"], sql: "SELECT 1", start_us: START_US, end_us: undefined },
    ],
  ])("%s with no time range uses period=1h and no from/to", (_name, target) => {
    const q = routeOf(rcaEvidenceLink(target, "default")).query;
    expect(q.period).toBe("1h");
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
  });

  it.each<[string, RcaEvidenceTarget]>([
    ["change", { signal: "change", streams: [] }],
    ["infra", { signal: "infra", streams: ["prod"] }],
    ["context", { signal: "context", streams: ["checkout_api"] }],
    ["unclassified", { signal: "unclassified", streams: [] }],
    ["traces with neither a filter nor a stream", { signal: "traces", streams: [] }],
    ["unclassified SQL (ExecuteCode)", { signal: "unclassified", streams: [], sql: "SELECT 1" }],
    ["a filter on a non-traces signal", { signal: "logs", streams: [], filter: "x=1" }],
    ["a change command", { signal: "change", streams: [], command: "gh pr diff 812" }],
    ["an infra command", { signal: "infra", streams: [], command: "kubectl get pods -n checkout" }],
  ])("%s has no link", (_name, target) => {
    expect(rcaEvidenceLink(target, "default")).toBeNull();
  });
});

describe("rcaEvidenceQuery (Copy query)", () => {
  it.each<[RcaEvidenceTarget, string | null]>([
    [{ signal: "logs", streams: [], sql: "SELECT 1" }, "SELECT 1"],
    [{ signal: "metrics", streams: [], promql: "up" }, "up"],
    [{ signal: "traces", streams: [], filter: "x=1" }, "x=1"],
    [{ signal: "change", streams: [], command: "gh pr diff 812" }, "gh pr diff 812"],
    [{ signal: "infra", streams: [], command: "kubectl get pods" }, "kubectl get pods"],
    [{ signal: "change", streams: [] }, null],
    [{ signal: "logs", streams: [], sql: "" }, null],
  ])("%j copies %s", (target, expected) => {
    expect(rcaEvidenceQuery(target)).toBe(expected);
  });
});

describe("rcaBlindSpotRoute (03 VE37)", () => {
  it.each([
    ["connect_toolset", "aiToolsets"],
    ["ingest_data", "ingestion"],
    ["open_pipeline", "pipelines"],
    ["sampling_rules", "pipelines"],
  ] as const)("%s opens %s", (fix, name) => {
    expect(rcaBlindSpotRoute(fix, "default")).toEqual({
      name,
      query: { org_identifier: "default" },
    });
  });

  it.each(["resume_run", "none"] as const)("%s has no button", (fix) => {
    expect(rcaBlindSpotRoute(fix, "default")).toBeNull();
  });
});

describe("rcaBlindSpotFeature", () => {
  it.each([
    ["connect_toolset", "ai_toolsets"],
    ["open_pipeline", "pipelines"],
    ["sampling_rules", "pipelines"],
    ["ingest_data", null],
    ["resume_run", null],
    ["none", null],
  ] as const)("%s is licensed under %s", (fix, feature) => {
    expect(rcaBlindSpotFeature(fix)).toBe(feature);
  });
});
