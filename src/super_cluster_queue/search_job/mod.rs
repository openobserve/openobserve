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

pub mod search_job_partitions;
pub mod search_job_results;
pub mod search_jobs;

use config::utils::json;
use infra::{
    coordinator::get_coordinator,
    errors::{Error, Result},
    table::{
        search_job::{
            search_job_partitions::PartitionJobOperator, search_job_results::JobResultOperator,
            search_jobs::JobOperator,
        },
        source_maps::SourceMap,
    },
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};

use crate::service::db::sourcemaps::SOURCEMAP_PREFIX;

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::SearchJob => {
            let operator: JobOperator = json::from_slice(&msg.value.unwrap())?;
            search_jobs::process(operator).await?;
        }
        MessageType::SearchJobPartition => {
            let operator: PartitionJobOperator = json::from_slice(&msg.value.unwrap())?;
            search_job_partitions::process(operator).await?;
        }
        MessageType::SearchJobResult => {
            let operator: JobResultOperator = json::from_slice(&msg.value.unwrap())?;
            search_job_results::process(operator).await?;
        }
        // sourcemap messages also come on the same queue
        MessageType::SourceMapPut => {
            let entry: SourceMap = json::from_slice(&msg.value.unwrap())?;
            let org_id = entry.org.clone();
            let smap = entry.source_map_file_name.clone();
            match infra::table::source_maps::add_many(vec![entry.clone()]).await {
                Ok(_) => {}
                Err(infra::errors::Error::DbError(infra::errors::DbError::UniqueViolation)) => {
                    log::error!("sourcemap file already exists in this cluster : {org_id}/{smap}");
                }
                Err(e) => {
                    log::error!("error while saving sourcemap to db {org_id}/{smap} : {e}");
                }
            }
            let cluster_coordinator = get_coordinator().await;
            cluster_coordinator
                .put(
                    SOURCEMAP_PREFIX,
                    serde_json::to_vec(&entry)?.into(),
                    true,
                    None,
                )
                .await?;
        }
        MessageType::SourceMapDelete => {
            let (org_id, service, env, version): (
                String,
                Option<String>,
                Option<String>,
                Option<String>,
            ) = json::from_slice(&msg.value.unwrap())?;

            match infra::table::source_maps::delete_group(
                &org_id,
                service.clone(),
                env.clone(),
                version.clone(),
            )
            .await
            {
                Ok(_) => {}
                Err(e) => {
                    log::error!(
                        "error while deleting sourceamp for {}/{}/{}/{} : {e}",
                        org_id,
                        service.as_deref().unwrap_or(""),
                        env.as_deref().unwrap_or(""),
                        version.as_deref().unwrap_or("")
                    );
                }
            }

            let cluster_coordinator = get_coordinator().await;
            cluster_coordinator
                .delete(
                    &format!(
                        "{SOURCEMAP_PREFIX}{org_id}/{}/{}/{}",
                        service.as_deref().unwrap_or(""),
                        env.as_deref().unwrap_or(""),
                        version.as_deref().unwrap_or("")
                    ),
                    false,
                    true,
                    None,
                )
                .await?;
        }
        _ => {
            log::error!(
                "[SUPER_CLUSTER:DB] Invalid message for search job: type: {:?}, key: {}",
                msg.message_type,
                msg.key
            );
            return Err(Error::Message("Invalid message type".to_string()));
        }
    }
    Ok(())
}
