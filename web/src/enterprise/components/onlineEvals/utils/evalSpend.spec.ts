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
  backfillEstimate,
  backfillRequests,
  backfillTargetsSql,
  backfillWindowUs,
  estimateJobSpend,
  formatUsd,
  isBudgetPaused,
  judgeHistorySql,
  matchedPerDaySql,
  parseJudgeHistory,
  loadSpendToday,
  spendTodaySql,
  utcDayStartMs,
  type JudgeHistory,
} from "./evalSpend";

const judge = (scorerId: string, priced: number, cost: number): JudgeHistory => ({
  scorerId,
  calls: priced,
  priced,
  cost,
  tokens: 9800,
  model: "gpt-4o-mini",
});

describe("eval spend estimate (AIO-24)", () => {
  it("is matched targets a day × sample rate × judge cost per target", () => {
    // 2,410 traces a day on the days with traffic; the empty days are not averaged in.
    const e = estimateJobSpend({
      dailyCounts: [2000, 0, 2820],
      rate: 0.1,
      judgeIds: ["h"],
      history: [judge("h", 100, 0.16)],
    });
    expect(e.matchedPerDay).toBe(2410);
    expect(e.scoredPerDay).toBeCloseTo(241);
    expect(e.perTargetUsd).toBeCloseTo(0.0016);
    expect(e.perDayUsd).toBeCloseTo(0.3856);
    expect(e.busiestDayUsd).toBeCloseTo(0.4512);
    expect(e).toMatchObject({ tokensPerTarget: 9800, model: "gpt-4o-mini" });
  });

  it("adds up every judge a target goes through", () => {
    const e = estimateJobSpend({
      dailyCounts: [10],
      rate: 1,
      judgeIds: ["a", "b"],
      history: [judge("a", 10, 0.1), judge("b", 5, 0.1)],
    });
    expect(e.perTargetUsd).toBeCloseTo(0.03);
  });

  it("never counts a judge without priced calls as $0", () => {
    const unpriced = { ...judge("a", 0, 0), calls: 40 };
    for (const history of [[], [unpriced], [judge("b", 3, 0.3)]]) {
      const e = estimateJobSpend({ dailyCounts: [10], rate: 1, judgeIds: ["a"], history });
      expect(e.perTargetUsd).toBeNull();
      expect(e.perDayUsd).toBeNull();
    }
  });

  it("leaves unknown traffic unknown, never $0", () => {
    const e = estimateJobSpend({
      dailyCounts: null,
      rate: 1,
      judgeIds: ["h"],
      history: [judge("h", 100, 0.16)],
    });
    expect(e).toMatchObject({ matchedPerDay: null, scoredPerDay: null, perDayUsd: null });
    expect(e.busiestDayUsd).toBeNull();
    expect(e.perTargetUsd).toBeCloseTo(0.0016);
  });

  it("costs nothing without an LLM judge", () => {
    const e = estimateJobSpend({ dailyCounts: [10], rate: 0.5, judgeIds: [], history: [] });
    expect(e.perDayUsd).toBe(0);
    expect(e.scoredPerDay).toBe(5);
  });

  it("reads search rows that carry numbers as strings", () => {
    expect(
      parseJudgeHistory([
        { scorer_id: "a", calls: "4", priced: "4", cost: "0.2", tokens: null, model: "" },
      ]),
    ).toEqual([{ scorerId: "a", calls: 4, priced: 4, cost: 0.2, tokens: null, model: null }]);
  });
});

describe("backfill (AIO-24)", () => {
  it("estimates the window's matched targets once, capped at what today's budget pays for", () => {
    expect(backfillEstimate({ matched: 700, rate: 0.5, perTargetUsd: 0.01, budgetUsd: 5 })).toEqual(
      { targets: 350, usd: 3.5, cap: null },
    );
    expect(
      backfillEstimate({ matched: 1000, rate: 1, perTargetUsd: 0.01, budgetUsd: 5 }),
    ).toMatchObject({ targets: 1000, cap: 500 });
    expect(backfillEstimate({ matched: 400, rate: 1, perTargetUsd: null, budgetUsd: 5 })).toEqual({
      targets: 400,
      usd: null,
      cap: null,
    });
  });

  it("counts no more than the backfill reads and queues", () => {
    // 10,000 rows read at 5%, and never past 1,000 targets.
    expect(
      backfillEstimate({ matched: 50_000, rate: 0.05, perTargetUsd: null, budgetUsd: 5 }).targets,
    ).toBe(500);
    expect(
      backfillEstimate({ matched: 5_000, rate: 1, perTargetUsd: null, budgetUsd: 5 }).targets,
    ).toBe(1000);
  });

  it("reaches back the whole window, up to now", () => {
    const now = 10 * 24 * 3_600_000;
    expect(backfillWindowUs(1, now)).toEqual({
      startUs: (now - 24 * 3_600_000) * 1000,
      endUs: now * 1000,
    });
  });

  it("samples rows at the rate up to the cap, padding the window for whole targets", () => {
    const rows = [
      { target_id: "t1", trace_id: "t1", start_ns: 5_000_000_000, end_ns: 6_000_000_000 },
      { target_id: "t2", trace_id: "t2", start_ns: 7_000_000_000, end_ns: 8_000_000_000 },
      { target_id: "t3", trace_id: "t3", start_ns: 9_000_000_000, end_ns: 9_500_000_000 },
    ];
    const draws = [0.05, 0.9, 0.05];
    const requests = backfillRequests(rows, "trace", {
      rate: 0.1,
      cap: 5,
      padUs: 1000,
      random: () => draws.shift()!,
    });
    expect(requests.map((r) => r.targetId)).toEqual(["t1", "t3"]);
    expect(requests[0]).toMatchObject({
      traceId: "t1",
      spanId: null,
      sessionId: null,
      startTime: 5_000_000 - 1 - 1000,
      endTime: 6_000_000 + 1 + 1000,
    });
    expect(backfillRequests(rows, "session", { rate: 1, cap: 1, padUs: 0 })).toEqual([
      expect.objectContaining({ targetId: "t1", sessionId: "t1", traceId: "t1" }),
    ]);
  });

  it("groups matched spans into targets at the job's scope", () => {
    const fields = ["gen_ai_conversation_id"];
    const sql = backfillTargetsSql("llm", "gen_ai_agent_name = 'a'", "session", fields, 50);
    const id = `NULLIF("gen_ai_conversation_id", '')`;
    expect(sql).toContain(`SELECT ${id} AS target_id`);
    expect(sql).toContain(`WHERE ${id} IS NOT NULL AND (gen_ai_agent_name = 'a')`);
    expect(sql).toContain(`GROUP BY ${id}\nLIMIT 50`);
    expect(backfillTargetsSql("llm", "", "session", ["trace_id"], 50)).toBeNull();
  });
});

describe("spend SQL and budget state (AIO-24)", () => {
  it("counts matched targets per day at the job's scope", () => {
    const sql = matchedPerDaySql("default", "", "trace", []);
    expect(sql).toContain(
      `SELECT histogram(_timestamp, '1 day') AS day, COUNT(DISTINCT "trace_id")`,
    );
    expect(sql).not.toContain("WHERE");
  });

  it("prices judges and jobs from their own _evaluator spans", () => {
    expect(judgeHistorySql(["s'1"])).toContain("attributes_scorer_id IN ('s''1')");
    expect(judgeHistorySql(["s1"])).toContain("attributes_status = 'success'");
    const all = { jobId: true, cost: true, costStatus: true };
    const sql = spendTodaySql(["j1", "j2"], all);
    expect(sql).toContain("SUM(gen_ai_usage_cost) AS spend");
    expect(sql).toContain("gen_ai_usage_cost_status = 'unpriced'");
    expect(sql).toContain("WHERE attributes_job_id IN ('j1', 'j2')");
    // A column the stream lacks is not named: the query would fail on it.
    const priced = spendTodaySql(["j1"], { ...all, costStatus: false });
    expect(priced).not.toContain("gen_ai_usage_cost_status");
    expect(spendTodaySql(["j1"], { ...all, cost: false })).toContain("0 AS spend");
    expect(spendTodaySql(["j1"], { ...all, jobId: false })).not.toContain("attributes_job_id");
  });

  describe("spend today", () => {
    const fields =
      (...names: string[]) =>
      async () =>
        names.map((name) => ({ name }));

    // The shapes axios rejects with for `/_search` and the schema read.
    const forbidden = async (): Promise<never> => {
      throw { response: { status: 403, data: { code: 403 } } };
    };
    const schemaNotFound = async (): Promise<never> => {
      throw { response: { status: 404, data: { code: 404 } } };
    };
    const searchNotFound = async (): Promise<never> => {
      throw { response: { status: 400, data: { code: 20002 } } };
    };

    it("counts unpriced judge calls instead of reading them as $0", async () => {
      const spend = await loadSpendToday(["j1", "j2"], {
        fields: fields("attributes_job_id", "gen_ai_usage_cost_status"),
        query: async () => [{ job_id: "j1", spend: 0, unpriced: 8 }],
      });
      expect(spend).toEqual({
        j1: { usd: 0, unpricedCalls: 8 },
        j2: { usd: 0, unpricedCalls: 0 },
      });
    });

    it("reads $0 for every job while no judge call has made _evaluator", async () => {
      expect(
        await loadSpendToday(["j1"], { fields: schemaNotFound, query: searchNotFound }),
      ).toEqual({ j1: { usd: 0, unpricedCalls: 0 } });
    });

    it("reads $0 priced spend when no cost column was ever recorded, still querying", async () => {
      const sqls: string[] = [];
      const spend = await loadSpendToday(["j1"], {
        fields: fields("attributes_job_id"),
        query: async (sql) => {
          sqls.push(sql);
          return [{ job_id: "j1", spend: 0, unpriced: 0 }];
        },
      });
      expect(spend).toEqual({ j1: { usd: 0, unpricedCalls: 0 } });
      expect(sqls).toHaveLength(1);
    });

    it("never reads $0 for a user who cannot read _evaluator", async () => {
      const cost = fields("attributes_job_id", "gen_ai_usage_cost");
      // Search denied though the schema read passed, or with no stream to read.
      expect(await loadSpendToday(["j1"], { fields: cost, query: forbidden })).toBe("forbidden");
      expect(await loadSpendToday(["j1"], { fields: schemaNotFound, query: forbidden })).toBe(
        "forbidden",
      );
      expect(
        await loadSpendToday(["j1"], {
          fields: async () => {
            throw { response: { status: 403 } };
          },
          query: async () => [],
        }),
      ).toBe("forbidden");
    });

    it("is unknown on any other failure", async () => {
      const timeout = async (): Promise<never> => {
        throw new Error("timeout");
      };
      const cost = fields("attributes_job_id", "gen_ai_usage_cost");
      expect(await loadSpendToday(["j1"], { fields: cost, query: timeout })).toBe("failed");
      expect(await loadSpendToday(["j1"], { fields: timeout, query: async () => [] })).toBe(
        "failed",
      );
    });
  });

  it("finds 00:00 UTC", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(utcDayStartMs(Date.UTC(2026, 9, 29, 17, 48))).toBe(Date.UTC(2026, 9, 29));
    expect(utcDayStartMs(3 * day)).toBe(3 * day);
  });

  it("tells a budget pause from a user pause", () => {
    const job: any = { status: "paused", budget: { dailyUsd: 5, onReach: "pause", pausedAt: 1 } };
    expect(isBudgetPaused(job)).toBe(true);
    expect(isBudgetPaused({ ...job, budget: { dailyUsd: 5, onReach: "pause" } })).toBe(false);
    expect(isBudgetPaused({ ...job, status: "active" })).toBe(false);
  });

  it("formats day amounts and sub-cent amounts", () => {
    expect(formatUsd(5)).toBe("$5.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0016)).toBe("$0.0016");
  });
});
