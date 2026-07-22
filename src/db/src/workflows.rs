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
    table::workflows::{Workflow, WorkflowRunErrors},
};
use tokio::sync::RwLock;

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
    if config.super_cluster.enabled
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::add_workflow(workflow.clone()).await
    {
        log::error!(
            "error in sending workflow notification to super cluster queue for {}/{} : {e}",
            workflow.org_id,
            workflow.id
        );
    }
    Ok(())
}

pub async fn notify_workflow_delete(id: &str) -> Result<(), anyhow::Error> {
    get_coordinator()
        .await
        .delete(&format!("{WORKFLOWS_PREFIX}{id}"), false, true, None)
        .await?;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled
        && let Err(e) = o2_enterprise::enterprise::super_cluster::queue::delete_workflow(id).await
    {
        log::error!(
            "error in sending workflow delete notification to super cluster queue for {id} : {e}"
        );
    }
    Ok(())
}

pub async fn save_workflow_errors(mut errors: WorkflowRunErrors) -> Result<(), anyhow::Error> {
    infra::table::workflows::save_workflow_errors(errors.clone()).await?;
    errors.input_data = None;

    let config = o2_enterprise::enterprise::common::config::get_config();
    if config.super_cluster.enabled
        && let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::add_workflow_errors(errors).await
    {
        log::error!("error in sending workflow errors notification to super cluster queue: {e}");
    }
    Ok(())
}

pub async fn update_error_input_file_cluster_data(
    errors: WorkflowRunErrors,
) -> Result<(), anyhow::Error> {
    infra::table::workflows::update_error_input_file_cluster_data(errors).await?;
    Ok(())
}

pub async fn delete_runs_and_errors_older_than(
    limit_time: i64,
) -> Result<(usize, usize), anyhow::Error> {
    let error_entries = infra::table::workflows::delete_all_errors_older_than(limit_time).await?;
    let run_entries = infra::table::workflows::delete_all_runs_older_than(limit_time).await?;
    Ok((error_entries.len(), run_entries.len()))
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
