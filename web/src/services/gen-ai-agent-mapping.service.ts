// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import http from "./http";

export const GEN_AI_AGENT_MAPPING_DEFAULTS_URL =
  "https://raw.githubusercontent.com/openobserve/sdr_patterns/main/gen_ai_agent_mappings.json";

export interface GenAiAgentMappingConfig {
  agent_name_fields: string[];
  agent_id_fields: string[];
}

export interface GenAiAgentListItem {
  name: string;
  id?: string | null;
  source_stream: string;
  source_stream_type: string;
}

export interface GenAiAgentListResponse {
  agents: GenAiAgentListItem[];
}

const emptyConfig = (): GenAiAgentMappingConfig => ({
  agent_name_fields: [],
  agent_id_fields: [],
});

const normalizeConfig = (value: any): GenAiAgentMappingConfig => ({
  agent_name_fields: Array.isArray(value?.agent_name_fields)
    ? value.agent_name_fields.filter((field: any) => typeof field === "string")
    : [],
  agent_id_fields: Array.isArray(value?.agent_id_fields)
    ? value.agent_id_fields.filter((field: any) => typeof field === "string")
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
    const agents = Array.isArray(response.data?.agents)
      ? response.data.agents
      : [];
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
        })),
    };
  },
  get: async (orgIdentifier: string) => {
    const response = await http().get(
      `/api/${orgIdentifier}/settings/gen_ai/agent_mapping`,
    );
    return normalizeConfig(response.data);
  },
  save: async (orgIdentifier: string, config: GenAiAgentMappingConfig) => {
    const response = await http().put(
      `/api/${orgIdentifier}/settings/gen_ai/agent_mapping`,
      normalizeConfig(config),
    );
    return normalizeConfig(response.data);
  },
};

export default genAiAgentMappingService;
