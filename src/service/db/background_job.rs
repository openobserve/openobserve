// Copyright 2024 OpenObserve Inc.
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

use infra::{
    errors,
    table::{
        background_jobs::JobResult,
        entity::{background_job_partitions::Model as PartitionJob, background_jobs::Model as Job},
    },
};

// query background_jobs table
pub async fn get_job() -> Result<Option<Job>, errors::Error> {
    infra::table::background_jobs::get_job().await
}

pub async fn get_status_by_org_id(org_id: &str) -> Result<Vec<Job>, errors::Error> {
    infra::table::background_jobs::get_status_by_org_id(org_id).await
}

pub async fn get_status_by_job_id(job_id: &str) -> Result<Vec<Job>, errors::Error> {
    infra::table::background_jobs::get_status_by_job_id(job_id).await
}

pub async fn get_trace_id(job_id: &str) -> Result<Option<String>, errors::Error> {
    infra::table::background_jobs::get_trace_id(job_id).await
}

pub async fn cancel_job(job_id: &str) -> Result<i32, errors::Error> {
    infra::table::background_jobs::cancel_job(job_id).await
}

pub async fn set_job_error_message(job_id: &str, error_message: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_job_error_message(job_id, error_message).await
}

pub async fn set_job_finish(job_id: &str, path: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_job_finish(job_id, path).await
}

pub async fn update_running_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::update_running_job(job_id).await
}

pub async fn check_running_jobs(updated_at: i64) -> Result<(), errors::Error> {
    infra::table::background_jobs::check_running_jobs(updated_at).await
}

pub async fn get_result_path(job_id: &str) -> Result<JobResult, errors::Error> {
    infra::table::background_jobs::get_result_path(job_id).await
}

// query background_job_partitions table
pub async fn cancel_partition_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::cancel_partition_job(job_id).await
}

pub async fn is_have_partition_jobs(job_id: &str) -> Result<bool, errors::Error> {
    infra::table::background_job_partitions::is_have_partition_jobs(job_id).await
}

pub async fn submit_partitions(job_id: &str, partitions: &[[i64; 2]]) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::submit_partitions(job_id, partitions).await
}

pub async fn get_partition_jobs_by_job_id(
    job_id: &str,
) -> Result<Vec<PartitionJob>, errors::Error> {
    infra::table::background_job_partitions::get_partition_jobs_by_job_id(job_id).await
}

pub async fn set_partition_job_start(job_id: &str, partition_id: i32) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::set_partition_job_start(job_id, partition_id).await
}

pub async fn set_partition_job_finish(
    job_id: &str,
    partition_id: i32,
    path: &str,
) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::set_partition_job_finish(job_id, partition_id, path)
        .await
}

pub async fn set_partition_job_error_message(
    job_id: &str,
    partition_id: i32,
    error_message: &str,
) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::set_partition_job_error_message(
        job_id,
        partition_id,
        error_message,
    )
    .await
}
