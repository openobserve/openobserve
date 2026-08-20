// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "@/services/http";

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

const unwrapList = <T>(response: any, key = "list"): T[] => {
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  return [];
};

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
  },

  scoreConfigs: {
    list: async (orgId: string): Promise<ScoreConfig[]> =>
      unwrapList<ScoreConfig>(await http().get(`/api/${orgId}/score_configs`)),
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
    test: async (orgId: string, payload: ScorerTestPayload): Promise<ScorerTestResult> =>
      (await http().post(`/api/${orgId}/scorers/test`, payload)).data,
    previewLlmJudgeOutputSchema: async (
      orgId: string,
      payload: LlmJudgeSchemaPreviewPayload,
    ): Promise<LlmJudgeSchemaPreviewResult> =>
      (await http().post(`/api/${orgId}/scorers/llm_judge/output_schema`, payload)).data,
  },

  jobs: {
    list: async (orgId: string, status?: EvalJobStatus): Promise<EvalJob[]> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return unwrapList<EvalJob>(await http().get(`/api/${orgId}/eval_jobs${query}`));
    },
    create: async (orgId: string, payload: EvalJobPayload): Promise<EvalJob> =>
      (await http().post(`/api/${orgId}/eval_jobs`, payload)).data,
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
