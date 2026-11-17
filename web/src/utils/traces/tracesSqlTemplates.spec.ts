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
import { tracesSqlTemplates } from "./tracesSqlTemplates";

const ids = (list: { id: string }[]) => list.map((tpl) => tpl.id);
const byId = (list: { id: string; sql: string }[], id: string) =>
  list.find((tpl) => tpl.id === id)!;

const HEAD =
  "SELECT trace_id, min(_timestamp) AS first_seen,\n" +
  "  count(*) AS spans,\n" +
  "  sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors,\n" +
  "  (max(end_time) - min(start_time)) / 1000000 AS duration_ms";

describe("tracesSqlTemplates: Trace questions", () => {
  const list = tracesSqlTemplates("otel_demo", {
    services: ["frontend", "cart", "checkout"],
    fields: [],
  });

  it("lists Trace questions first, then Span summaries", () => {
    expect(ids(list)).toEqual([
      "slowTraces",
      "bigTraces",
      "errorsInTwoServices",
      "nPlusOne",
      "missingSpan",
      "manyServices",
      "p95ByVersion",
      "p95ByOperation",
      "spansPerMinute",
      "nullAudit",
    ]);
    expect(list.map((tpl) => tpl.group)).toEqual([
      ...Array(6).fill("traceQuestions"),
      ...Array(4).fill("spanSummaries"),
    ]);
  });

  it("returns one summary row per trace, sorted, capped at 100", () => {
    expect(byId(list, "slowTraces").sql).toBe(
      `${HEAD}\nFROM "otel_demo"\nGROUP BY trace_id\nHAVING max(end_time) - min(start_time) > 2000000000\nORDER BY duration_ms DESC\nLIMIT 100`,
    );
    expect(byId(list, "bigTraces").sql).toBe(
      `${HEAD}\nFROM "otel_demo"\nGROUP BY trace_id\nHAVING count(*) > 200\nORDER BY spans DESC\nLIMIT 100`,
    );
    expect(byId(list, "nPlusOne").sql).toBe(
      `${HEAD}\nFROM "otel_demo"\nWHERE span_kind = '3'\nGROUP BY trace_id, reference_parent_span_id\nHAVING count(*) > 50\nORDER BY spans DESC\nLIMIT 100`,
    );
    expect(byId(list, "manyServices").sql).toBe(
      `${HEAD},\n  count(DISTINCT service_name) AS services\nFROM "otel_demo"\nGROUP BY trace_id\nHAVING count(DISTINCT service_name) >= 5\nORDER BY services DESC\nLIMIT 100`,
    );
  });

  it("counts DISTINCT services only in Crosses 5+ services", () => {
    for (const tpl of list.filter((t) => t.group === "traceQuestions" && t.id !== "manyServices")) {
      expect(tpl.sql).not.toContain("DISTINCT");
      expect(tpl.sql).not.toContain("AS services");
    }
  });

  it("fills the first two services of the stream and marks them", () => {
    const errors = byId(list, "errorsInTwoServices");
    expect(errors.sql).toBe(
      `${HEAD}\nFROM "otel_demo"\nGROUP BY trace_id\nHAVING sum(CASE WHEN service_name = 'frontend'\n  AND span_status = 'ERROR' THEN 1 ELSE 0 END) > 0\n  AND sum(CASE WHEN service_name = 'cart'\n  THEN 1 ELSE 0 END) > 0\nORDER BY errors DESC\nLIMIT 100`,
    );
    expect(errors.services).toEqual(["frontend", "cart"]);
    const missing = byId(list, "missingSpan");
    expect(missing.sql).toBe(
      `${HEAD}\nFROM "otel_demo"\nGROUP BY trace_id\nHAVING sum(CASE WHEN service_name = 'frontend'\n  THEN 1 ELSE 0 END) > 0\n  AND sum(CASE WHEN service_name = 'cart'\n  THEN 1 ELSE 0 END) = 0\nORDER BY spans DESC\nLIMIT 100`,
    );
    expect(missing.services).toEqual(["frontend", "cart"]);
    expect(byId(list, "bigTraces").services).toEqual([]);
  });

  it("escapes quotes in stream and service names", () => {
    const odd = tracesSqlTemplates('we"ird', { services: ["o'neil", "b"], fields: [] });
    expect(byId(odd, "bigTraces").sql).toContain(`FROM "we""ird"`);
    expect(byId(odd, "missingSpan").sql).toContain(`service_name = 'o''neil'`);
  });

  it("falls back to placeholder names when the stream has fewer than two services", () => {
    const one = tracesSqlTemplates("a", { services: ["api"], fields: [] });
    expect(byId(one, "errorsInTwoServices").services).toEqual(["api", "service-b"]);
    const none = tracesSqlTemplates("a", { services: [], fields: [] });
    expect(byId(none, "missingSpan").services).toEqual(["service-a", "service-b"]);
  });
});

describe("tracesSqlTemplates: Span summaries", () => {
  it("lists the four aggregate templates without gen_ai or llm fields", () => {
    const list = tracesSqlTemplates("otel_demo", {
      services: [],
      fields: ["duration", "service_name"],
    }).filter((tpl) => tpl.group === "spanSummaries");
    expect(ids(list)).toEqual(["p95ByVersion", "p95ByOperation", "spansPerMinute", "nullAudit"]);
    expect(byId(list, "p95ByVersion").sql).toBe(
      `SELECT service_service_version,\n  approx_percentile_cont(duration, 0.95) AS p95\nFROM "otel_demo" GROUP BY service_service_version`,
    );
    expect(byId(list, "p95ByOperation").sql).toBe(
      `SELECT operation_name,\n  approx_percentile_cont(duration, 0.95) AS p95\nFROM "otel_demo" GROUP BY operation_name\nORDER BY p95 DESC LIMIT 10`,
    );
    expect(byId(list, "spansPerMinute").sql).toBe(
      `SELECT histogram(_timestamp, '1 minute') AS t,\n  service_name, count(*) AS spans\nFROM "otel_demo" GROUP BY t, service_name`,
    );
    expect(byId(list, "nullAudit").sql).toBe(
      `SELECT service_name, count(*) AS spans,\n  count(DISTINCT operation_name) AS operations,\n  sum(CASE WHEN http_status_code IS NULL\n  THEN 1 ELSE 0 END) AS no_status\nFROM "otel_demo" GROUP BY service_name`,
    );
  });

  it("adds Tokens by model only when the schema has the fields its SQL reads", () => {
    const genAi = tracesSqlTemplates("default", {
      services: [],
      fields: ["gen_ai_request_model", "gen_ai_usage_input_tokens"],
    });
    expect(ids(genAi).at(-1)).toBe("tokensByModel");
    expect(byId(genAi, "tokensByModel").sql).toBe(
      `SELECT gen_ai_request_model,\n  sum(gen_ai_usage_input_tokens) AS input_tokens\nFROM "default" GROUP BY gen_ai_request_model`,
    );
    const llm = tracesSqlTemplates("default", { services: [], fields: ["llm_model"] });
    expect(ids(llm)).not.toContain("tokensByModel");
    const modelOnly = tracesSqlTemplates("default", {
      services: [],
      fields: ["gen_ai_request_model", "gen_ai_usage_output_tokens"],
    });
    expect(ids(modelOnly)).not.toContain("tokensByModel");
    const neither = tracesSqlTemplates("default", {
      services: [],
      fields: ["my_gen_ai_note"],
    });
    expect(ids(neither)).not.toContain("tokensByModel");
  });
});
