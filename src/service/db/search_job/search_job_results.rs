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

use infra::{errors, table::entity::search_job_results::Model as JobResult};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;

// query search_job_results table
pub async fn get_job_result(job_id: &str) -> Result<Vec<JobResult>, errors::Error> {
    infra::table::search_job::search_job_results::get(job_id).await
}

pub async fn clean_deleted_job_result(job_id: &str) -> Result<(), errors::Error> {
    infra::table::search_job::search_job_results::clean_deleted_job_result(job_id).await?;

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {}

    Ok(())
}
