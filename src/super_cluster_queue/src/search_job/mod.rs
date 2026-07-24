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

pub mod search_job_partitions;
pub mod search_job_results;
pub mod search_jobs;

use config::utils::json;
use db::{
    sourcemaps::SOURCEMAP_PREFIX,
    workflows::{AssociationDeleteEvent, WORKFLOWS_PREFIX},
};
use infra::{
    coordinator::get_coordinator,
    errors::{Error, Result},
    table::{
        search_job::{
            search_job_partitions::PartitionJobOperator, search_job_results::JobResultOperator,
            search_jobs::JobOperator,
        },
        source_maps::SourceMap,
        workflows::{Workflow, WorkflowAssociation, WorkflowRunErrors},
    },
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType};
use openobserve_core::workflows::{WorkflowTrigger, runtime::WORKFLOW_TRIGGER_PREFIX};

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

        MessageType::WorkflowPut => {
            let workflow: Workflow = json::from_slice(&msg.value.unwrap())?;
            let org_id = workflow.org_id.clone();
            let id = workflow.id.clone();
            log::info!("received workflow put for {org_id}/{id}");

            let existing = infra::table::workflows::get_by_org_wid(&org_id, &id).await?;

            match existing {
                Some(_) => {
                    log::info!("updating existing workflow for {org_id}/{id}");
                    match infra::table::workflows::update_workflow(workflow.clone()).await {
                        Ok(_) => {}
                        Err(e) => {
                            log::error!("error while updating workflow to db {org_id}/{id} : {e}");
                        }
                    }
                }
                None => {
                    log::info!("saving new workflow for {org_id}/{id}");
                    match infra::table::workflows::save_workflow(workflow.clone()).await {
                        Ok(_) => {}
                        Err(e) => {
                            log::error!("error while saving workflow to db {org_id}/{id} : {e}");
                        }
                    }
                }
            }

            log::info!("successfully handled workflow put for {org_id}/{id}");

            let cluster_coordinator = get_coordinator().await;
            cluster_coordinator
                .put(
                    WORKFLOWS_PREFIX,
                    serde_json::to_vec(&workflow)?.into(),
                    true,
                    None,
                )
                .await?;
        }
        MessageType::WorkflowDelete => {
            let id: String = json::from_slice(&msg.value.unwrap())?;
            log::info!("received workflow delete for {id}");
            match infra::table::workflows::delete_workflow(&id).await {
                Ok(_) => {}
                Err(e) => {
                    log::error!("error while deleting workflow from db {id} : {e}");
                }
            }
            log::info!("successfully handled workflow delete for {id}");
            // trigger watch event by putting value to cluster coordinator
            let cluster_coordinator = get_coordinator().await;
            cluster_coordinator
                .delete(&format!("{WORKFLOWS_PREFIX}{id}",), false, true, None)
                .await?;
        }
        MessageType::WorkflowErrorPut => {
            let errors: WorkflowRunErrors = json::from_slice(&msg.value.unwrap())?;
            let org_id = errors.org_id.clone();
            let wid = errors.workflow_id.clone();
            let run_id = errors.run_id.clone();
            log::info!(
                "received workflow errors store notification for {org_id}/{wid} : run {run_id}"
            );
            match infra::table::workflows::save_workflow_errors(errors.clone()).await {
                Ok(_) => {
                    log::info!(
                        "successfully handled workflow errors store notification for {org_id}/{wid} : run {run_id}"
                    );
                }
                Err(e) => {
                    log::info!(
                        "error in handling workflow errors store notification for {org_id}/{wid} : run {run_id} : {e}"
                    );
                }
            }
        }

        MessageType::WorkflowTriggerPut => {
            let trigger: WorkflowTrigger = json::from_slice(&msg.value.unwrap())?;
            log::info!(
                "received workflow trigger notification for type: {:?} workflow_id: {} trace_id: {}",
                trigger.trigger_type,
                trigger.workflow_id,
                trigger.trace_id
            );
            let cluster_coordinator = get_coordinator().await;
            cluster_coordinator
                .put(
                    WORKFLOW_TRIGGER_PREFIX,
                    serde_json::to_vec(&trigger)?.into(),
                    true,
                    None,
                )
                .await?;
        }

        MessageType::WorkflowAssociationPut => {
            let assoc: WorkflowAssociation = json::from_slice(&msg.value.unwrap())?;
            let org_id = assoc.org_id.clone();
            let wid = assoc.workflow_id.clone();
            let eid = assoc.entity_id.clone();
            let ttyp = assoc.trigger_type.clone();
            log::info!(
                "received workflow association store notification for {org_id} trigger_type: {ttyp} entity_id {eid} workflow_id {wid}"
            );
            match infra::table::workflows::add_workflow_association(assoc).await {
                Ok(_) => {
                    log::info!(
                        "successfully handled workflow association store notification for {org_id} trigger_type: {ttyp} entity_id {eid} workflow_id {wid}"
                    );
                }
                Err(e) => {
                    log::info!(
                        "error in handling workflow association store notification for {org_id} trigger_type: {ttyp} entity_id {eid} workflow_id {wid}: {e}"
                    );
                }
            }
        }

        MessageType::WorkflowAssociationDelete => {
            let event: AssociationDeleteEvent = json::from_slice(&msg.value.unwrap())?;
            match &event {
                AssociationDeleteEvent::Entity { org_id, entity_id } => {
                    infra::table::workflows::delete_association_by_entity(&org_id, &entity_id)
                        .await?;
                }
                AssociationDeleteEvent::Workflow {
                    org_id,
                    workflow_id,
                } => {
                    infra::table::workflows::delete_association_by_workflow(&org_id, &workflow_id)
                        .await?;
                }
                AssociationDeleteEvent::Trigger { org_id, trigger } => {
                    infra::table::workflows::delete_association_by_trigger(&org_id, &trigger)
                        .await?;
                }
            }
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
