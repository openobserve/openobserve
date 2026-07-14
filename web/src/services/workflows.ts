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

const workflows = {
  // List all workflows for the org .
  listWorkflows: (org_identifier: string) => {
    const url = `/api/${org_identifier}/workflows`;
    return http().get(url);
  },

  // Save a new workflow.
  createWorkflow: ({
    org_identifier,
    data,
  }: {
    org_identifier: string;
    data: object;
  }) => {
    const url = `/api/${org_identifier}/workflows`;
    return http().post(url, data);
  },

  // Update an existing workflow by id.
  updateWorkflow: ({
    org_identifier,
    id,
    data,
  }: {
    org_identifier: string;
    id: string;
    data: object;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}`;
    return http().put(url, data);
  },

  // Delete a workflow by id.
  deleteWorkflow: ({
    org_identifier,
    id,
  }: {
    org_identifier: string;
    id: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}`;
    return http().delete(url);
  },

  // Enable/disable (pause/resume) a workflow.
  enableWorkflow: ({
    org_identifier,
    id,
    value,
  }: {
    org_identifier: string;
    id: string;
    value: boolean;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/enable?value=${value}`;
    return http().put(url);
  },

  // Dry-run the workflow against a sample payload. `from_node` re-runs from a
  // specific node.
  testWorkflow: ({
    org_identifier,
    id,
    inputs,
    from_node,
  }: {
    org_identifier: string;
    id: string;
    inputs: any[];
    from_node?: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/test`;
    return http().post(url, { inputs, from_node });
  },

  // Run history for a workflow. `start_time`/`end_time` are Unix microseconds;
  // the backend defaults to the last 7 days when omitted. Returns an array of
  // runs ({ _timestamp, start_time, end_time, evaluation_took_in_secs, error,
  // event_type, source_id, run_id, ... }); `error` is null on success.
  getWorkflowHistory: ({
    org_identifier,
    id,
    start_time,
    end_time,
  }: {
    org_identifier: string;
    id: string;
    start_time?: number;
    end_time?: number;
  }) => {
    const params = new URLSearchParams();
    if (start_time != null) params.set("start_time", String(start_time));
    if (end_time != null) params.set("end_time", String(end_time));
    const qs = params.toString();
    const url = `/api/${org_identifier}/workflows/${id}/history${qs ? `?${qs}` : ""}`;
    return http().get(url);
  },

  // Detail of a single run — errors (per errored node) plus the run's input
  // data (`complete` = full workflow input, `node_map` = per-node input the
  // node processed/errored on). Powers the read-only run inspection in the
  // editor (click a run in history -> error nodes show Input/Output).
  getWorkflowRun: ({
    org_identifier,
    id,
    run_id,
  }: {
    org_identifier: string;
    id: string;
    run_id: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/errors/${run_id}`;
    return http().get(url);
  },

  // Re-run a failed run, optionally from a specific node.
  retryWorkflow: ({
    org_identifier,
    id,
    run_id,
    from_node,
  }: {
    org_identifier: string;
    id: string;
    run_id: string;
    from_node?: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/retry`;
    return http().post(url, { run_id, from_node });
  },
};

export default workflows;
