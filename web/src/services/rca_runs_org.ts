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

/** The stored run state; `refused` is a failed run that never started. */
export type OrgRcaRunState =
  "running" | "waiting_input" | "completed" | "failed" | "refused" | "cancelled";

/** One incident RCA run of the org; times in microseconds, nullable fields always present. */
export interface OrgRcaRun {
  run_id: string;
  incident_id: string;
  incident_title: string | null;
  severity: string | null;
  state: OrgRcaRunState;
  trigger: "auto" | "manual";
  started_at: number;
  ended_at: number | null;
  error_code: string | null;
}

export interface OrgRcaRunsResponse {
  runs: OrgRcaRun[];
  has_more: boolean;
}

/** The list's filters; every one is optional and `limit` is 1 to 100. */
export interface OrgRcaRunsParams {
  state?: "failed" | "refused" | "running";
  trigger?: "auto" | "manual";
  since?: number;
  limit?: number;
  before?: string;
}

/** Org-wide RCA runs, newest first (C2). */
export function listOrgRcaRuns(org: string, params: OrgRcaRunsParams = {}) {
  return http().get<OrgRcaRunsResponse>(`/api/v2/${org}/alerts/rca_runs`, { params });
}
