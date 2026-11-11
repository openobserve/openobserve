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
import {
  bucketMs,
  errorSeries,
  judgeOutcomeSql,
  judgeSpendSql,
  matchedSinceSql,
  scoreSeriesSql,
  scoresStopped,
  spendPoints,
  stoppedSinceUs,
  workloadBucket,
} from "./jobWorkload";

const HOUR_US = 3_600_000_000;
const MIN_US = 60_000_000;

describe("workload series", () => {
  it("keeps the window to about 60 buckets", () => {
    expect(workloadBucket(0, 6 * HOUR_US).interval).toBe("10 minute");
    expect(workloadBucket(0, HOUR_US).interval).toBe("1 minute");
    expect(workloadBucket(0, 24 * HOUR_US).interval).toBe("30 minute");
    expect(workloadBucket(0, 365 * 24 * HOUR_US).interval).toBe("1 day");
  });

  it("reads lag and throughput from the job's scores", () => {
    const sql = scoreSeriesSql("j'1", "10 minute");
    expect(sql).toContain("approx_percentile_cont(_timestamp - ref_timestamp, 0.95) AS lag_p95_us");
    expect(sql).toContain(`FROM "_llm_scores"\nWHERE job_id = 'j''1'`);
  });

  it("splits judge calls by outcome, and by error kind once the stream has one", () => {
    expect(judgeOutcomeSql("j1", "1 hour")).toContain(
      "CASE WHEN attributes_status = 'success' THEN '' ELSE COALESCE(attributes_error_kind, attributes_status) END",
    );
    expect(judgeOutcomeSql("j1", "1 hour", false)).not.toContain("attributes_error_kind");
    expect(judgeSpendSql("j1", "1 hour")).toContain("gen_ai_usage_cost_status = 'unpriced'");
    expect(judgeSpendSql("j1", "1 hour", false)).not.toContain("gen_ai_usage_cost_status");
  });

  it("plots a bucket of only unpriced judge calls as unknown, never as $0", () => {
    const t = 1_000_000_000_000_000;
    expect(
      spendPoints([
        { bucket: t, cost: null, unpriced: 13 },
        { bucket: t + 600_000_000, cost: 0.25, unpriced: 2 },
        { bucket: t + 1_200_000_000, cost: null, unpriced: 0 },
      ]),
    ).toEqual([
      [1_000_000_000_000, null],
      [1_000_000_600_000, 0.25],
      [1_000_001_200_000, 0],
    ]);
  });

  it("turns outcome rows into an error rate per kind", () => {
    const rows = [
      { bucket: 1_000_000_000_000_000, kind: "", calls: 2 },
      { bucket: 1_000_000_000_000_000, kind: "provider_auth", calls: 6 },
      { bucket: 1_000_000_000_000_000, kind: "rate_limited", calls: 2 },
      { bucket: 1_000_000_600_000_000, kind: "provider_auth", calls: 7 },
    ];
    const series = errorSeries(rows);
    expect(series.byKind.provider_auth).toEqual([
      [1_000_000_000_000, 60],
      [1_000_000_600_000, 100],
    ]);
    expect(series.byKind.rate_limited).toEqual([[1_000_000_000_000, 20]]);
    expect(series.totals).toEqual([
      { kind: "provider_auth", calls: 13 },
      { kind: "rate_limited", calls: 2 },
    ]);
  });

  it("plots histogram buckets in ms, whatever shape they arrive in", () => {
    expect(bucketMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(bucketMs("2026-10-29T14:10:00")).toBe(Date.UTC(2026, 9, 29, 14, 10));
    expect(bucketMs(null)).toBe(0);
  });
});

describe("scores stopped", () => {
  const now = 100 * HOUR_US;

  it("fires when the filter kept matching for 30 minutes and nothing was scored", () => {
    expect(scoresStopped({ sinceUs: now - 75 * MIN_US, nowUs: now, matched: 125, rate: 0.1 })).toBe(
      true,
    );
    // Not yet 30 minutes.
    expect(scoresStopped({ sinceUs: now - 20 * MIN_US, nowUs: now, matched: 125, rate: 0.1 })).toBe(
      false,
    );
  });

  it("judges a small job by its own sample rate, not a minimum run count", () => {
    // 3 matched traces at 100%: three scores were due, none came.
    expect(scoresStopped({ sinceUs: now - HOUR_US, nowUs: now, matched: 3, rate: 1 })).toBe(true);
    // 20 matched at 10%: two expected, so none yet is still normal.
    expect(scoresStopped({ sinceUs: now - HOUR_US, nowUs: now, matched: 20, rate: 0.1 })).toBe(
      false,
    );
    // A quiet stream is not a stopped job.
    expect(scoresStopped({ sinceUs: now - 9 * HOUR_US, nowUs: now, matched: 0, rate: 1 })).toBe(
      false,
    );
  });

  it("starts counting at the later of the last score and the last edit or resume", () => {
    const lastScoreUs = now - 30 * MIN_US;
    // Resumed after the last score: targets matched while paused do not count.
    expect(stoppedSinceUs({ lastScoreUs, updatedUs: now - MIN_US, nowUs: now })).toBe(now - MIN_US);
    expect(stoppedSinceUs({ lastScoreUs, updatedUs: now - HOUR_US, nowUs: now })).toBe(lastScoreUs);
    // Never scored: a day ago, unless edited since.
    expect(stoppedSinceUs({ lastScoreUs: 0, updatedUs: 0, nowUs: now })).toBe(now - 24 * HOUR_US);
    expect(stoppedSinceUs({ lastScoreUs: 0, updatedUs: now - HOUR_US, nowUs: now })).toBe(
      now - HOUR_US,
    );
  });

  it("counts the job's matched targets at its scope", () => {
    expect(
      matchedSinceSql("default", "gen_ai_agent_name = 'a'", "session", ["gen_ai_conversation_id"]),
    ).toBe(
      `SELECT COUNT(DISTINCT NULLIF("gen_ai_conversation_id", '')) AS cnt FROM "default"\nWHERE gen_ai_agent_name = 'a'`,
    );
    expect(matchedSinceSql("default", "", "session", [])).toBeNull();
  });
});
