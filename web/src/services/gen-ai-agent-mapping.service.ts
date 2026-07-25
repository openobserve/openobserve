// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "./http";
import { RETENTION_MS } from "@/plugins/traces/versionCompare/constants";

/** One arm (A or B) of a version-compare request — mirrors the backend
 * `CompareArm` struct (`src/core/src/traces/agent_signals/api.rs`). Times are
 * epoch microseconds. */
export interface CompareArmRequest {
  agent_name: string;
  env?: string | null;
  version?: string | null;
  start_time: number;
  end_time: number;
}

/** Mirrors the backend `MetricDelta` struct
 * (`o2_enterprise/.../agent_signals/compare.rs`) exactly — field names are
 * NOT camelCased on the wire. */
export interface MetricDelta {
  a: number;
  b: number;
  delta: number;
  lo: number;
  hi: number;
  straddles_zero: boolean;
  insufficient: boolean;
}

export interface CompareAgentVersionsResponse {
  p50: MetricDelta;
  p95: MetricDelta;
  p99: MetricDelta;
  cost: MetricDelta;
}

/**
 * POST /api/{org}/traces/agent_signals/compare — sketch-merge version
 * comparison. Returns pre-aggregated latency (p50/p95/p99) + cost deltas
 * with CIs; does NOT return error-rate (that stays on the KPI path — see
 * `useVersionCompare.run`).
 */
export const compareAgentVersions = (
  org_identifier: string,
  a: CompareArmRequest,
  b: CompareArmRequest,
) => {
  return http().post<CompareAgentVersionsResponse>(
    `/api/${org_identifier}/traces/agent_signals/compare`,
    { a, b },
  );
};

export const GEN_AI_AGENT_MAPPING_DEFAULTS_URL =
  "https://raw.githubusercontent.com/openobserve/sdr_patterns/main/gen_ai_agent_mappings.json";

export interface GenAiAgentMappingConfig {
  agent_name_fields: string[];
  agent_id_fields: string[];
  env_fields: string[];
  version_fields: string[];
}

export interface GenAiAgentListItem {
  name: string;
  id?: string | null;
  source_stream: string;
  source_stream_type: string;
  env?: string | null;
  version?: string | null;
  first_seen?: number | null;
  last_seen?: number | null;
}

export interface GenAiAgentListResponse {
  agents: GenAiAgentListItem[];
}

export interface ClearGenAiAgentRegistryResponse {
  source_stream?: string | null;
  source_stream_type?: string | null;
  deleted_count: number;
  cleared_buffer_count: number;
}

const emptyConfig = (): GenAiAgentMappingConfig => ({
  agent_name_fields: [],
  agent_id_fields: [],
  env_fields: [],
  version_fields: [],
});

const normalizeConfig = (value: any): GenAiAgentMappingConfig => ({
  agent_name_fields: Array.isArray(value?.agent_name_fields)
    ? value.agent_name_fields.filter((field: any) => typeof field === "string")
    : [],
  agent_id_fields: Array.isArray(value?.agent_id_fields)
    ? value.agent_id_fields.filter((field: any) => typeof field === "string")
    : [],
  env_fields: Array.isArray(value?.env_fields)
    ? value.env_fields.filter((field: any) => typeof field === "string")
    : [],
  version_fields: Array.isArray(value?.version_fields)
    ? value.version_fields.filter((field: any) => typeof field === "string")
    : [],
});

export async function fetchDefaultGenAiAgentMapping(): Promise<GenAiAgentMappingConfig> {
  const response = await fetch(GEN_AI_AGENT_MAPPING_DEFAULTS_URL, {
    credentials: "omit",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch defaults (${response.status})`);
  }

  return normalizeConfig(await response.json());
}

const genAiAgentMappingService = {
  emptyConfig,
  listAgents: async (
    orgIdentifier: string,
    startTime: number,
    endTime: number,
  ): Promise<GenAiAgentListResponse> => {
    const response = await http().get(`/api/${orgIdentifier}/gen_ai/agents`, {
      params: {
        start_time: startTime,
        end_time: endTime,
      },
    });
    const agents = Array.isArray(response.data?.agents) ? response.data.agents : [];
    return {
      agents: agents
        .filter(
          (agent: any) =>
            typeof agent?.name === "string" &&
            agent.name.length > 0 &&
            typeof agent.source_stream === "string" &&
            typeof agent.source_stream_type === "string",
        )
        .map((agent: any) => ({
          name: agent.name,
          id: typeof agent.id === "string" ? agent.id : null,
          source_stream: agent.source_stream,
          source_stream_type: agent.source_stream_type,
          env: typeof agent.env === "string" ? agent.env : null,
          version: typeof agent.version === "string" ? agent.version : null,
          first_seen: typeof agent.first_seen === "number" ? agent.first_seen : null,
          last_seen: typeof agent.last_seen === "number" ? agent.last_seen : null,
        })),
    };
  },
  get: async (orgIdentifier: string) => {
    const response = await http().get(`/api/${orgIdentifier}/settings/gen_ai/agent_mapping`);
    return normalizeConfig(response.data);
  },
  save: async (orgIdentifier: string, config: GenAiAgentMappingConfig) => {
    const response = await http().put(
      `/api/${orgIdentifier}/settings/gen_ai/agent_mapping`,
      normalizeConfig(config),
    );
    return normalizeConfig(response.data);
  },
  // Wide-window (retention-scoped) version enumeration for the version-compare
  // slot pickers. Deliberately ignores the page date-picker window: a baseline
  // version's last_seen may predate the page window, and it must still appear
  // as a selectable compare slot. UNIT CONTRACT: `nowMicros` is epoch
  // MICROSECONDS (= Date.now() * 1000). RETENTION_MS is milliseconds, so it is
  // multiplied by 1000 here to convert to microseconds before subtracting.
  listVersionsForCompare: async (
    orgIdentifier: string,
    agentName: string,
    env: string | null,
    nowMicros: number,
  ): Promise<GenAiAgentListItem[]> => {
    const start = nowMicros - RETENTION_MS * 1000;
    const response = await genAiAgentMappingService.listAgents(orgIdentifier, start, nowMicros);
    return response.agents.filter(
      (agent) =>
        agent.name === agentName &&
        (env === null || agent.env === env) &&
        agent.version !== null &&
        agent.version !== undefined,
    );
  },
  clearRegistry: async (orgIdentifier: string): Promise<ClearGenAiAgentRegistryResponse> => {
    const response = await http().delete(`/api/${orgIdentifier}/settings/gen_ai/agent_registry`);
    return {
      source_stream:
        typeof response.data?.source_stream === "string" ? response.data.source_stream : null,
      source_stream_type:
        typeof response.data?.source_stream_type === "string"
          ? response.data.source_stream_type
          : null,
      deleted_count: Number(response.data?.deleted_count) || 0,
      cleared_buffer_count: Number(response.data?.cleared_buffer_count) || 0,
    };
  },
};

export default genAiAgentMappingService;
