import { describe, expect, it } from "vitest";
import { latestScoreAttemptsFromSql, latestScoresFromSql } from "./latestScoreSql";

describe("latestScoreSql", () => {
  it("selects one latest row per evaluation key with deterministic ordering", () => {
    const sql = latestScoresFromSql("score_config_id IS NOT NULL");

    expect(sql).toContain('FROM "_llm_scores"');
    expect(sql).toContain("PARTITION BY _evaluation_key");
    expect(sql).toContain("ORDER BY COALESCE(score_version, 0) DESC, _timestamp DESC");
    expect(sql).toContain("WHERE _latest_score_rank = 1");
    expect(sql).toContain("AND (score_config_id IS NOT NULL)");
    expect(sql.indexOf("WHERE _latest_score_rank = 1")).toBeLessThan(
      sql.indexOf("AND (score_config_id IS NOT NULL)"),
    );
  });

  it("normalizes supported scopes and excludes non-quality scores", () => {
    const sql = latestScoresFromSql(null);

    expect(sql).toContain("AS _target_scope");
    expect(sql).toContain("AS _target_id");
    expect(sql).toContain("NULLIF(CAST(level AS VARCHAR), '')");
    expect(sql).toContain("NULLIF(CAST(id AS VARCHAR), '')");
    expect(sql).not.toContain("CAST(span_id AS VARCHAR)");
    expect(sql).not.toContain("CAST(session_id AS VARCHAR)");
    expect(sql).toContain("_target_scope IN ('span', 'trace', 'session')");
    expect(sql).toContain(") AS latest_scores");
  });

  it("gives every legacy score a non-empty namespaced partition key", () => {
    const sql = latestScoresFromSql();

    expect(sql).toContain("NULLIF(CAST(evaluation_key AS VARCHAR), '')");
    expect(sql).toContain("CONCAT('legacy:', CAST(id AS VARCHAR))");
    expect(sql).toContain("'legacy-row:'");
    expect(sql).toContain("END AS _evaluation_key");
  });
});

describe("latestScoreAttemptsFromSql", () => {
  it("keeps the newest export for each task without collapsing later tasks", () => {
    const sql = latestScoreAttemptsFromSql("score_config_id IS NOT NULL");

    expect(sql).toContain('FROM "_llm_scores"');
    expect(sql).toContain("PARTITION BY _score_attempt_key");
    expect(sql).toContain("NULLIF(CAST(task_id AS VARCHAR), '')");
    expect(sql).toContain("ORDER BY _timestamp DESC");
    expect(sql).toContain("WHERE _latest_attempt_rank = 1");
    expect(sql).toContain("AND (score_config_id IS NOT NULL)");
    expect(sql).toContain(") AS latest_score_attempts");
  });
});
