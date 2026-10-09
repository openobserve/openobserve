// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "@/services/http";
import { b64EncodeUnicode } from "@/utils/formatters";
import analytics from "./product_analytics";
import search from "./search";

export type EvalJobStatus = "draft" | "active" | "paused" | "degraded" | "archived";
export type EvalTargetScope = "span" | "trace" | "session";
export type SamplingMode = "rate" | "all" | "count";
export type ConfigurableSamplingMode = "rate" | "all";
export type SamplingValue = number | { rate?: number; count?: number } | null;
export type ScorerType = "llm_judge" | "remote";
export type ScoreDataType = "numeric" | "categorical" | "boolean";

export interface Provider {
  id: string;
  orgId?: string;
  org_id?: string;
  name: string;
  providerType?: string;
  provider_type?: string;
  endpoint?: string | null;
  resolvedEndpoint?: string;
  resolved_endpoint?: string;
  defaultModel?: string;
  default_model?: string;
  availableModels?: string[];
  available_models?: string[];
  authConfigMasked?: boolean;
  auth_config_masked?: boolean;
  isDefault?: boolean;
  is_default?: boolean;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export interface ProviderPayload {
  name: string;
  providerType: string;
  endpoint?: string | null;
  defaultModel: string;
  availableModels: string[];
  authConfig: Record<string, any>;
  isDefault: boolean;
}

export interface ScoreConfig {
  id: string;
  entityId?: string;
  entity_id?: string;
  name: string;
  version: number;
  dataType?: ScoreDataType;
  data_type?: ScoreDataType;
  description?: string | null;
  numericRange?: any;
  numeric_range?: any;
  categories?: any;
  healthyThreshold?: any;
  healthy_threshold?: any;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export interface Scorer {
  id: string;
  entityId?: string;
  entity_id?: string;
  name: string;
  version: number;
  scorerType?: ScorerType;
  scorer_type?: ScorerType;
  description?: string | null;
  producesScoreConfigId?: string | null;
  produces_score_config_id?: string | null;
  producesScoreConfigVersion?: number | null;
  produces_score_config_version?: number | null;
  template: string;
  variables?: string[];
  referenceBased?: boolean;
  reference_based?: boolean;
  outputSchema?: any;
  output_schema?: any;
  params?: Record<string, any>;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export interface ScorerRef {
  id: string;
  version?: number | null;
}

export type SpanSelectorFieldMode = "default" | "custom";

export interface SpanSelector {
  id: string;
  name: string;
  filterCondition: any;
  fieldMode: SpanSelectorFieldMode;
  fields: string[];
  maximumSpans: number;
}

export type EvalJobScorerRef = ScorerRef | string;

export interface EvalJob {
  id: string;
  orgId?: string;
  org_id?: string;
  name: string;
  description?: string | null;
  stream: string;
  streamType?: string;
  stream_type?: string;
  targetScope?: EvalTargetScope;
  target_scope?: EvalTargetScope;
  filterCondition?: any;
  filter_condition?: any;
  scorers: EvalJobScorerRef[];
  inputMapping?: Record<string, Record<string, string>> | null;
  input_mapping?: Record<string, Record<string, string>> | null;
  spanSelectors?: SpanSelector[];
  span_selectors?: SpanSelector[];
  spanSelectorBindings?: Record<string, string>;
  span_selector_bindings?: Record<string, string>;
  traceConfig?: CompletionWindowConfig | null;
  trace_config?: CompletionWindowConfig | null;
  sessionConfig?: CompletionWindowConfig | null;
  session_config?: CompletionWindowConfig | null;
  samplingMode?: SamplingMode;
  sampling_mode?: SamplingMode;
  samplingValue?: SamplingValue;
  sampling_value?: SamplingValue;
  status: EvalJobStatus;
  version: number;
  pipelineId?: string | null;
  pipeline_id?: string | null;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export interface ExtraMetadataField {
  name: string;
  type: "string" | "number" | "boolean";
  description?: string;
}

export interface LlmJudgeSchemaPreviewPayload {
  producesScoreConfigId?: string;
  producesScoreConfigVersion?: number;
  includeReasoning?: boolean;
  extraMetadataFields: ExtraMetadataField[];
}

export interface LlmJudgeSchemaPreviewResult {
  outputSchema: any;
  output_schema?: any;
}

export interface ScorerTestPayload {
  name: string;
  description?: string | null;
  scorer: {
    type: ScorerType;
    producesScoreConfigId?: string;
    producesScoreConfigVersion?: number;
    template: string;
    outputSchema?: any;
    params: Record<string, any>;
  };
  inputVariables: Record<string, any>;
}

export interface ScorerTestResult {
  success: boolean;
  valueNumeric?: number;
  value_numeric?: number;
  valueCategorical?: string;
  value_categorical?: string;
  valueBoolean?: boolean;
  value_boolean?: boolean;
  reasoning?: string;
  rawResponse?: string;
  raw_response?: string;
  modelUsed?: string;
  model_used?: string;
  latencyMs?: number;
  latency_ms?: number;
  promptTokens?: number;
  prompt_tokens?: number;
  completionTokens?: number;
  completion_tokens?: number;
  totalTokens?: number;
  total_tokens?: number;
  error?: string;
  metadata?: any;
}

export interface EvalJobPayload {
  name: string;
  description?: string | null;
  stream: string;
  streamType: string;
  targetScope: EvalTargetScope;
  filterCondition: any;
  scorers: ScorerRef[];
  inputMapping?: Record<string, Record<string, string>> | null;
  spanSelectors: SpanSelector[];
  spanSelectorBindings: Record<string, string>;
  traceConfig?: CompletionWindowConfig | null;
  sessionConfig?: CompletionWindowConfig | null;
  samplingMode: ConfigurableSamplingMode;
  samplingValue: number | null;
}

export interface CompletionWindowConfig {
  idleWindowSecs: number;
  maxAgeSecs: number;
  endSignal?: any;
}

export interface ManualEvalJobPayload {
  targetId: string;
  startTime: number;
  endTime: number;
  spanId?: string | null;
  traceId?: string | null;
  sessionId?: string | null;
  variables?: Record<string, any>;
  reason?: string | null;
}

export interface ManualEvalJobResult {
  jobId: string;
  targetScope: EvalTargetScope;
  targetId: string;
  tasksCreated: number;
}

export type QualityStatus = "attention" | "healthy" | "unset" | "no_data";

export interface QualityScopeCounts {
  span: number;
  trace: number;
  session: number;
}

/** One row of the Quality list API. Times are microseconds. */
export interface QualityConfigSummary {
  configId: string;
  name: string;
  dataType: ScoreDataType;
  status: QualityStatus;
  total: number;
  unhealthy: number | null;
  average: number | null;
  lastScoredAt: number | null;
  scopeCounts: QualityScopeCounts;
  topValue: { key: string | boolean; count: number } | null;
}

export interface QualityAgentParams {
  agent_id?: string;
  agent_name?: string;
  agent_env?: string;
  agent_version?: string;
}

export interface QualityListParams extends QualityAgentParams {
  start_time: number;
  end_time: number;
  scope?: EvalTargetScope;
}

export interface QualityScoresParams extends QualityListParams {
  unhealthy_only?: boolean;
  bucket_from?: number;
  bucket_to?: number;
  value?: string;
  from?: number;
  size?: number;
}

/** Numeric buckets key on their index; boolean and categorical buckets key on the value. */
export interface QualityDistributionBucket {
  key: number | string | boolean;
  lower?: number;
  upper?: number;
  count: number;
  unhealthy: number | null;
}

export interface QualityScore {
  id: string;
  timestamp: number;
  refTimestamp: number;
  sourceType: string;
  targetScope: EvalTargetScope;
  targetId: string | null;
  spanId: string | null;
  traceId: string | null;
  sessionId: string | null;
  sourceStream: string | null;
  sourceStreamType: string | null;
  value: number | string | boolean | null;
  unhealthy: boolean | null;
  reasoning: string | null;
  evaluatorTraceId: string | null;
  taskId: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
}

export interface QualityScorePage {
  average: number | null;
  distribution: QualityDistributionBucket[];
  list: QualityScore[];
  total: number;
  from: number;
  size: number;
}

// The API rejects unknown and malformed params, so empty optionals are dropped and times are whole microseconds.
const qualityQuery = (params: QualityListParams | QualityScoresParams) => {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = key === "start_time" || key === "end_time" ? Math.floor(value as number) : value;
  }
  return out;
};

const unwrapList = <T>(response: any, key = "list"): T[] => {
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
};

// Score Configs change far less often than the pages that merely read them
// get visited — a session-lived cache keyed by org avoids re-fetching the
// whole list on every page mount. Callers that just mutated a config (create,
// update, delete) must keep using `scoreConfigs.list` directly for
// guaranteed-fresh data; this cache is for read-only consumers only.
const scoreConfigsCache = new Map<string, Promise<ScoreConfig[]>>();

const onlineEvalsService = {
  providers: {
    list: async (orgId: string): Promise<Provider[]> =>
      unwrapList<Provider>(await http().get(`/api/${orgId}/providers`)),
    create: async (orgId: string, payload: ProviderPayload): Promise<Provider> =>
      (await http().post(`/api/${orgId}/providers`, payload)).data,
    update: async (
      orgId: string,
      providerId: string,
      payload: ProviderPayload,
    ): Promise<Provider> =>
      (await http().put(`/api/${orgId}/providers/${providerId}`, payload)).data,
    delete: async (orgId: string, providerId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/providers/${providerId}`);
    },
    testConfig: async (
      orgId: string,
      payload: ProviderPayload,
      providerId?: string,
    ): Promise<string> =>
      (
        await http().post(`/api/${orgId}/providers/test`, {
          ...payload,
          ...(providerId ? { providerId } : {}),
        })
      ).data.message,
  },

  scoreConfigs: {
    list: async (orgId: string): Promise<ScoreConfig[]> =>
      unwrapList<ScoreConfig>(await http().get(`/api/${orgId}/score_configs`)),
    // Read-only, cached-per-org variant of `list` — for pages that only need
    // Score Configs as reference data (e.g. looking up a scorer's configured
    // healthy value) and would otherwise refetch the whole list on every visit.
    listCached: async (orgId: string): Promise<ScoreConfig[]> => {
      let pending = scoreConfigsCache.get(orgId);
      if (!pending) {
        pending = onlineEvalsService.scoreConfigs.list(orgId);
        pending.catch(() => scoreConfigsCache.delete(orgId));
        scoreConfigsCache.set(orgId, pending);
      }
      return pending;
    },
    create: async (orgId: string, payload: Record<string, any>): Promise<ScoreConfig> =>
      (await http().post(`/api/${orgId}/score_configs`, payload)).data,
    update: async (
      orgId: string,
      entityId: string,
      payload: Record<string, any>,
    ): Promise<ScoreConfig> =>
      (await http().put(`/api/${orgId}/score_configs/${entityId}`, payload)).data,
    versions: async (orgId: string, entityId: string): Promise<ScoreConfig[]> =>
      unwrapList<ScoreConfig>(
        await http().get(`/api/${orgId}/score_configs/${entityId}/versions`),
        "versions",
      ),
    delete: async (orgId: string, entityId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/score_configs/${entityId}`);
    },
  },

  scorers: {
    list: async (orgId: string): Promise<Scorer[]> =>
      unwrapList<Scorer>(await http().get(`/api/${orgId}/scorers`)),
    create: async (orgId: string, payload: Record<string, any>): Promise<Scorer> =>
      (await http().post(`/api/${orgId}/scorers`, payload)).data,
    update: async (
      orgId: string,
      entityId: string,
      payload: Record<string, any>,
    ): Promise<Scorer> => (await http().put(`/api/${orgId}/scorers/${entityId}`, payload)).data,
    delete: async (orgId: string, entityId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/scorers/${entityId}`);
    },
    versions: async (orgId: string, entityId: string): Promise<Scorer[]> =>
      unwrapList<Scorer>(
        await http().get(`/api/${orgId}/scorers/${entityId}/versions`),
        "versions",
      ),
    test: async (orgId: string, payload: ScorerTestPayload): Promise<ScorerTestResult> =>
      (await http().post(`/api/${orgId}/scorers/test`, payload)).data,
    previewLlmJudgeOutputSchema: async (
      orgId: string,
      payload: LlmJudgeSchemaPreviewPayload,
    ): Promise<LlmJudgeSchemaPreviewResult> =>
      (await http().post(`/api/${orgId}/scorers/llm_judge/output_schema`, payload)).data,
  },

  quality: {
    list: async (orgId: string, params: QualityListParams): Promise<QualityConfigSummary[]> =>
      unwrapList<QualityConfigSummary>(
        await http().get(`/api/${orgId}/score_configs/quality`, { params: qualityQuery(params) }),
      ),
    scores: async (
      orgId: string,
      entityId: string,
      params: QualityScoresParams,
    ): Promise<QualityScorePage> =>
      (
        await http().get(`/api/${orgId}/score_configs/${encodeURIComponent(entityId)}/quality`, {
          params: qualityQuery(params),
        })
      ).data,
    /** Evaluator runs that ended in error or timeout, counted on `_evaluator`. */
    failedRuns: async (
      orgId: string,
      params: { startTime: number; endTime: number; agentWhere: string | null; base64: boolean },
    ): Promise<number> => {
      const where = ["attributes_status IN ('error', 'timeout')", params.agentWhere]
        .filter(Boolean)
        .map((clause) => `(${clause})`)
        .join(" AND ");
      const sql = `SELECT COUNT(*) AS failed_runs FROM "_evaluator" WHERE ${where}`;
      const response = await search.search({
        org_identifier: orgId,
        query: {
          query: {
            sql: params.base64 ? b64EncodeUnicode(sql) : sql,
            start_time: Math.floor(params.startTime),
            end_time: Math.floor(params.endTime),
            from: 0,
            size: 1,
          },
          ...(params.base64 ? { encoding: "base64" } : {}),
        },
        page_type: "traces",
      });
      return Number(response?.data?.hits?.[0]?.failed_runs ?? 0);
    },
  },

  jobs: {
    list: async (orgId: string, status?: EvalJobStatus): Promise<EvalJob[]> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return unwrapList<EvalJob>(await http().get(`/api/${orgId}/eval_jobs${query}`));
    },
    create: async (orgId: string, payload: EvalJobPayload): Promise<EvalJob> => {
      const response = await http().post(`/api/${orgId}/eval_jobs`, payload);
      analytics.track("llm_eval_job_created");
      return response.data;
    },
    update: async (orgId: string, jobId: string, payload: EvalJobPayload): Promise<EvalJob> =>
      (await http().put(`/api/${orgId}/eval_jobs/${jobId}`, payload)).data,
    delete: async (orgId: string, jobId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/eval_jobs/${jobId}`);
    },
    activate: async (orgId: string, jobId: string): Promise<EvalJob> =>
      (await http().post(`/api/${orgId}/eval_jobs/${jobId}/activate`, {})).data,
    pause: async (orgId: string, jobId: string): Promise<EvalJob> =>
      (await http().post(`/api/${orgId}/eval_jobs/${jobId}/pause`, {})).data,
    manualEval: async (
      orgId: string,
      jobId: string,
      payload: ManualEvalJobPayload,
    ): Promise<ManualEvalJobResult> =>
      (await http().post(`/api/${orgId}/eval_jobs/${jobId}/manual_eval`, payload)).data,
  },
};

export default onlineEvalsService;
