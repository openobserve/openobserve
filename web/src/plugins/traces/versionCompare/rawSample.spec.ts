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

import { describe, it, expect, vi } from "vitest";
import { buildRawSampleSql, fetchRawSample } from "./rawSample";

describe("buildRawSampleSql", () => {
  it("contains ORDER BY rand() and the requested LIMIT", () => {
    const sql = buildRawSampleSql("default", "", 1000, 2000, 2000);
    expect(sql).toContain("ORDER BY rand()");
    expect(sql).toContain("LIMIT 2000");
  });

  it("splices a non-empty agent filter with AND (<filter>)", () => {
    const sql = buildRawSampleSql(
      "default",
      "gen_ai_agent_id = 'abc'",
      1000,
      2000,
      2000,
    );
    expect(sql).toContain(" AND (gen_ai_agent_id = 'abc')");
  });

  it("omits the agent clause when the filter is empty", () => {
    const sql = buildRawSampleSql("default", "", 1000, 2000, 2000);
    expect(sql).not.toContain("AND ()");
    expect(sql).not.toMatch(/AND \(\s*\)/);
  });

  it("never emits a bare LIMIT without random ordering preceding it", () => {
    const sql = buildRawSampleSql("default", "gen_ai_agent_id = 'abc'", 1000, 2000, 500);
    // The only LIMIT in the query must be immediately preceded by
    // "ORDER BY rand() " — i.e. random ordering is always applied before
    // truncation, never a first/last-N slice.
    const limitIndex = sql.indexOf("LIMIT");
    expect(limitIndex).toBeGreaterThan(-1);
    const precedingText = sql.slice(0, limitIndex);
    expect(precedingText.endsWith("ORDER BY rand() ")).toBe(true);
  });

  it("uses gen_ai_usage_cost aliased as cost — matching useLLMInsights' KPI cost column", () => {
    // useLLMInsights.fetchSummary computes totalCost via
    // `COALESCE(SUM(gen_ai_usage_cost), 0) as total_cost` — the per-span
    // column feeding that sum is `gen_ai_usage_cost`. The raw sample must
    // select the same column (unaggregated) so bootstrap cost samples are
    // consistent with the KPI card.
    const sql = buildRawSampleSql("default", "", 1000, 2000, 2000);
    expect(sql).toContain("gen_ai_usage_cost as cost");
  });

  it("filters to LLM spans via gen_ai_operation_name IS NOT NULL", () => {
    const sql = buildRawSampleSql("default", "", 1000, 2000, 2000);
    expect(sql).toContain("gen_ai_operation_name IS NOT NULL");
  });

  it("scopes the time window on _timestamp", () => {
    const sql = buildRawSampleSql("mystream", "", 111, 222, 50);
    expect(sql).toContain('FROM "mystream"');
    expect(sql).toContain("_timestamp >= 111");
    expect(sql).toContain("_timestamp <= 222");
  });
});

describe("fetchRawSample", () => {
  it("builds the SQL, runs it via the injected runner, and maps hits to parallel arrays", async () => {
    const runner = vi.fn().mockResolvedValue([
      { duration: 100, cost: 0.5 },
      { duration: "200", cost: "1.25" },
      { duration: null, cost: undefined },
    ]);

    const result = await fetchRawSample("default", "", 1000, 2000, runner, 2000);

    expect(runner).toHaveBeenCalledTimes(1);
    const [sqlArg] = runner.mock.calls[0];
    expect(sqlArg).toContain("ORDER BY rand()");
    expect(sqlArg).toContain("LIMIT 2000");

    expect(result.durations).toEqual([100, 200, 0]);
    expect(result.costs).toEqual([0.5, 1.25, 0]);
  });

  it("defaults cap to SAMPLE_CAP when not provided", async () => {
    const runner = vi.fn().mockResolvedValue([]);
    await fetchRawSample("default", "", 1000, 2000, runner);
    const [sqlArg] = runner.mock.calls[0];
    expect(sqlArg).toContain("LIMIT 2000");
  });
});
