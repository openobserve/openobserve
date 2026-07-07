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

// Workflows API layer. Mirrors services/pipelines.ts.
//
// Only the routes that exist on `feat/workflows_v1` are implemented here
// (handler/http/router/mod.rs:857-861):
//   GET    /api/{org}/workflows                  list
//   POST   /api/{org}/workflows                  create (save)
//   PUT    /api/{org}/workflows/{id}             update
//   DELETE /api/{org}/workflows/{id}             delete
//   POST   /api/{org}/workflows/{id}/test        dry-run (per-node errors)
//   GET    /api/{org}/workflows/{id}/errors      run/error history (Runs tab)
//   POST   /api/{org}/workflows/{id}/retry       re-run a failed run
//
// Not yet on the backend (plan tasks B5/B6): GET /workflows/{id} (load-by-id),
// GET /workflows/{id}/runs (success log), and an enable/toggle route. Add the
// corresponding methods here once those land.
const workflows = {
  listWorkflows: (org_identifier: string) => {
    const url = `/api/${org_identifier}/workflows`;
    return http().get(url);
  },

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
  //   PUT /api/{org}/workflows/{id}/enable?value=true|false
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

  // Dry-run the workflow against a sample payload. `from_node` runs from a
  // specific node (the backend's "run from here" affordance).
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

  getWorkflowErrors: ({
    org_identifier,
    id,
  }: {
    org_identifier: string;
    id: string;
  }) => {
    const url = `/api/${org_identifier}/workflows/${id}/errors`;
    return http().get(url);
  },

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
