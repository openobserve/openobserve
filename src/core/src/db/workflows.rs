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

use config::get_config;
use infra::{
    coordinator::get_coordinator,
    db::Event,
    table::workflows::{Workflow, WorkflowRunErrors},
};
use tokio::sync::RwLock;

use crate::{
    common::{
        meta::authz::Authz,
        utils::auth::{remove_ownership, set_ownership},
    },
    service::{
        db,
        workflows::{WorkflowTrigger, handle_workflow_trigger},
    },
};

const CHECK_INTERVAL_MIN: u64 = 30;
pub const WORKFLOWS_PREFIX: &str = "/workflows/";
pub const WORKFLOW_TRIGGER_PREFIX: &str = "/workflow_trigger/";

static CACHE: LazyLock<RwLock<HashMap<String, Workflow>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub async fn get_workflow(
    org_id: &str,
    workflow_id: &str,
) -> Result<Option<Workflow>, anyhow::Error> {
    let lock = CACHE.read().await;
    let temp = lock.get(workflow_id);

    if let Some(w) = temp
        && w.org_id == org_id
    {
        return Ok(Some(w.clone()));
    }
    drop(lock);

    let ret = infra::table::workflows::get_by_org_wid(org_id, workflow_id).await?;

    if let Some(w) = ret.as_ref() {
        let mut lock = CACHE.write().await;
        lock.insert(workflow_id.to_string(), w.clone());
        drop(lock);
    }
    Ok(ret)
}

pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    infra::table::workflows::save_workflow(workflow.clone()).await?;
    set_ownership(&workflow.org_id, "workflows", Authz::new(&workflow.id)).await;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            WORKFLOWS_PREFIX,
            serde_json::to_vec(&workflow)?.into(),
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::add_workflow(workflow.clone())
                .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow add notification to super cluster queue for {}/{}",
                        workflow.org_id,
                        workflow.id
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow add notification to super cluster queue for {}/{} : {e}",
                        workflow.org_id,
                        workflow.id
                    );
                }
            }
        }
    }

    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    infra::table::workflows::update_workflow(workflow.clone()).await?;

    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            WORKFLOWS_PREFIX,
            serde_json::to_vec(&workflow)?.into(),
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::add_workflow(workflow.clone())
                .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow update notification to super cluster queue for {}/{}",
                        workflow.org_id,
                        workflow.id
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow update notification to super cluster queue for {}/{} : {e}",
                        workflow.org_id,
                        workflow.id
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn delete_workflow(org_id: &str, id: &str) -> Result<(), anyhow::Error> {
    infra::table::workflows::delete_workflow(id).await?;
    remove_ownership(org_id, "workflows", Authz::new(id)).await;
    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .delete(&format!("{WORKFLOWS_PREFIX}{id}",), false, true, None)
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::delete_workflow(id).await {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow delete notification to super cluster queue for {id}",
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow delete notification to super cluster queue for {id} : {e}",
                    );
                }
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
    // no need for cluster sync for errors

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::add_workflow_errors(errors).await
            {
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
    }
    Ok(())
}

pub async fn update_error_input_file_cluster_data(
    errors: WorkflowRunErrors,
) -> Result<(), anyhow::Error> {
    infra::table::workflows::update_error_input_file_cluster_data(errors).await?;
    Ok(())
}

pub async fn clean() {
    let cfg = get_config();
    let duration_limit = cfg.limit.workflow_error_retention_secs * 1000 * 1000;

    let mut interval = tokio::time::interval(tokio::time::Duration::from_mins(CHECK_INTERVAL_MIN));

    loop {
        interval.tick().await;
        let now = chrono::Utc::now().timestamp_micros();
        let limit_time = now - duration_limit;

        let error_entries =
            match infra::table::workflows::delete_all_errors_older_than(limit_time).await {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error listing workflow errors older than {limit_time} for cleanup : {e}"
                    );
                    continue;
                }
            };
        log::info!(
            "cleaned {} old entries for workflow errors ",
            error_entries.len()
        );

        let run_entries =
            match infra::table::workflows::delete_all_runs_older_than(limit_time).await {
                Ok(v) => v,
                Err(e) => {
                    log::error!(
                        "error listing workflow runs older than {limit_time} for cleanup : {e}"
                    );
                    continue;
                }
            };
        log::info!(
            "cleaned {} old entries for workflow run data ",
            run_entries.len()
        );
    }
}

pub async fn send_workflow_trigger(trigger: WorkflowTrigger) -> Result<(), anyhow::Error> {
    // trigger watch event by putting value to cluster coordinator
    let cluster_coordinator = get_coordinator().await;
    cluster_coordinator
        .put(
            WORKFLOW_TRIGGER_PREFIX,
            serde_json::to_vec(&trigger)?.into(),
            true,
            None,
        )
        .await?;

    #[cfg(feature = "enterprise")]
    {
        let config = o2_enterprise::enterprise::common::config::get_config();
        if config.super_cluster.enabled {
            match o2_enterprise::enterprise::super_cluster::queue::send_workflow_trigger(
                serde_json::to_string(&trigger)?,
            )
            .await
            {
                Ok(_) => {
                    log::info!(
                        "successfully sent workflow trigger notification to super cluster queue for type: {:?} workflow_id: {} trace_id: {}",
                        trigger.trigger_type,
                        trigger.workflow_id,
                        trigger.trace_id
                    );
                }
                Err(e) => {
                    log::error!(
                        "error in sending workflow trigger notification to super cluster queue for type: {:?} workflow_id: {} trace_id: {} : {e}",
                        trigger.trigger_type,
                        trigger.workflow_id,
                        trigger.trace_id
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let prefix = WORKFLOWS_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching workflow keys");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_workflows: event channel closed");
                return Ok(());
            }
        };

        match ev {
            Event::Put(ev) => {
                let Some(item_v) = ev.value else {
                    log::error!("watch_workflows : missing value for put");
                    continue;
                };
                let Ok(entry) = serde_json::from_slice::<Workflow>(&item_v) else {
                    log::error!("watch_workflow : invalid json value for put");
                    continue;
                };

                let mut lock = CACHE.write().await;
                lock.remove(&entry.id);
                drop(lock);
            }
            Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(prefix).unwrap();
                let splits: Vec<_> = item_key.split("/").collect();
                if splits.len() != 1 {
                    log::error!("watch_workflows : invalid key {item_key} for delete");
                    continue;
                }
                let id = splits[0];
                let mut lock = CACHE.write().await;
                lock.remove(id);
                drop(lock);
            }
            Event::Empty => {}
        }
    }
}

pub async fn watch_workflow_triggers() -> Result<(), anyhow::Error> {
    let prefix = WORKFLOW_TRIGGER_PREFIX;
    let cluster_coordinator = db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(prefix).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching workflow triggers");

    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_workflow_triggers: event channel closed");
                return Ok(());
            }
        };

        if let Event::Put(ev) = ev {
            let Some(item_v) = ev.value else {
                log::error!("watch_workflow_triggers : missing value for put");
                continue;
            };
            let Ok(entry) = serde_json::from_slice::<WorkflowTrigger>(&item_v) else {
                log::error!("watch_workflow_triggers : invalid json value for put");
                continue;
            };
            handle_workflow_trigger(entry).await;
        }
    }
}
