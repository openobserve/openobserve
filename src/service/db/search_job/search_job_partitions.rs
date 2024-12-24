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

use infra::{errors, table::entity::search_job_partitions::Model as PartitionJob};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;

// query search_job_partitions table
pub async fn cancel_partition_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::search_job::search_job_partitions::cancel_partition_job(job_id).await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}

pub async fn submit_partitions(job_id: &str, partitions: &[[i64; 2]]) -> Result<(), errors::Error> {
    let created_at = chrono::Utc::now().timestamp_micros();
    infra::table::search_job::search_job_partitions::submit_partitions(
        job_id, partitions, created_at,
    )
    .await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}

pub async fn get_partition_jobs(job_id: &str) -> Result<Vec<PartitionJob>, errors::Error> {
    infra::table::search_job::search_job_partitions::get_partition_jobs(job_id).await
}

pub async fn set_partition_job_start(job_id: &str, partition_id: i64) -> Result<(), errors::Error> {
    let updated_at = chrono::Utc::now().timestamp_micros();
    infra::table::search_job::search_job_partitions::set_partition_job_start(
        job_id,
        partition_id,
        updated_at,
    )
    .await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}

pub async fn set_partition_job_finish(
    job_id: &str,
    partition_id: i64,
    path: &str,
) -> Result<(), errors::Error> {
    let updated_at = chrono::Utc::now().timestamp_micros();
    infra::table::search_job::search_job_partitions::set_partition_job_finish(
        job_id,
        partition_id,
        path,
        updated_at,
    )
    .await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}

pub async fn set_partition_job_error_message(
    job_id: &str,
    partition_id: i64,
    error_message: &str,
) -> Result<(), errors::Error> {
    infra::table::search_job::search_job_partitions::set_partition_job_error_message(
        job_id,
        partition_id,
        error_message,
    )
    .await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}

pub async fn clean_deleted_partition_job(job_id: &str) -> Result<(), errors::Error> {
    infra::table::search_job::search_job_partitions::clean_deleted_partition_job(job_id).await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}
