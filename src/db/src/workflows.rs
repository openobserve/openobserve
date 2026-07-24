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

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
};

use infra::{
    coordinator::get_coordinator,
    db::Event,
    table::workflows::{Workflow, WorkflowAssociation, WorkflowRunErrors},
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize)]
pub enum AssociationDeleteEvent {
    Workflow {
        org_id: String,
        workflow_id: String,
    },
    Entity {
        org_id: String,
        entity_id: String,
    },
    Trigger {
        org_id: String,
        trigger: String,
    },
    Specific {
        org_id: String,
        entity_id: String,
        workflow_id: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub enum WorkflowTriggerType {
    #[default]
    AlertFired,
    IncidentEvent,
}

impl From<&str> for WorkflowTriggerType {
    fn from(value: &str) -> Self {
        match value {
            "AlertFired" => Self::AlertFired,
            "IncidentEvent" => Self::IncidentEvent,
            _ => Self::AlertFired,
        }
    }
}

impl std::fmt::Display for WorkflowTriggerType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlertFired => write!(f, "AlertFired"),
            Self::IncidentEvent => write!(f, "IncidentEvent"),
        }
    }
}

pub const WORKFLOWS_PREFIX: &str = "/workflows/";

static CACHE: LazyLock<RwLock<HashMap<String, Workflow>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub async fn get_workflow(
    org_id: &str,
    workflow_id: &str,
) -> Result<Option<Workflow>, anyhow::Error> {
    let lock = CACHE.read().await;
    if let Some(workflow) = lock.get(workflow_id)
        && workflow.org_id == org_id
    {
        return Ok(Some(workflow.clone()));
    }
    drop(lock);

    let workflow = infra::table::workflows::get_by_org_wid(org_id, workflow_id).await?;
    if let Some(workflow) = workflow.as_ref() {
        CACHE
            .write()
            .await
            .insert(workflow_id.to_string(), workflow.clone());
    }
    Ok(workflow)
}

pub async fn save_workflow_record(workflow: Workflow) -> Result<(), anyhow::Error> {
    infra::table::workflows::save_workflow(workflow).await?;
    Ok(())
}

pub async fn update_workflow_record(workflow: Workflow) -> Result<(), anyhow::Error> {
    infra::table::workflows::update_workflow(workflow).await?;
    Ok(())
}

pub async fn delete_workflow_record(id: &str) -> Result<(), anyhow::Error> {
    infra::table::workflows::delete_workflow(id).await?;
    Ok(())
}

pub async fn notify_workflow_upsert(workflow: &Workflow) -> Result<(), anyhow::Error> {
    get_coordinator()
        .await
        .put(
            WORKFLOWS_PREFIX,
            serde_json::to_vec(workflow)?.into(),
            true,
            None,
        )
        .await?;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled {
        match o2_enterprise::enterprise::super_cluster::queue::add_workflow(workflow.clone()).await
        {
            Ok(_) => {
                log::info!(
                    "successfully sent workflow upsert notification to super cluster queue for {}/{}",
                    workflow.org_id,
                    workflow.id
                );
            }
            Err(e) => {
                log::error!(
                    "error in sending workflow upsert notification to super cluster queue for {}/{} : {e}",
                    workflow.org_id,
                    workflow.id
                );
            }
        }
    }
    Ok(())
}

pub async fn notify_workflow_delete(id: &str) -> Result<(), anyhow::Error> {
    get_coordinator()
        .await
        .delete(&format!("{WORKFLOWS_PREFIX}{id}"), false, true, None)
        .await?;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled {
        match o2_enterprise::enterprise::super_cluster::queue::delete_workflow(id).await {
            Ok(_) => {
                log::info!(
                    "successfully sent workflow delete notification to super cluster queue for {id}"
                );
            }
            Err(e) => {
                log::error!(
                    "error in sending workflow delete notification to super cluster queue for {id} : {e}"
                );
            }
        }
    }
    Ok(())
}

pub async fn save_workflow_errors(mut errors: WorkflowRunErrors) -> Result<(), anyhow::Error> {
    infra::table::workflows::save_workflow_errors(errors.clone()).await?;

    let org_id = errors.org_id.clone();
    let wid = errors.workflow_id.clone();
    let run_id = errors.run_id.clone();
    // we reset the input data here so we don't need to sent it via nats
    errors.input_data = None;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled {
        match o2_enterprise::enterprise::super_cluster::queue::add_workflow_errors(errors).await {
            Ok(_) => {
                log::info!(
                    "successfully sent workflow errors add notification to super cluster queue for {org_id}/{wid} : run {run_id}",
                );
            }
            Err(e) => {
                log::error!(
                    "error in sending workflow errors add notification to super cluster queue for {org_id}/{wid} : run {run_id} : {e}",
                );
            }
        }
    }
    Ok(())
}

pub async fn update_error_input_file_cluster_data(
    errors: WorkflowRunErrors,
) -> Result<(), anyhow::Error> {
    infra::table::workflows::update_error_input_file_cluster_data(errors).await?;
    Ok(())
}

pub async fn delete_errors_older_than(limit_time: i64) -> Result<usize, anyhow::Error> {
    let entries = infra::table::workflows::delete_all_errors_older_than(limit_time).await?;
    Ok(entries.len())
}

pub async fn delete_runs_older_than(limit_time: i64) -> Result<usize, anyhow::Error> {
    let entries = infra::table::workflows::delete_all_runs_older_than(limit_time).await?;
    Ok(entries.len())
}

pub async fn get_workflow_associations(
    org_id: &str,
    workflow_id: &str,
) -> Result<Vec<WorkflowAssociation>, anyhow::Error> {
    infra::table::workflows::get_all_associations_for_workflow(org_id, workflow_id).await
}

pub async fn associate_workflow(
    org_id: &str,
    workflow_id: &str,
    entity_id: &str,
    entity_type: String,
    trigger_type: String,
) -> Result<(), anyhow::Error> {
    let assoc = WorkflowAssociation {
        id: 0,
        org_id: org_id.to_string(),
        entity_id: entity_id.to_string(),
        entity_type,
        workflow_id: workflow_id.to_string(),
        trigger_type,
        created_at: chrono::Utc::now().timestamp_micros(),
    };
    infra::table::workflows::add_workflow_association(assoc.clone()).await?;
    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::send_workflow_association(
                serde_json::to_string(&assoc)?,
            )
            .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow association notification to super cluster queue for org: {} type {} entity_id: {} workflow_id: {}",
                        assoc.org_id,
                        assoc.trigger_type,
                        assoc.entity_id,
                        assoc.workflow_id
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow association notification to super cluster queue for org: {} type {} entity_id: {} workflow_id: {} : {e}",
                        assoc.org_id,
                        assoc.trigger_type,
                        assoc.entity_id,
                        assoc.workflow_id
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn delete_workflow_association(
    event: AssociationDeleteEvent,
) -> Result<(), anyhow::Error> {
    let org: &str;
    let mut entity = "";
    let mut trigger_type = "";
    let mut workflow = "";
    match &event {
        AssociationDeleteEvent::Entity { org_id, entity_id } => {
            org = org_id;
            entity = entity_id;
            infra::table::workflows::delete_association_by_entity(&org_id, &entity_id).await?;
        }
        AssociationDeleteEvent::Workflow {
            org_id,
            workflow_id,
        } => {
            org = org_id;
            workflow = workflow_id;
            infra::table::workflows::delete_association_by_workflow(&org_id, &workflow_id).await?;
        }
        AssociationDeleteEvent::Trigger { org_id, trigger } => {
            org = org_id;
            trigger_type = trigger;
            infra::table::workflows::delete_association_by_trigger(&org_id, &trigger).await?;
        }
        AssociationDeleteEvent::Specific {
            org_id,
            entity_id,
            workflow_id,
        } => {
            org = org_id;
            entity = entity_id;
            workflow = workflow_id;
            infra::table::workflows::delete_workflow_association(org_id, workflow_id, entity_id)
                .await?;
        }
    }

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            let payload = serde_json::to_string(&event).unwrap();
            match o2_enterprise::enterprise::super_cluster::queue::delete_workflow_association(
                payload,
            )
            .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow association delete notification to super cluster queue for org: {org} trigger_type {trigger_type} entity_id: {entity} workflow_id: {workflow}",
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow association delete notification to super cluster queue for org: {org} trigger_type {trigger_type} entity_id: {entity} workflow_id: {workflow} : {e}",
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let mut events = get_coordinator().await.watch(WORKFLOWS_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching workflow keys");

    loop {
        let Some(event) = events.recv().await else {
            log::error!("watch_workflows: event channel closed");
            return Ok(());
        };

        match event {
            Event::Put(event) => {
                let Some(value) = event.value else {
                    log::error!("watch_workflows: missing value for put");
                    continue;
                };
                let Ok(workflow) = serde_json::from_slice::<Workflow>(&value) else {
                    log::error!("watch_workflows: invalid json value for put");
                    continue;
                };
                CACHE.write().await.remove(&workflow.id);
            }
            Event::Delete(event) => {
                let id = event.key.strip_prefix(WORKFLOWS_PREFIX).unwrap();
                if id.contains('/') {
                    log::error!("watch_workflows: invalid key {id} for delete");
                    continue;
                }
                CACHE.write().await.remove(id);
            }
            Event::Empty => {}
        }
    }
}
