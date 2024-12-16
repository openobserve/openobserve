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
    table::entity::{
        background_job_partitions::Model as PartitionJob,
        background_job_results::Model as JobResult, background_jobs::Model as Job,
    },
};

pub async fn submit(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &str,
    payload: &str,
    start_time: i64,
    end_time: i64,
) -> Result<String, errors::Error> {
    infra::table::background_jobs::submit(
        trace_id,
        org_id,
        user_id,
        stream_type,
        payload,
        start_time,
        end_time,
    )
    .await
}

// get a oldest job and lock it
pub async fn get_job() -> Result<Option<Job>, errors::Error> {
    infra::table::background_jobs::get_job().await
}

pub async fn list_status_by_org_id(org_id: &str) -> Result<Vec<Job>, errors::Error> {
    infra::table::background_jobs::list_status_by_org_id(org_id).await
}

pub async fn get_deleted_jobs() -> Result<Vec<Job>, errors::Error> {
    infra::table::background_jobs::get_deleted_jobs().await
}

pub async fn get(job_id: &str) -> Result<Job, errors::Error> {
    infra::table::background_jobs::get(job_id).await
}

pub async fn cancel_job_by_job_id(job_id: &str) -> Result<i32, errors::Error> {
    infra::table::background_jobs::cancel_job_by_job_id(job_id).await
}

pub async fn set_job_error_message(job_id: &str, error_message: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_job_error_message(job_id, error_message).await
}

pub async fn set_job_finish(job_id: &str, path: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_job_finish(job_id, path).await
}

pub async fn set_partition_num(job_id: &str, partition_num: i32) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_partition_num(job_id, partition_num).await
}

pub async fn set_job_deleted(job_id: &str) -> Result<bool, errors::Error> {
    infra::table::background_jobs::set_job_deleted(job_id).await
}

pub async fn update_running_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::update_running_job(job_id).await
}

pub async fn check_running_jobs(updated_at: i64) -> Result<(), errors::Error> {
    infra::table::background_jobs::check_running_jobs(updated_at).await
}

pub async fn clean_deleted_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::clean_deleted_job(job_id).await
}

pub async fn retry_background_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::retry_background_job(job_id).await
}

// query background_job_partitions table
pub async fn cancel_partition_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::cancel_partition_job(job_id).await
}

pub async fn submit_partitions(job_id: &str, partitions: &[[i64; 2]]) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::submit_partitions(job_id, partitions).await
}

pub async fn get_partition_jobs(job_id: &str) -> Result<Vec<PartitionJob>, errors::Error> {
    infra::table::background_job_partitions::get_partition_jobs(job_id).await
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

pub async fn clean_deleted_partition_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::clean_deleted_partition_job(job_id).await
}

// query background_job_results table
pub async fn get_job_result(job_id: &str) -> Result<Vec<JobResult>, errors::Error> {
    infra::table::background_job_results::get(job_id).await
}

pub async fn clean_deleted_job_result(job_id: &str) -> Result<(), errors::Error> {
    infra::table::background_job_results::clean_deleted_job_result(job_id).await
}
