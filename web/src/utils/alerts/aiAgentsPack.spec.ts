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
  AI_AGENTS_PACK,
  aiPackAlertPayload,
  evaluatorLagSql,
  failureRateSql,
  judgeErrorRateSql,
  packAlertName,
  repeatedToolCallsSql,
  ruleReadiness,
  scoresStoppedSql,
  streamKey,
} from "./aiAgentsPack";
import { buildAiPrefill } from "./prefill/fromAi";

const rule = (id: string) => AI_AGENTS_PACK.find((r) => r.id === id)!;

describe("ai-agents pack", () => {
  it("has the 7 reliability rules and 6 templates", () => {
    expect(AI_AGENTS_PACK.filter((r) => r.kind === "rule")).toHaveLength(7);
    expect(AI_AGENTS_PACK.filter((r) => r.kind === "template")).toHaveLength(6);
  });

  it("installs a rule only when the stream it reads exists", () => {
    const traces = new Set([streamKey("traces", "s")]);
    const withScores = new Set([...traces, streamKey("logs", "_llm_scores")]);
    expect(ruleReadiness(rule("repeated_tool_calls"), "s", traces)).toBe("ready");
    expect(ruleReadiness(rule("tool_loop"), "s", withScores)).toBe("waits");
    expect(ruleReadiness(rule("evaluator_lag"), "s", traces)).toBe("needs-data");
    expect(ruleReadiness(rule("evaluator_lag"), "s", withScores)).toBe("ready");
    // Judge spans live in their own traces stream, not in _llm_scores.
    expect(ruleReadiness(rule("eval_judge_error_rate"), "s", withScores)).toBe("needs-data");
    expect(
      ruleReadiness(
        rule("eval_judge_error_rate"),
        "s",
        new Set([...withScores, streamKey("traces", "_evaluator")]),
      ),
    ).toBe("ready");
  });

  it("returns trace_id and span_id so every hit can be placed on a span", () => {
    const sql = repeatedToolCallsSql("s", { failingOnly: true });
    expect(sql).toMatch(/^SELECT trace_id, max\(span_id\) AS span_id/);
    expect(sql).toContain("span_status = 'ERROR'");
    expect(sql).toContain("HAVING count(*) >= 3");
  });

  it("counts failures with the failure-rate rule, per agent", () => {
    const sql = failureRateSql("s", { scope: "gen_ai_agent_name = 'a'" });
    expect(sql).toContain("FROM \"s\" WHERE gen_ai_agent_name = 'a' GROUP BY trace_id");
    expect(sql).toContain("HAVING count(*) >= 50 AND 100.0 * sum(failed) / count(*) > 5");
  });

  it("builds a v2 SQL alert in the pack folder, tagged with the pack", () => {
    const spec = rule("failure_rate").spec!("llm");
    const payload: any = aiPackAlertPayload("failure_rate", spec, {
      stream: "llm",
      folderId: "f1",
      destination: "",
      owner: "me@example.com",
      timezone: "UTC",
    });
    expect(payload.name).toBe("ai_failure_rate_llm");
    expect(payload.destinations).toEqual([]);
    expect(payload.query_condition.type).toBe("sql");
    expect(payload.trigger_condition).toMatchObject({ period: 30, threshold: 1, operator: ">=" });
    expect(payload.tags).toEqual(["pack:ai-agents"]);
    expect(payload.priority).toBe(3);
    expect(packAlertName(spec, "default")).toBe("ai_failure_rate");
  });

  it("prefills Create alert with the agent on the trace and the tool on the span", () => {
    const prefill = buildAiPrefill({
      kind: "repeated_tool_calls",
      stream: "s",
      agent: "o'mp",
      tool: "grep",
    });
    expect(prefill.sql).toContain(
      `AND trace_id IN (SELECT trace_id FROM "s" WHERE gen_ai_agent_name = 'o''mp') ` +
        `AND gen_ai_tool_name = 'grep' GROUP BY`,
    );
    expect(prefill).toMatchObject({
      source: "ai",
      streamType: "traces",
      streamName: "s",
      triggerThreshold: 1,
    });
    expect(prefill.name).toBe("o_mp_grep_repeated_tool_calls");
  });

  it("scopes an agent's failure rate by trace, so its tool errors count", () => {
    const prefill = buildAiPrefill({ kind: "failure_rate", stream: "s", agent: "a" });
    expect(prefill.sql).toContain(
      `FROM "s" WHERE trace_id IN (SELECT trace_id FROM "s" WHERE gen_ai_agent_name = 'a') GROUP BY trace_id`,
    );
    expect(prefill.sql).not.toMatch(/WHERE gen_ai_agent_name = 'a' GROUP BY trace_id/);
  });

  it("says an unscoped cost alert has one row per model, the others one per agent", () => {
    const cost = buildAiPrefill({ kind: "cost", stream: "s" });
    expect(cost.sql).toContain("GROUP BY gen_ai_response_model");
    expect(cost.warnings.map((w) => w.key)).toEqual(["aiAllAgentsByModel"]);
    const failures = buildAiPrefill({ kind: "failure_rate", stream: "s" });
    expect(failures.warnings.map((w) => w.key)).toEqual(["aiAllAgents"]);
  });
});

describe("ai-agents pack: eval job templates", () => {
  it("reads evaluator lag as p95 lag over 10 minutes, from evaluator scores only", () => {
    const sql = evaluatorLagSql();
    expect(sql).toContain(
      "HAVING approx_percentile_cont(_timestamp - ref_timestamp, 0.95) / 60000000.0 > 10",
    );
    // Annotation and feedback scores carry the target's time: review latency is not lag.
    expect(sql).toContain("source_type IN ('llm_judge', 'code', 'remote')");
    // So does a manual re-evaluation; rows without a producer are online scores.
    expect(sql).toContain("(task_producer IS NULL OR task_producer != 'manual')");
  });

  it("alerts on a job with no score for 30 min that scored in the same hour yesterday", () => {
    const spec = rule("eval_scores_stopped").spec!("llm");
    expect(spec).toMatchObject({
      streamName: "_llm_scores",
      streamType: "logs",
      periodMinutes: 1440,
      severity: "critical",
    });
    expect(spec.sql).toContain(
      "WHERE job_id IS NOT NULL AND (task_producer IS NULL OR task_producer != 'manual') GROUP BY job_id",
    );
    expect(spec.sql).toContain(
      "count(CASE WHEN to_timestamp_micros(_timestamp) >= now() - INTERVAL '30 minutes' THEN 1 END) = 0",
    );
    expect(spec.sql).toContain(
      "count(CASE WHEN NOT (to_timestamp_micros(_timestamp) >= now() - INTERVAL '23 hours') THEN 1 END) >= 3",
    );
    expect(scoresStoppedSql({ jobId: "j'1" })).toContain("WHERE job_id = 'j''1'");
  });

  it("alerts per job when over 20% of at least 3 judge calls fail", () => {
    const spec = rule("eval_judge_error_rate").spec!("llm");
    expect(spec).toMatchObject({
      streamName: "_evaluator",
      streamType: "traces",
      periodMinutes: 30,
    });
    expect(spec.sql).toContain('FROM "_evaluator"');
    expect(spec.sql).toContain("GROUP BY attributes_job_id HAVING count(*) >= 3 AND");
    expect(spec.sql).toMatch(/\* 100\.0 \/ count\(\*\) > 20$/);
    expect(judgeErrorRateSql({ jobId: "j1" })).toContain("AND attributes_job_id = 'j1'");
    // Every pack install reads the same evaluator stream, so it keeps one name.
    expect(packAlertName(spec, "llm")).toBe("ai_eval_judge_error_rate");
  });

  it("prefills an eval job's alert on the evaluator's stream, scoped to the job", () => {
    const prefill = buildAiPrefill({
      kind: "eval_scores_stopped",
      stream: "default",
      jobId: "job-1",
      jobName: "research-agent hallucination",
    });
    expect(prefill).toMatchObject({
      source: "ai",
      streamType: "logs",
      streamName: "_llm_scores",
      periodMinutes: 1440,
      triggerThreshold: 1,
    });
    expect(prefill.sql).toContain("WHERE job_id = 'job-1'");
    expect(prefill.name).toContain("eval_scores_stopped");
    const errors = buildAiPrefill({
      kind: "eval_judge_error_rate",
      stream: "default",
      jobId: "job-1",
    });
    expect(errors).toMatchObject({ streamType: "traces", streamName: "_evaluator" });
    expect(errors.sql).toContain("attributes_job_id = 'job-1'");
  });
});
