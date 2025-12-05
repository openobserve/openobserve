// Copyright 2025 OpenObserve Inc.
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

export interface CreateBackfillJobRequest {
  start_time: string | number; // ISO 8601 string or microseconds
  end_time: string | number;
  chunk_period_minutes?: number;
  delay_between_chunks_secs?: number;
  delete_before_backfill?: boolean;
}

export interface CreateBackfillJobResponse {
  job_id: string;
  message: string;
}

export type DeletionStatus =
  | "not_required"
  | "pending"
  | "in_progress"
  | "completed"
  | { failed: string };

export interface BackfillJob {
  job_id: string;
  pipeline_id: string;
  pipeline_name: string | null;
  start_time: number; // microseconds
  end_time: number; // microseconds
  current_position: number; // microseconds
  progress_percent: number; // 0-100
  status: "running" | "completed" | "failed" | "pending" | "canceled";
  deletion_status?: DeletionStatus;
  deletion_job_id?: string;
  created_at?: number; // microseconds
  chunks_completed?: number;
  chunks_total?: number;
}

export interface CancelBackfillJobResponse {
  message: string;
}

const backfill = {
  /**
   * Create a new backfill job for a pipeline
   */
  createBackfillJob: ({
    org_id,
    pipeline_id,
    data,
  }: {
    org_id: string;
    pipeline_id: string;
    data: CreateBackfillJobRequest;
  }): Promise<CreateBackfillJobResponse> => {
    const url = `/api/${org_id}/backfill/pipelines/${pipeline_id}`;
    return http().post(url, data);
  },

  /**
   * List all backfill jobs for an organization
   */
  listBackfillJobs: ({
    org_id,
  }: {
    org_id: string;
  }): Promise<BackfillJob[]> => {
    const url = `/api/${org_id}/backfill/jobs`;
    return http().get(url);
  },

  /**
   * Get details of a specific backfill job
   */
  getBackfillJob: ({
    org_id,
    job_id,
  }: {
    org_id: string;
    job_id: string;
  }): Promise<BackfillJob> => {
    const url = `/api/${org_id}/backfill/jobs/${job_id}`;
    return http().get(url);
  },

  /**
   * Cancel a running backfill job
   */
  cancelBackfillJob: ({
    org_id,
    job_id,
  }: {
    org_id: string;
    job_id: string;
  }): Promise<CancelBackfillJobResponse> => {
    const url = `/api/${org_id}/backfill/jobs/${job_id}`;
    return http().delete(url);
  },
};

export default backfill;
