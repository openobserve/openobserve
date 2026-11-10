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
import {
  addSearchClause,
  equalsClause,
  searchFilterSql,
  traceListSql,
  traceRowTimeFormat,
} from "./llmInsightsDrill";
import { agentParentsJoin, autoHistogramBucketMicros } from "./config/llmInsightsPanels";
import { traceUsageSum } from "./llmAttribution";

const HOUR = 3_600_000_000;

describe("insights search filter", () => {
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
      true,
    );
    expect(sql).toContain("WHERE gen_ai_agent_name = 'a' GROUP BY trace_id HAVING");
    expect(sql).toContain(
      "HAVING max(CASE WHEN gen_ai_response_model = 'm' THEN 1 ELSE 0 END) = 1",
    );
    expect(sql).toMatch(/ORDER BY ts DESC LIMIT 50$/);
  });

  // The tool's own span must be the one that errored, not any span of a trace calling it.
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
      true,
    );
    expect(sql).toContain(
      "HAVING max(CASE WHEN gen_ai_tool_name = 'grep' AND span_status = 'ERROR' THEN 1 ELSE 0 END) = 1",
    );
    expect(sql).not.toContain("AND max(");
  });

  it("selects the errored traces when there is no series", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1, errored: true }, "", true);
    expect(sql).toContain("HAVING max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) = 1");
  });

  it("selects the traces without an errored span (the OK part of a bar)", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1, errored: false }, "", true);
    expect(sql).toContain("HAVING max(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) = 0");
  });

  it("has no HAVING for a whole-window list", () => {
    expect(traceListSql("s", { startTime: 0, endTime: 1 }, "", true)).not.toContain("HAVING");
  });

  // The drawer costs a trace as the tiles do, top-level agents included.
  it("costs each trace by the per-trace usage rule over the agent-parent join", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1 }, "gen_ai_agent_name = 'a'", true);
    expect(sql).not.toContain("SUM(gen_ai_usage_cost)");
    expect(sql).toContain(`${traceUsageSum("gen_ai_usage_cost")} AS cost`);
    expect(sql).toContain(
      `FROM "s"${agentParentsJoin("s", true)} WHERE gen_ai_agent_name = 'a' GROUP BY trace_id`,
    );
    const flat = traceListSql("s", { startTime: 0, endTime: 1 }, "", false);
    expect(flat).toContain(`FROM "s"${agentParentsJoin("s", false)} GROUP BY trace_id`);
  });

  it("lists only agent-span-only traces for the cost trend's unattributed series", () => {
    const sql = traceListSql("s", { startTime: 0, endTime: 1, agentOnly: true }, "", true);
    expect(sql).toMatch(/HAVING CASE WHEN COALESCE\(SUM\(.*\), 0\) = 0 THEN .* > 0/);
    expect(sql).toContain("AND agent_parent_span IS NULL");
  });
});

describe("traceRowTimeFormat", () => {
  // 2026-11-05 22:00 UTC, in µs.
  const t0 = Date.UTC(2026, 10, 5, 22) * 1000;
  it("dates the rows when the window spans more than one calendar day", () => {
    expect(traceRowTimeFormat({ startTime: t0, endTime: t0 + HOUR }, "UTC")).toBe("HH:mm:ss");
    expect(traceRowTimeFormat({ startTime: t0, endTime: t0 + 3 * HOUR }, "UTC")).toBe(
      "MMM d HH:mm:ss",
    );
    expect(traceRowTimeFormat({ startTime: t0, endTime: t0 + 7 * 24 * HOUR }, "UTC")).toBe(
      "MMM d HH:mm:ss",
    );
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
