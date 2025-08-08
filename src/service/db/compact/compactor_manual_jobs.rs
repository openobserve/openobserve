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

use config::meta::stream::StreamType;
use infra::{
    errors,
    table::compactor_manual_jobs::{
        CompactorManualJob, Status, add, bulk_update, get, get_by_key, list_by_key,
    },
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;

use crate::service::db::compact::retention::mk_key;

pub async fn list_jobs_by_key(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    date_range: Option<(&str, &str)>,
) -> Vec<CompactorManualJob> {
    let key = mk_key(org_id, stream_type, stream_name, date_range);
    list_by_key(&key).await.unwrap_or_default()
}

pub async fn add_job(job: CompactorManualJob) -> Result<String, errors::Error> {
    // Check if pending job already exists
    if let Ok(existing_job) = get_by_key(&job.key, Some(Status::Pending)).await {
        return Ok(existing_job.id);
    }

    // Insert job
    let job_id = job.id.clone();
    add(job.clone()).await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        // Serialize for super cluster queue
        let job_str: String = job.try_into().map_err(|_| {
            errors::Error::Message("failed to convert compactor manual job to string".to_string())
        })?;

        o2_enterprise::enterprise::super_cluster::queue::put(
            "/compact_manual_jobs/",
            job_str.into(),
            false,
            None,
        )
        .await
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    }

    Ok(job_id)
}

// Bulk update jobs, intentionally does not do super cluster sync
// to keep the updates of the job local to the cluster
pub async fn bulk_update_jobs(jobs: Vec<CompactorManualJob>) -> Result<(), errors::Error> {
    bulk_update(jobs).await
}

pub async fn get_job(ksuid: &str) -> Result<CompactorManualJob, errors::Error> {
    get(ksuid).await
}
