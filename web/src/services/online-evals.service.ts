// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "@/services/http";

export type EvalJobStatus = "draft" | "active" | "paused" | "degraded" | "archived";
export type SamplingMode = "rate" | "all" | "count";
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
  filterCondition?: any;
  filter_condition?: any;
  scorers: EvalJobScorerRef[];
  inputMapping?: Record<string, Record<string, string>> | null;
  input_mapping?: Record<string, Record<string, string>> | null;
  samplingMode?: SamplingMode;
  sampling_mode?: SamplingMode;
  samplingValue?: any;
  sampling_value?: any;
  status: EvalJobStatus;
  version: number;
  pipelineId?: string | null;
  pipeline_id?: string | null;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
}

export interface EvalJobPayload {
  name: string;
  description?: string | null;
  stream: string;
  streamType: string;
  filterCondition: any;
  scorers: ScorerRef[];
  inputMapping?: Record<string, Record<string, string>> | null;
  samplingMode: SamplingMode;
  samplingValue: any;
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
    ): Promise<Scorer> =>
      (await http().put(`/api/${orgId}/scorers/${entityId}`, payload)).data,
    delete: async (orgId: string, entityId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/scorers/${entityId}`);
    },
  },

  jobs: {
    list: async (orgId: string, status?: EvalJobStatus): Promise<EvalJob[]> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      return unwrapList<EvalJob>(await http().get(`/api/${orgId}/eval_jobs${query}`));
    },
    create: async (orgId: string, payload: EvalJobPayload): Promise<EvalJob> =>
      (await http().post(`/api/${orgId}/eval_jobs`, payload)).data,
    update: async (
      orgId: string,
      jobId: string,
      payload: EvalJobPayload,
    ): Promise<EvalJob> =>
      (await http().put(`/api/${orgId}/eval_jobs/${jobId}`, payload)).data,
    delete: async (orgId: string, jobId: string): Promise<void> => {
      await http().delete(`/api/${orgId}/eval_jobs/${jobId}`);
    },
  },
};

export default onlineEvalsService;
