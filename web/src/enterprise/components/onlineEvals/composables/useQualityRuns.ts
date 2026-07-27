// Score Config detail — canonical score records with evaluator-trace drilldown.
//
// The table is intentionally sourced only from `_llm_scores`: typed values,
// reasoning, targets, pagination, and health classification all come from the
// canonical score record. `evaluator_trace_id` is retained only as the link to
// the `_evaluator` trace used for deeper investigation.

import { computed, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { ScoreConfig } from "@/services/online-evals.service";
import { dataTypeOf, entityId } from "../utils/evalEntity";
import { latestScoresFromSql } from "../utils/latestScoreSql";
import {
  buildScoresAgentFilterWhere,
  combineWhere,
  type AgentFilterSelection,
} from "../utils/agentFilterSql";
import type { QualityScope } from "../utils/qualityScope";
import {
  escapeSqlString,
  isScoreUnhealthy,
  thresholdForConfig,
  type ScoreValue,
} from "../utils/scoreThreshold";
import type { DateWindow } from "./useQualityData";

export type QualityRunStatus = "success";
export type QualityRunHealth = "healthy" | "unhealthy" | "unclassified";
export type QualityRunFilter = "all" | "unhealthy";

export interface QualityRunCounts {
  all: number;
  unhealthy: number | null;
}

export interface QualityRunsPagination {
  page: number;
  size: number;
}

export interface QualityRunRow {
  id: string;
  taskId: string;
  timestampMs: number;
  evaluatorTraceId: string;
  evaluatorSpanId: string;
  evalRunId: string;
  status: QualityRunStatus;
  result: ScoreValue;
  resultDisplay: string;
  reasoning: string;
  health: QualityRunHealth;
  isUnhealthy: boolean;
  targetScope: "span" | "trace" | "session" | "unknown";
  targetId: string;
  targetSpanId: string;
  targetTraceId: string;
  targetSessionId: string;
  targetStream: string;
  targetStreamType: string;
  agentName: string;
  agentId: string;
  scorerId: string;
  jobId: string;
  latencyMs: number | null;
  errorKind: string;
}

export interface RawQualityScoreRow {
  _timestamp?: number | string;
  id?: string | null;
  task_id?: string | null;
  eval_run_id?: string | null;
  evaluator_trace_id?: string | null;
  target_scope?: string | null;
  level?: string | null;
  target_id?: string | null;
  span_id?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  source_stream?: string | null;
  source_stream_type?: string | null;
  agent_name?: string | null;
  agent_id?: string | null;
  scorer_id?: string | null;
  job_id?: string | null;
  value_numeric?: number | string | null;
  value_categorical?: string | null;
  value_boolean?: boolean | string | null;
  reasoning?: string | null;
}

interface RawQualityRunCounts {
  all_count?: number | string | null;
  unhealthy_count?: number | string | null;
}

interface RawEvaluatorSpanLookupRow {
  span_id?: string | null;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const normalizedScopeSql = [
  "LOWER(COALESCE(",
  "  NULLIF(CAST(target_scope AS VARCHAR), ''),",
  "  NULLIF(CAST(level AS VARCHAR), '')",
  "))",
].join("\n");

function scoreBaseWhere(configId: string, agentWhere: string | null, scope: QualityScope): string {
  const scopeWhere = scope === "all" ? null : `${normalizedScopeSql} = '${scope}'`;
  return (
    combineWhere(
      `CAST(score_config_id AS VARCHAR) = '${escapeSqlString(configId)}'`,
      "NULLIF(CAST(evaluator_trace_id AS VARCHAR), '') IS NOT NULL",
      agentWhere,
      scopeWhere,
    ) ?? "1 = 1"
  );
}

export function buildQualityRunsCountSql(
  config: ScoreConfig,
  agentWhere: string | null,
  scope: QualityScope,
): string {
  const threshold = thresholdForConfig(config);
  const unhealthyCount = threshold.unhealthyExpr
    ? `COUNT(CASE WHEN ${threshold.unhealthyExpr} THEN 1 END)`
    : "CAST(NULL AS BIGINT)";

  return [
    "SELECT",
    "  COUNT(*) AS all_count,",
    `  ${unhealthyCount} AS unhealthy_count`,
    `FROM ${latestScoresFromSql(scoreBaseWhere(entityId(config), agentWhere, scope))}`,
  ].join("\n");
}

export function buildQualityRunsSql(
  config: ScoreConfig,
  agentWhere: string | null,
  scope: QualityScope,
  filter: QualityRunFilter = "all",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): string {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(
    1,
    Math.min(MAX_PAGE_SIZE, Math.floor(pageSize) || DEFAULT_PAGE_SIZE),
  );
  const threshold = thresholdForConfig(config);
  const filterWhere =
    filter === "unhealthy"
      ? threshold.unhealthyExpr
        ? `(${threshold.unhealthyExpr})`
        : "1 = 0"
      : null;
  const where = combineWhere(scoreBaseWhere(entityId(config), agentWhere, scope), filterWhere);
  const offset = (safePage - 1) * safePageSize;

  return [
    "SELECT",
    "  _timestamp,",
    "  id,",
    "  task_id,",
    "  eval_run_id,",
    "  evaluator_trace_id,",
    "  target_scope,",
    "  level,",
    "  target_id,",
    "  span_id,",
    "  trace_id,",
    "  session_id,",
    "  source_stream,",
    "  source_stream_type,",
    "  agent_name,",
    "  agent_id,",
    "  scorer_id,",
    "  job_id,",
    "  value_numeric,",
    "  value_categorical,",
    "  value_boolean,",
    "  reasoning",
    `FROM ${latestScoresFromSql(where)}`,
    "ORDER BY _timestamp DESC, id DESC",
    `LIMIT ${safePageSize} OFFSET ${offset}`,
  ].join("\n");
}

export function buildEvaluatorSpanLookupSql(
  evaluatorTraceId: string,
  taskId: string,
  scoreId?: string,
): string {
  return [
    "SELECT span_id",
    'FROM "_evaluator"',
    `WHERE CAST(trace_id AS VARCHAR) = '${escapeSqlString(evaluatorTraceId)}'`,
    `  AND CAST(attributes_task_id AS VARCHAR) = '${escapeSqlString(taskId)}'`,
    ...(scoreId
      ? [`  AND CAST(attributes_score_id AS VARCHAR) = '${escapeSqlString(scoreId)}'`]
      : []),
    "ORDER BY _timestamp DESC",
    "LIMIT 1",
  ].join("\n");
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampToMs(value: unknown): number {
  const numeric = toNumber(value);
  if (numeric != null) {
    return numeric > 1e14 ? Math.round(numeric / 1000) : numeric;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseTargetScope(row: RawQualityScoreRow): QualityRunRow["targetScope"] {
  const normalized = String(row.target_scope ?? row.level ?? "").toLowerCase();
  if (normalized === "span" || normalized === "trace" || normalized === "session") {
    return normalized;
  }
  return "unknown";
}

function canonicalScoreValue(score: RawQualityScoreRow, config: ScoreConfig): ScoreValue {
  const dataType = dataTypeOf(config);
  if (dataType === "numeric") return toNumber(score.value_numeric);
  if (dataType === "categorical") {
    return score.value_categorical == null ? null : String(score.value_categorical);
  }
  if (dataType === "boolean") {
    if (typeof score.value_boolean === "boolean") return score.value_boolean;
    if (score.value_boolean === "true" || score.value_boolean === "false") {
      return score.value_boolean === "true";
    }
  }
  return null;
}

function formatResult(result: ScoreValue): string {
  if (result == null) return "—";
  if (typeof result === "number") return result.toFixed(2);
  if (typeof result === "boolean") return result ? "true" : "false";
  return result;
}

export function mapQualityRunRow(raw: RawQualityScoreRow, config: ScoreConfig): QualityRunRow {
  const result = canonicalScoreValue(raw, config);
  const unhealthy = isScoreUnhealthy(config, result);
  const targetScope = parseTargetScope(raw);
  const targetId = String(
    raw.target_id ??
      (targetScope === "span"
        ? raw.span_id
        : targetScope === "trace"
          ? raw.trace_id
          : targetScope === "session"
            ? raw.session_id
            : "") ??
      "",
  );

  return {
    id: String(raw.id ?? ""),
    taskId: String(raw.task_id ?? ""),
    timestampMs: timestampToMs(raw._timestamp),
    evaluatorTraceId: String(raw.evaluator_trace_id ?? ""),
    evaluatorSpanId: "",
    evalRunId: String(raw.eval_run_id ?? ""),
    status: "success",
    result,
    resultDisplay: formatResult(result),
    reasoning: String(raw.reasoning ?? ""),
    health: unhealthy == null ? "unclassified" : unhealthy ? "unhealthy" : "healthy",
    isUnhealthy: unhealthy === true,
    targetScope,
    targetId,
    targetSpanId: String(raw.span_id ?? ""),
    targetTraceId: String(raw.trace_id ?? ""),
    targetSessionId: String(raw.session_id ?? ""),
    targetStream: String(raw.source_stream ?? ""),
    targetStreamType: String(raw.source_stream_type ?? "traces"),
    agentName: String(raw.agent_name ?? ""),
    agentId: String(raw.agent_id ?? ""),
    scorerId: String(raw.scorer_id ?? ""),
    jobId: String(raw.job_id ?? ""),
    latencyMs: null,
    errorKind: "",
  };
}

function parseCounts(row: RawQualityRunCounts | undefined): QualityRunCounts {
  return {
    all: toNumber(row?.all_count) ?? 0,
    unhealthy: row?.unhealthy_count == null ? null : (toNumber(row.unhealthy_count) ?? 0),
  };
}

export function useQualityRuns(
  selectedConfig: Ref<ScoreConfig | null>,
  dateWindow: Ref<DateWindow>,
  agentFilter?: Ref<AgentFilterSelection | null | undefined>,
  qualityScope?: Ref<QualityScope>,
) {
  const { executeQuery, executeQueryOnce } = useLLMStreamQuery();
  const runs = ref<QualityRunRow[]>([]);
  const counts = ref<QualityRunCounts>({ all: 0, unhealthy: null });
  const activeFilter = ref<QualityRunFilter>("all");
  const currentPage = ref(1);
  const pageSize = ref(DEFAULT_PAGE_SIZE);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  let refreshGeneration = 0;

  const totalCount = computed(() => {
    if (activeFilter.value === "unhealthy") {
      return counts.value.unhealthy ?? 0;
    }
    return counts.value.all;
  });

  function queryContext(config: ScoreConfig) {
    const { startUs, endUs } = dateWindow.value;
    const agentWhere = buildScoresAgentFilterWhere(agentFilter?.value ?? null);
    const scope = qualityScope?.value ?? "all";
    return { config, startUs, endUs, agentWhere, scope };
  }

  async function fetchPage(generation: number, config: ScoreConfig) {
    const { startUs, endUs, agentWhere, scope } = queryContext(config);
    const sql = buildQualityRunsSql(
      config,
      agentWhere,
      scope,
      activeFilter.value,
      currentPage.value,
      pageSize.value,
    );
    const hits = (await executeQueryOnce(sql, startUs, endUs, "logs")) as RawQualityScoreRow[];
    if (generation !== refreshGeneration) return;
    runs.value = hits.map((row) => mapQualityRunRow(row, config));
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const config = selectedConfig.value;
    if (!config) {
      runs.value = [];
      counts.value = { all: 0, unhealthy: null };
      isLoading.value = false;
      error.value = null;
      return;
    }

    isLoading.value = true;
    try {
      const { startUs, endUs, agentWhere, scope } = queryContext(config);
      const countSql = buildQualityRunsCountSql(config, agentWhere, scope);
      const [countHits] = await Promise.all([
        executeQueryOnce(countSql, startUs, endUs, "logs"),
        fetchPage(generation, config),
      ]);
      if (generation !== refreshGeneration) return;
      counts.value = parseCounts((countHits as RawQualityRunCounts[])[0]);

      const maxPage = Math.max(1, Math.ceil(totalCount.value / pageSize.value));
      if (currentPage.value > maxPage) {
        currentPage.value = maxPage;
        await fetchPage(generation, config);
      }
      error.value = null;
    } catch (caughtError) {
      if (generation !== refreshGeneration) return;
      console.warn("[QualityDetail:scores] query failed:", caughtError);
      error.value = "query_failed";
    } finally {
      if (generation === refreshGeneration) isLoading.value = false;
    }
  }

  async function setFilter(filter: QualityRunFilter) {
    if (activeFilter.value === filter) return;
    activeFilter.value = filter;
    currentPage.value = 1;
    await refresh();
  }

  async function setPagination(pagination: QualityRunsPagination) {
    const nextSize = Math.max(
      1,
      Math.min(MAX_PAGE_SIZE, Math.floor(pagination.size) || DEFAULT_PAGE_SIZE),
    );
    currentPage.value =
      nextSize === pageSize.value ? Math.max(1, Math.floor(pagination.page) || 1) : 1;
    pageSize.value = nextSize;
    await refresh();
  }

  async function resolveEvaluatorSpanId(run: QualityRunRow): Promise<string> {
    if (run.evaluatorSpanId) return run.evaluatorSpanId;
    if (!run.evaluatorTraceId || !run.taskId) return "";

    const timestampUs = run.timestampMs > 0 ? run.timestampMs * 1000 : 0;
    const { startUs, endUs } = dateWindow.value;
    try {
      const hits = (await executeQuery(
        buildEvaluatorSpanLookupSql(run.evaluatorTraceId, run.taskId, run.id),
        timestampUs ? Math.max(0, timestampUs - 60_000_000) : startUs,
        timestampUs ? timestampUs + 3_600_000_000 : endUs,
        "traces",
      )) as RawEvaluatorSpanLookupRow[];
      return String(hits[0]?.span_id ?? "");
    } catch (caughtError) {
      console.warn("[QualityDetail:scores] evaluator span lookup failed:", caughtError);
      return "";
    }
  }

  watch(
    () => [
      selectedConfig.value ? entityId(selectedConfig.value) : "",
      qualityScope?.value ?? "all",
    ],
    ([configId], [previousConfigId]) => {
      if (configId !== previousConfigId) activeFilter.value = "all";
      currentPage.value = 1;
      void refresh();
    },
  );

  return {
    runs,
    counts,
    activeFilter,
    currentPage,
    pageSize,
    totalCount,
    isLoading,
    error,
    refresh,
    setFilter,
    setPagination,
    resolveEvaluatorSpanId,
  };
}
