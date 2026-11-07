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

import useParser from "@/composables/useParser";

import {
  historySql,
  isNoisy,
  promqlResult,
  queriesPerDay,
  severityOf,
  sqlResult,
  summarize,
} from "./wouldFire";

const STEP = 600;
const promqlAlert = { query_condition: { promql_condition: { operator: ">=", value: 80 } } };
const series = (points: Array<[number, string]>, pod = "a") => ({
  metric: { pod },
  values: points,
});

describe("promqlResult", () => {
  it("counts neighbouring failures as one incident and every failure as a run", () => {
    const result = promqlResult(
      [
        series([
          [0, "90"],
          [600, "90"],
          [1200, "10"],
          [1800, "90"],
        ]),
      ],
      promqlAlert,
      STEP,
    );
    expect(result).toEqual({ incidents: 2, runs: 3, checkedSeconds: 2400, noData: false });
  });

  it("merges a series split across stream chunks", () => {
    const result = promqlResult([series([[0, "90"]]), series([[600, "90"]])], promqlAlert, STEP);
    expect(result.incidents).toBe(1);
  });

  it("reports hours actually covered, with no points as no data rather than zero", () => {
    expect(promqlResult([], promqlAlert, STEP)).toMatchObject({ noData: true, checkedSeconds: 0 });
    expect(promqlResult([series([[0, "NaN"]])], promqlAlert, STEP).noData).toBe(true);
  });
});

describe("sqlResult", () => {
  const alert = { trigger_condition: { operator: ">=", threshold: 3 } };

  it("adds up a bucket reported by two partitions before the threshold", () => {
    const now = Date.now() / 1000;
    const result = sqlResult(
      [
        { time: now - 600, count: 2 },
        { time: now - 600, count: 2 },
      ],
      alert,
      STEP,
      null,
    );
    expect(result.incidents).toBe(1);
  });

  it("treats a quiet stream with old data as checked, an empty one as no data", () => {
    expect(sqlResult([], alert, STEP, 7200)).toMatchObject({
      incidents: 0,
      checkedSeconds: 7200,
      noData: false,
    });
    expect(sqlResult([], alert, STEP, null).noData).toBe(true);
  });

  it("never reports more than the window", () => {
    expect(sqlResult([], alert, STEP, 10 * 86400).checkedSeconds).toBe(86400);
  });
});

describe("summarize", () => {
  const result = (incidents: number, checkedSeconds: number) => ({
    incidents,
    runs: incidents * 2,
    checkedSeconds,
    noData: false,
  });

  it("headlines chosen alerts only and states the left-off ones apart", () => {
    const summary = summarize([
      { chosen: true, result: result(1, 86400) },
      { chosen: false, result: result(3, 86400) },
    ]);
    expect(summary).toMatchObject({ incidents: 1, runs: 2, leftOffIncidents: 3 });
    expect(summary.lowConfidence).toBe(false);
  });

  it("marks under 24 h low confidence and keeps the real span", () => {
    const summary = summarize([{ chosen: true, result: result(1, 2280) }]);
    expect(summary).toMatchObject({ lowConfidence: true, checkedSeconds: 2280, incidents: 1 });
  });
});

describe("noise and cost", () => {
  it("leaves an alert off only above two incidents", () => {
    const base = { runs: 3, checkedSeconds: 60, noData: false };
    expect(isNoisy({ ...base, incidents: 2 })).toBe(false);
    expect(isNoisy({ ...base, incidents: 3 })).toBe(true);
  });

  it("applies the same rule at a full day of history", () => {
    expect(isNoisy({ incidents: 3, runs: 3, checkedSeconds: 86400, noData: false })).toBe(true);
  });

  it("counts queries a day from the frequency", () => {
    const alert = { trigger_condition: { frequency: 5, frequency_type: "minutes" } };
    expect(queriesPerDay([alert, alert])).toBe(576);
  });

  it("maps priority to the two severities the screen routes", () => {
    expect(severityOf({ priority: 1 })).toBe("critical");
    expect(severityOf({ priority: 3 })).toBe("warning");
  });
});

describe("historySql", () => {
  it("buckets a plain alert query by its period and keeps the filter", async () => {
    const parser = await useParser().sqlParser();
    const sql = historySql(parser, "SELECT * FROM \"logs\" WHERE level = 'error' LIMIT 5", 5);
    expect(sql).toContain("histogram");
    expect(sql).toContain("5 minute");
    expect(sql).toContain("level");
    expect(sql).toContain("GROUP BY");
    expect(sql).not.toContain("LIMIT");
  });

  it("declines a query that already aggregates", async () => {
    const parser = await useParser().sqlParser();
    expect(
      historySql(parser, 'SELECT a, count(*) c FROM "logs" GROUP BY a HAVING c > 1', 5),
    ).toBeNull();
  });
});
