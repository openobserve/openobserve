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

import http from "./http";

export type DataHealthCheckId =
  "unpriced_models" | "missing_agent_identity" | "zero_duration_spans" | "missing_session_id";

export type DataHealthStatus = "pass" | "warning" | "error";

/** Mirrors the backend `ModelUsage` (`gen_ai_health.rs`). */
export interface DataHealthModelUsage {
  model: string;
  spans: number;
  tokens: number;
}

/** Mirrors the backend `HealthCheck`; field names are snake_case on the wire. */
export interface DataHealthCheck {
  id: DataHealthCheckId;
  status: DataHealthStatus;
  affected: number;
  total: number;
  models?: DataHealthModelUsage[];
  samples: string[];
}

export interface DataHealthResponse {
  /** When the checks ran, epoch microseconds (the server caches ~1 min). */
  checked_at: number;
  checks: DataHealthCheck[];
}

export interface DataHealthParams {
  stream_name: string;
  start_time: number;
  end_time: number;
  /** Agent name; the server matches on `agent_id` instead when one is given. */
  agent?: string | null;
  agent_id?: string | null;
  env?: string | null;
  version?: string | null;
  refresh?: boolean;
}

/** GET /api/{org}/gen_ai/data_health — AI data health checks for one stream and window. */
export const getDataHealth = (orgId: string, params: DataHealthParams) => {
  const query: Record<string, string | number | boolean> = {
    stream_name: params.stream_name,
    start_time: params.start_time,
    end_time: params.end_time,
  };
  if (params.agent) query.agent = params.agent;
  if (params.agent_id) query.agent_id = params.agent_id;
  if (params.env) query.env = params.env;
  if (params.version) query.version = params.version;
  if (params.refresh) query.refresh = true;
  return http().get<DataHealthResponse>(`/api/${encodeURIComponent(orgId)}/gen_ai/data_health`, {
    params: query,
  });
};
