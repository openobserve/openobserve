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

//! Running a workflow, as opposed to defining one.
//!
//! Execution needs `ExecutablePipeline`, which sits above the alerting code -- but alerts also
//! fire workflows as a notification target, so [`crate::workflows`] has to stay below them. That
//! module therefore keeps the definitions, CRUD and the trigger-enqueue path, and everything that
//! actually runs a workflow lives here.

use std::{collections::HashMap, sync::Arc};

use config::meta::self_reporting::usage::{TriggerData, TriggerDataStatus, TriggerDataType};
use infra::{
    coordinator::get_coordinator,
    db::Event,
    table::workflows::{self, WorkflowError, WorkflowRunErrors},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde_json::Value;
use usage_reporting::publish_triggers_usage;

use crate::{
    common::utils::get_nats_lock,
    db,
    pipeline::batch_execution::{ExecutablePipeline, WorkflowResult},
    workflows::{
        InputMap, WorkflowTrigger, get_error_input_data, get_trigger_run_data, get_workflow_by_id,
        runtime::WORKFLOW_TRIGGER_PREFIX,
    },
};

enum WorkflowExecutionStatus {
    Success,
    Errored,
}

pub async fn test_workflow(
    org_id: &str,
    id: &str,
    inputs: Vec<serde_json::Value>,
    from_node: Option<String>,
) -> Result<WorkflowResult, anyhow::Error> {
    let workflow = get_workflow_by_id(org_id, id)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;
    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;

    let res = executable
        .process_workflow(org_id, inputs, from_node)
        .await?;
    Ok(res)
}

async fn execute_workflow(
    org_id: &str,
    id: &str,
    run_id: &str,
    inputs: Vec<serde_json::Value>,
) -> Result<WorkflowExecutionStatus, anyhow::Error> {
    let workflow = get_workflow_by_id(org_id, id)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;

    if !workflow.enabled {
        return Ok(WorkflowExecutionStatus::Success);
    }

    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;

    let now = chrono::Utc::now().timestamp_micros();
    let input_copy = inputs.clone();
    let res = executable.process_workflow(org_id, inputs, None).await?;

    let mut errored_input_map = HashMap::new();
    let mut workflow_errors = Vec::new();

    for (node_id, errors) in res.errors {
        let mut inputs = Vec::with_capacity(errors.error_count as usize);
        let mut err_list = Vec::with_capacity(errors.error_count as usize);

        for (mut e, val) in errors.errors {
            // because we are storing the errors in db, we don't want to have
            // a long string * a lot of errors
            // so we truncate the length here, and then limit the count below
            e.truncate(100);
            err_list.push(e);
            if let Some(mut v) = val {
                // top level value should always be a single json value,
                // except when the erroring node was a vrl fn over a result array
                // in that case we actually want to store the individual entries
                // instead of the whole array, so we can replay it correctly
                if let Some(arr) = v.as_array_mut() {
                    for v in arr.drain(0..) {
                        inputs.push(v);
                    }
                } else {
                    inputs.push(v);
                }
            }
        }
        // it is possible that we have errors, but no corresponding inputs
        // we should always show the errors to user, so we store it in db
        // but only create entry in input map if inputs are present
        if !err_list.is_empty() {
            err_list.truncate(50);
            workflow_errors.push(WorkflowError {
                node_id: node_id.clone(),
                error: err_list,
            });
        }
        if !inputs.is_empty() {
            errored_input_map.insert(node_id, inputs);
        }
    }

    if !workflow_errors.is_empty() {
        let ip_map = InputMap {
            complete: input_copy,
            node_map: errored_input_map,
        };

        let errors = WorkflowRunErrors {
            org_id: org_id.to_string(),
            cluster: config::get_cluster_name(),
            id: 0, // will be set directly in db
            workflow_id: id.to_string(),
            run_id: run_id.to_string(),
            ran_at: now,
            data: workflow_errors,
            input_data: Some(serde_json::to_string(&ip_map).unwrap()),
        };
        // workflow has already run, so not much point in returning error because
        // we couldn't save the errors to db, log and ignore
        if let Err(e) = db::workflows::save_workflow_errors(errors).await {
            log::error!(
                "[Workflows] : error saving workflow run errors for run id {run_id} for workflow {org_id}/{id} in db : {e}"
            );
        }
        return Ok(WorkflowExecutionStatus::Errored);
    }

    Ok(WorkflowExecutionStatus::Success)
}

pub async fn retry_run(
    org_id: &str,
    wid: &str,
    run_id: &str,
    from_node: Option<String>,
) -> Result<WorkflowResult, anyhow::Error> {
    let workflow = workflows::get_by_org_wid(org_id, wid)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;
    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;

    let errors = match workflows::list_errors_for_workflow_run(org_id, wid, run_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return Err(anyhow::anyhow!("Errored run info not found"));
        }
        Err(e) => {
            log::error!(
                "error getting workflow run error info from db for {org_id}/{wid} run_id {run_id} : {e}"
            );
            return Err(anyhow::anyhow!("error getting workflow run info : {e}"));
        }
    };

    let data_str = match get_error_input_data(&errors).await {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "error getting workflow run error input file for {org_id}/{wid} run_id {run_id} : {e}"
            );
            return Err(anyhow::anyhow!("error getting workflow run info : {e}"));
        }
    };

    let mut ip_map: InputMap = serde_json::from_str(&data_str).map_err(|e| {
        log::error!(
            "error deserializing input data for workflow {org_id}/{wid} run id {run_id} : {e}"
        );
        anyhow::anyhow!("error deserializing inputs : {e}")
    })?;

    let inputs = match from_node.as_ref() {
        Some(node) => ip_map.node_map.remove(node).ok_or(anyhow::anyhow!(
            "node id {node} does not have any associated input data in the stored inputs"
        ))?,
        None => ip_map.complete,
    };

    let res = executable
        .process_workflow(org_id, inputs, from_node)
        .await?;
    Ok(res)
}

pub async fn handle_workflow_trigger(trigger: WorkflowTrigger) {
    let o2_cfg = get_o2_config();
    if !o2_cfg.common.workflows_enabled {
        return;
    }
    match get_nats_lock(format!(
        "/workflow-trigger-{:?}-handler",
        trigger.trigger_type
    ))
    .await
    {
        Err(e) => {
            log::error!(
                "error getting lock for workflow handling for event {:?} with trace id {} source id {} for workflow id {}, skipping : {e}",
                trigger.trigger_type,
                trigger.trace_id,
                trigger.source_id,
                trigger.workflow_id,
            );
            return;
        }
        Ok(node) => {
            if node != config::cluster::LOCAL_NODE.uuid {
                log::debug!(
                    "lock for workflow handling for event {:?} is obtained by node {node} for trace id {} source id {} for workflow id {}, skipping",
                    trigger.trigger_type,
                    trigger.trace_id,
                    trigger.source_id,
                    trigger.workflow_id,
                );
                return;
            }
        }
    }

    let run_id = trigger.run_id.clone();
    log::info!(
        "received workflow trigger for event {:?} with trace id {} source id {} for workflow id {}, assigning run id {}",
        trigger.trigger_type,
        trigger.trace_id,
        trigger.source_id,
        trigger.workflow_id,
        run_id
    );

    let trace_id = trigger.trace_id;

    let file_data = match get_trigger_run_data(
        &trigger.origin_cluster,
        &trigger.org_id,
        &trigger.workflow_id,
        &trigger.run_id,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[workflow_trigger {trace_id}] run id {run_id} error getting data file : {e}, skipping"
            );
            return;
        }
    };

    let data: Vec<Value> = match serde_json::from_str(&file_data) {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[workflow_trigger {trace_id}] run id {run_id} error deserializing run data for {}/{}/{} : {e}, skipping",
                trigger.org_id,
                trigger.workflow_id,
                trigger.run_id
            );
            return;
        }
    };

    let final_data = serde_json::json!({
        "meta":trigger.metadata,
        "data": data
    });

    let start_time = chrono::Utc::now().timestamp_micros();
    let workflow_run_result = execute_workflow(
        &trigger.org_id,
        &trigger.workflow_id,
        &run_id,
        vec![final_data],
    )
    .await;
    let end_time = chrono::Utc::now().timestamp_micros();

    let error = match workflow_run_result {
        Ok(WorkflowExecutionStatus::Errored) => {
            Some("some node errored during execution".to_string())
        }
        Err(e) => Some(e.to_string()),
        _ => None,
    };

    let trigger_data_stream: TriggerData = TriggerData {
        _timestamp: start_time,
        org: trigger.org_id.clone(),
        module: TriggerDataType::Workflow,
        // this order matters in the workflow history api, as we parse this there
        key: format!(
            "{}/{:?}/{}/{}",
            trigger.workflow_id, trigger.trigger_type, trigger.source_id, run_id
        ),
        is_realtime: false,
        is_silenced: false,
        status: TriggerDataStatus::Completed,
        start_time,
        end_time,
        error,
        source_node: Some(config::cluster::LOCAL_NODE.name.clone()),
        evaluation_took_in_secs: Some((end_time - start_time) as f64 / 1_000_000.0),
        scheduler_trace_id: Some(trace_id.clone()),
        ..Default::default()
    };
    publish_triggers_usage(trigger_data_stream);

    if let Err(e) = infra::table::workflows::delete_run_data(
        &trigger.org_id,
        &trigger.workflow_id,
        &trigger.run_id,
    )
    .await
    {
        log::error!(
            "error deleting run data from db for {}/{}/{} : {e}",
            trigger.org_id,
            trigger.workflow_id,
            trigger.run_id
        );
    }

    log::info!("[workflow_trigger {trace_id}] run id {run_id} completed execution");
}

pub async fn watch_workflow_triggers() -> Result<(), anyhow::Error> {
    let mut events = get_coordinator()
        .await
        .watch(WORKFLOW_TRIGGER_PREFIX)
        .await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching workflow triggers");

    loop {
        let Some(event) = events.recv().await else {
            log::error!("watch_workflow_triggers: event channel closed");
            return Ok(());
        };

        if let Event::Put(event) = event {
            let Some(value) = event.value else {
                log::error!("watch_workflow_triggers: missing value for put");
                continue;
            };
            let Ok(trigger) = serde_json::from_slice::<WorkflowTrigger>(&value) else {
                log::error!("watch_workflow_triggers: invalid json value for put");
                continue;
            };
            handle_workflow_trigger(trigger).await;
        }
    }
}
