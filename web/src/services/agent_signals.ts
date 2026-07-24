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

/** One row from the `_agent_signals` derived stream. */
export interface AgentSignalRecord {
  _timestamp: number;
  org_id: string;
  source_stream: string;
  /** "failure" | "loop" | "cost" */
  signal_type: string;
  agent_name?: string | null;
  tool_name?: string | null;
  fail_class?: string | null;
  count: number;
  calls?: number | null;
  distinct_traces?: number | null;
  cost?: number | null;
  tokens?: number | null;
  errors?: number | null;
  p95_latency_ns?: number | null;
}

export interface AgentSignalsResponse {
  signals: AgentSignalRecord[];
}

export interface AgentSignalsQuery {
  start_time?: number;
  end_time?: number;
  signal_type?: "failure" | "loop" | "cost";
  source_stream?: string;
}

/**
 * Read pre-computed agent-behavior signals for an org over a window.
 * Hits the small derived `_agent_signals` stream — never raw traces.
 */
const getAgentSignals = (org_identifier: string, query: AgentSignalsQuery = {}) => {
  return http().get<AgentSignalsResponse>(`/api/${org_identifier}/traces/agent_signals`, {
    params: query,
  });
};

export default { getAgentSignals };
