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

import { describe, it, expect } from "vitest";
import { addSearchClause, equalsClause, searchFilterSql, traceListSql } from "./llmInsightsDrill";
import { autoHistogramBucketMicros } from "./config/llmInsightsPanels";

const HOUR = 3_600_000_000;

describe("insights search filter (AIO-26)", () => {
  it("narrows by trace, so a model filter keeps the trace's tool spans", () => {
    expect(searchFilterSql("default", " gen_ai_response_model = 'gpt-4o' ")).toBe(
      `trace_id IN (SELECT trace_id FROM "default" WHERE (gen_ai_response_model = 'gpt-4o'))`,
    );
    expect(searchFilterSql("s", "  ")).toBe("");
  });

  it("adds a clicked value as a quoted clause, once", () => {
    const clause = equalsClause("user", "o'k");
    expect(clause).toBe("user_id = 'o''k'");
    expect(addSearchClause("", clause)).toBe(clause);
    expect(addSearchClause("a = 1", clause)).toBe("a = 1 and user_id = 'o''k'");
    expect(addSearchClause("a = 1 and user_id = 'o''k'", clause)).toBe(
      "a = 1 and user_id = 'o''k'",
    );
  });

  it("wraps a search with an OR so the clause narrows all of it", () => {
    expect(addSearchClause("a = 1 OR b = 2", "c = 3")).toBe("(a = 1 OR b = 2) and c = 3");
  });
});

describe("traceListSql", () => {
  it("selects the traces that have the clicked series", () => {
    const sql = traceListSql(
      "s",
      { startTime: 0, endTime: 1, seriesSql: "gen_ai_response_model", seriesValue: "m" },
      "gen_ai_agent_name = 'a'",
    );
    expect(sql).toContain("WHERE gen_ai_agent_name = 'a' GROUP BY trace_id HAVING");
    expect(sql).toContain(
      "HAVING max(CASE WHEN gen_ai_response_model = 'm' THEN 1 ELSE 0 END) = 1",
    );
    expect(sql).toMatch(/ORDER BY ts DESC LIMIT 50$/);
  });

  // A failing tool: the tool's own span must be the one that errored, not any
  // span of a trace that also calls the tool.
  it("needs one span that is both the series and errored", () => {
    const sql = traceListSql(
      "s",
      {
        startTime: 0,
        endTime: 1,
        seriesSql: "gen_ai_tool_name",
        seriesValue: "grep",
        errored: true,
      },
      "",
    );
    expect(sql).toContain(
      "HAVING max(CASE WHEN gen_ai_tool_name = 'grep' AND span_status = 'ERROR' THEN 1 ELSE 0 END) = 1",
    );
    expect(sql).not.toContain("AND max(");
  });

  it("selects the errored traces when there is no series", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1, errored: true }, "");
    expect(sql).toContain("HAVING max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) = 1");
  });

  it("selects the traces without an errored span (the OK part of a bar)", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1, errored: false }, "");
    expect(sql).toContain("HAVING max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) = 0");
  });

  it("has no HAVING for a whole-window list", () => {
    expect(traceListSql("s", { startTime: 0, endTime: 1 }, "")).not.toContain("HAVING");
  });
});

describe("autoHistogramBucketMicros", () => {
  it("mirrors the backend's auto histogram widths", () => {
    expect(autoHistogramBucketMicros(0, 24 * HOUR)).toBe(HOUR);
    expect(autoHistogramBucketMicros(0, 3 * HOUR)).toBe(60_000_000);
    expect(autoHistogramBucketMicros(0, 15 * 60_000_000)).toBe(10_000_000);
    expect(autoHistogramBucketMicros(0, 30 * 24 * HOUR)).toBe(12 * HOUR);
  });
});
