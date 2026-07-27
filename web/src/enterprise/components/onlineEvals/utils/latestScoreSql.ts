export const LATEST_SCORES_TABLE = "latest_scores";
export const LATEST_SCORE_ATTEMPTS_TABLE = "latest_score_attempts";

const NORMALIZED_SCOPE_SQL = [
  "LOWER(COALESCE(",
  "  NULLIF(CAST(target_scope AS VARCHAR), ''),",
  "  NULLIF(CAST(level AS VARCHAR), '')",
  "))",
].join("\n");

const NORMALIZED_TARGET_ID_SQL = [
  "COALESCE(",
  "  NULLIF(CAST(target_id AS VARCHAR), ''),",
  // `id` exists on every legacy score record, whereas the old scope-specific
  // identity fields were optional and therefore may not exist in an inferred
  // stream schema at all. Referencing an absent optional column makes the
  // entire DataFusion query fail, even when COALESCE would never select it.
  "  NULLIF(CAST(id AS VARCHAR), '')",
  ")",
].join("\n");

const LEGACY_ROW_KEY_SQL = [
  "CONCAT(",
  "  'legacy-row:', COALESCE(CAST(_timestamp AS VARCHAR), ''),",
  "  ':', COALESCE(_target_scope, ''),",
  "  ':', COALESCE(_target_id, ''),",
  "  ':', COALESCE(CAST(job_id AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(scorer_id AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(score_config_id AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(score_version AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(name AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(value_numeric AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(value_categorical AS VARCHAR), ''),",
  "  ':', COALESCE(CAST(value_boolean AS VARCHAR), '')",
  ")",
].join("\n");

export function latestScoresFromSql(whereClause?: string | null): string {
  const where = whereClause?.trim();
  return [
    "(",
    "  SELECT *",
    "  FROM (",
    "    SELECT",
    "      *,",
    "      ROW_NUMBER() OVER (",
    "        PARTITION BY _evaluation_key",
    "        ORDER BY COALESCE(score_version, 0) DESC, _timestamp DESC, COALESCE(CAST(id AS VARCHAR), '') DESC",
    "      ) AS _latest_score_rank",
    "    FROM (",
    "      SELECT",
    "        *,",
    "        CASE",
    "          WHEN NULLIF(CAST(evaluation_key AS VARCHAR), '') IS NOT NULL",
    "            THEN CAST(evaluation_key AS VARCHAR)",
    "          WHEN NULLIF(CAST(id AS VARCHAR), '') IS NOT NULL",
    "            THEN CONCAT('legacy:', CAST(id AS VARCHAR))",
    "          ELSE " + LEGACY_ROW_KEY_SQL.replace(/\n/g, "\n               "),
    "        END AS _evaluation_key",
    "      FROM (",
    "        SELECT",
    "          *,",
    "          " + NORMALIZED_TARGET_ID_SQL.replace(/\n/g, "\n          ") + " AS _target_id",
    "        FROM (",
    "          SELECT",
    "            *,",
    "            " + NORMALIZED_SCOPE_SQL.replace(/\n/g, "\n            ") + " AS _target_scope",
    '          FROM "_llm_scores"',
    "        ) AS scope_normalized_scores",
    "      ) AS target_normalized_scores",
    "    ) AS key_normalized_scores",
    "  ) AS ranked_scores",
    "  WHERE _latest_score_rank = 1",
    "    AND _target_scope IN ('span', 'trace', 'session')",
    ...(where ? [`    AND (${where})`] : []),
    `) AS ${LATEST_SCORES_TABLE}`,
  ].join("\n");
}

/**
 * Latest exported score for each executor task.
 *
 * A task is the identity of one scoring attempt. At-least-once queue delivery
 * can export that task more than once with different score IDs, so the newest
 * record wins. Unlike `latestScoresFromSql`, this intentionally preserves
 * later tasks that re-evaluate the same target and is therefore the correct
 * source for execution-volume trends.
 */
export function latestScoreAttemptsFromSql(whereClause?: string | null): string {
  const where = whereClause?.trim();
  return [
    "(",
    "  SELECT *",
    "  FROM (",
    "    SELECT",
    "      *,",
    "      ROW_NUMBER() OVER (",
    "        PARTITION BY _score_attempt_key",
    "        ORDER BY _timestamp DESC, COALESCE(CAST(id AS VARCHAR), '') DESC",
    "      ) AS _latest_attempt_rank",
    "    FROM (",
    "      SELECT",
    "        *,",
    "        CASE",
    "          WHEN NULLIF(CAST(task_id AS VARCHAR), '') IS NOT NULL",
    "            THEN CAST(task_id AS VARCHAR)",
    "          WHEN NULLIF(CAST(id AS VARCHAR), '') IS NOT NULL",
    "            THEN CONCAT('legacy:', CAST(id AS VARCHAR))",
    "          ELSE " + LEGACY_ROW_KEY_SQL.replace(/\n/g, "\n               "),
    "        END AS _score_attempt_key",
    "      FROM (",
    "        SELECT",
    "          *,",
    "          " + NORMALIZED_TARGET_ID_SQL.replace(/\n/g, "\n          ") + " AS _target_id",
    "        FROM (",
    "          SELECT",
    "            *,",
    "            " + NORMALIZED_SCOPE_SQL.replace(/\n/g, "\n            ") + " AS _target_scope",
    '          FROM "_llm_scores"',
    "        ) AS scope_normalized_attempts",
    "      ) AS target_normalized_attempts",
    "    ) AS key_normalized_attempts",
    "  ) AS ranked_attempts",
    "  WHERE _latest_attempt_rank = 1",
    "    AND _target_scope IN ('span', 'trace', 'session')",
    ...(where ? [`    AND (${where})`] : []),
    `) AS ${LATEST_SCORE_ATTEMPTS_TABLE}`,
  ].join("\n");
}
