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
        background_job_partitions::Model as PartitionJob, background_jobs::Model as Job,
    },
};

// query background_jobs table
pub async fn get_job() -> Result<Option<Job>, errors::Error> {
    infra::table::background_jobs::get_job().await
}

pub async fn set_error_message(job_id: i32, error_message: &str) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_error_message(job_id, error_message).await
}

pub async fn set_status(id: i32, status: i32) -> Result<(), errors::Error> {
    infra::table::background_jobs::set_status(id, status).await
}

// query background_job_partitions table
pub async fn is_have_partition_jobs(job_id: i32) -> Result<bool, errors::Error> {
    infra::table::background_job_partitions::is_have_partition_jobs(job_id).await
}

pub async fn submit_partitions(job_id: i32, partitions: &[[i64; 2]]) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::submit_partitions(job_id, partitions).await
}

pub async fn get_partition_jobs_by_job_id(job_id: i32) -> Result<Vec<PartitionJob>, errors::Error> {
    infra::table::background_job_partitions::get_partition_jobs_by_job_id(job_id).await
}

pub async fn set_partition_status(
    job_id: i32,
    partition_id: i32,
    status: i32,
) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::set_partition_status(job_id, partition_id, status)
        .await
}

pub async fn set_partition_error_message(
    job_id: i32,
    partition_id: i32,
    error_message: &str,
) -> Result<(), errors::Error> {
    infra::table::background_job_partitions::set_partition_error_message(
        job_id,
        partition_id,
        error_message,
    )
    .await
}
