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

use std::collections::HashMap;

use config::meta::{
    pipeline::components::NodeData,
    self_reporting::usage::{RunOutcome, TriggerData, TriggerDataType},
};
use db::{
    self,
    authz::{remove_ownership, set_ownership},
    workflows::{AssociationDeleteEvent, WorkflowTriggerType},
};
use infra::table::workflows::{
    self, Workflow, WorkflowAssociation, WorkflowError, WorkflowRunData, WorkflowRunErrors,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use usage_reporting::publish_triggers_usage;

use crate::{
    common::{meta::authz::Authz, utils::get_nats_lock},
    pipeline::batch_execution::{ExecutablePipeline, WorkflowResult, WorkflowRunOptions},
};

pub mod runtime;
#[derive(Serialize, Deserialize)]
pub struct InputMap {
    // even though a bad naming convention, node_map is
    error_node_map: HashMap<String, Vec<Value>>,
    #[serde(default)]
    input_map: HashMap<String, Vec<Value>>,
    #[serde(default)]
    output_map: HashMap<String, Vec<Value>>,
}

#[derive(Serialize, Deserialize)]
pub struct WorkflowTrigger {
    pub trace_id: String,
    pub source_id: String,
    pub trigger_type: WorkflowTriggerType,
    pub org_id: String,
    pub workflow_id: String,
    pub metadata: HashMap<String, Value>,
    pub run_id: String,
    pub origin_cluster: String,
}

/// The two run flags travel together; separate bool params would push `test_workflow` past
/// the argument limit and read as positional noise at the call site.
pub struct TestWorkflowOptions {
    pub is_draft: bool,
    pub suppress_destinations: bool,
}

enum WorkflowExecutionStatus {
    Success,
    Errored,
}

// this function does not return error, as we do not have retry.
// if something fails in this attempt which is a temporary failure
// when that sourcemap is fetched again, this will be retried
#[cfg(feature = "enterprise")]
async fn store_inputs_error_locally(mut errors: WorkflowRunErrors, data: String) {
    let info_str = format!("{}/{}/{}", errors.org_id, errors.workflow_id, errors.run_id);
    log::info!("storing workflow error inputs data for {info_str} in local cluster",);
    errors.cluster = config::get_cluster_name();
    errors.input_data = Some(data);
    if let Err(e) = db::workflows::update_error_input_file_cluster_data(errors).await {
        log::error!(
            "error updating db to set local cluster in workflow error inputs for {info_str} : {e}",
        );
    }
    log::info!("stored workflow errors inputs data for {info_str} in local cluster successfully");
}

// TODO YJDoc2: reuse in the get_inputs_file_data fn below
async fn get_trigger_run_data(
    source_cluster: &str,
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<String, anyhow::Error> {
    if source_cluster == config::get_cluster_name() {
        let data = infra::table::workflows::get_run_data(org_id, workflow_id, run_id).await.inspect_err(|e|{
            log::error!("error getting workflow run data in local cluster for {org_id}/{workflow_id}/{run_id} : {e}");
        })?;

        match data {
            Some(v) => return Ok(v),
            None => {
                log::error!(
                    "expected workflow run data in local cluster for {org_id}/{workflow_id}/{run_id} but not found"
                );
                return Err(anyhow::anyhow!("workflow run data not found"));
            }
        };
    }

    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        use o2_enterprise::enterprise::super_cluster::search::get_cluster_node_by_name;

        let trace_id = config::ider::generate_trace_id();
        let node = get_cluster_node_by_name(source_cluster).await?;

        let org = org_id.to_string();
        let wid = workflow_id.to_string();
        let rid = run_id.to_string();

        let cluster = source_cluster.to_string();

        log::info!("getting run data for {org_id}/{workflow_id}/{run_id} from cluster {cluster}");

        let task = tokio::task::spawn(async move {
            use infra::client::grpc::make_grpc_search_client;
            let info_str = format!("{org}/{wid}/{rid}");

            let mut request = tonic::Request::new(proto::cluster_rpc::GetWorkflowInputsRequest {
                org_id: org,
                workflow_id: wid,
                run_id: rid,
                is_error_data: false,
            });
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
            match client.get_workflow_inputs(request).await {
                Ok(res) => {
                    let response = res.into_inner();
                    Ok(response.data)
                }
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] error getting run data from cluster {cluster} for {info_str} from node {}: {err:?}",
                        node.get_grpc_addr(),
                    );
                    let err = infra::errors::ErrorCodes::from_json(err.message())?;
                    Err(anyhow::anyhow!(
                        "error getting data from other cluster {cluster} : {err}",
                    ))
                }
            }
        });
        let response = task
            .await
            .map_err(|e| anyhow::anyhow!("internal error : {e}"))?;
        match response {
            Ok(v) => {
                log::info!(
                    "successfully received run data for {org_id}/{workflow_id}/{run_id} from cluster {source_cluster}",
                );
                return Ok(v);
            }
            Err(e) => return Err(e),
        }
    }

    // if super cluster is not enabled AND cluster name is not same
    // then we cannot do anything, so this is the default fallback to error
    Err(anyhow::anyhow!(
        "unexpected cluster name {source_cluster} and super cluster not enabled"
    ))
}

pub async fn get_error_input_data(errors: &WorkflowRunErrors) -> Result<String, anyhow::Error> {
    if errors.cluster == config::get_cluster_name() {
        match &errors.input_data {
            None => {
                return Err(anyhow::anyhow!(
                    "error data supposed to be stored in same cluster, but missing in db"
                ));
            }
            Some(v) => return Ok(v.clone()),
        }
    }

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        use o2_enterprise::enterprise::super_cluster::search::get_cluster_node_by_name;

        let trace_id = config::ider::generate_trace_id();
        let node = get_cluster_node_by_name(&errors.cluster).await?;
        let org = errors.org_id.clone();
        let wid = errors.workflow_id.clone();
        let rid = errors.run_id.clone();

        let info_str = format!("{}/{}/{}", errors.org_id, errors.workflow_id, errors.run_id);
        let cluster = errors.cluster.to_string();

        log::info!("getting workflow errors inputs file for {info_str} from cluster {cluster}");

        let task = tokio::task::spawn(async move {
            use infra::client::grpc::make_grpc_search_client;

            let info_str = format!("{org}/{wid}/{rid}");
            let mut request = tonic::Request::new(proto::cluster_rpc::GetWorkflowInputsRequest {
                org_id: org,
                workflow_id: wid,
                run_id: rid,
                is_error_data: true,
            });
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
            match client.get_workflow_inputs(request).await {
                Ok(res) => {
                    let response = res.into_inner();
                    Ok(response.data)
                }
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] error getting workflow errors inputs data from cluster {cluster} node {} for {info_str} : {err:?}",
                        node.get_grpc_addr(),
                    );
                    let err = infra::errors::ErrorCodes::from_json(err.message())?;
                    Err(anyhow::anyhow!(
                        "error getting file from other cluster {cluster} : {err}",
                    ))
                }
            }
        });
        let response = task
            .await
            .map_err(|e| anyhow::anyhow!("internal error : {e}"))?;
        match response {
            Ok(v) => {
                log::info!(
                    "successfully received workflow error inputs data for {info_str} from cluster {}",
                    errors.cluster
                );
                let errors_copy = errors.clone();
                let data_copy = v.clone();
                tokio::spawn(async { store_inputs_error_locally(errors_copy, data_copy).await });
                return Ok(v);
            }
            Err(e) => return Err(e),
        }
    }

    // if super cluster is not enabled AND cluster name is not same
    // then we cannot do anything, so this is the default fallback to error
    Err(anyhow::anyhow!(
        "unexpected cluster name {} and super cluster not enabled",
        errors.cluster
    ))
}

async fn validate_workflow(workflow: &Workflow, is_draft: bool) -> Result<(), anyhow::Error> {
    for node in &workflow.nodes {
        if !node.position.is_valid() {
            return Err(anyhow::anyhow!("node {} position is not valid", node.id));
        }

        if !node.data.is_workflow_node() {
            return Err(anyhow::anyhow!(
                "node {} is not a workflow compatible node",
                node.id
            ));
        }

        // for draft we allow invalid destination or functions
        if !is_draft {
            if let NodeData::Destination(ref destination) = node.data {
                let (dest, _) = crate::alerts::destinations::get_with_template(
                    &workflow.org_id,
                    &destination.destination_id,
                )
                .await?;
                if !dest.is_pipeline_destination() {
                    return Err(anyhow::anyhow!(
                        "destination {} is not a workflow compatible destination",
                        destination.destination_id
                    ));
                }
            }

            if let NodeData::Function(function_params) = &node.data {
                // ideally FE should not send raw fn here, and additionally
                // we should not allow raw fns for published workflows, so we check and deny
                if function_params.raw_fn.is_some() || function_params.name.is_empty() {
                    return Err(anyhow::anyhow!(
                        "function node {} still has some unsaved function changes associated with it. Either save or discard those.",
                        node.id
                    ));
                }

                // Load the function to check its trans_type
                let function = super::db::functions::get(&workflow.org_id, &function_params.name)
                    .await
                    .map_err(|e| {
                        anyhow::anyhow!("Failed to load function '{}': {}", function_params.name, e)
                    })?;

                if function.is_vrl() {
                    return Err(anyhow::anyhow!(
                        "Vrl functions cannot be used in workflows. Function '{}' is a VRL function. Please use JS functions instead.",
                        function_params.name
                    ));
                }
            }
        }
    }

    config::meta::pipeline::validate_nodes_edges(&workflow.nodes, &workflow.edges, is_draft)?;
    Ok(())
}

pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow, false).await?;
    db::workflows::save_workflow_record(workflow.clone()).await?;
    set_ownership(&workflow.org_id, "workflows", Authz::new(&workflow.id)).await;
    db::workflows::notify_workflow_upsert(&workflow).await?;
    Ok(())
}

pub async fn save_draft(workflow: Workflow) -> Result<(), anyhow::Error> {
    db::workflows::save_draft_record(workflow.clone()).await?;
    set_ownership(&workflow.org_id, "workflows", Authz::new(&workflow.id)).await;
    db::workflows::notify_draft_upsert(&workflow).await?;
    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow, false).await?;
    db::workflows::update_workflow_record(workflow.clone()).await?;
    db::workflows::notify_workflow_upsert(&workflow).await?;
    Ok(())
}

pub async fn update_draft(workflow: Workflow) -> Result<(), anyhow::Error> {
    db::workflows::update_draft_record(workflow.clone()).await?;
    db::workflows::notify_draft_upsert(&workflow).await?;
    Ok(())
}

pub async fn promote_draft(org_id: &str, workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow, false).await?;
    let id = workflow.id.clone();
    db::workflows::promote_draft(org_id, workflow.clone()).await?;
    db::workflows::notify_workflow_upsert(&workflow).await?;
    db::workflows::notify_draft_delete(&id).await?;
    Ok(())
}

pub async fn enable_disable_workflow(
    org_id: &str,
    id: &str,
    enabled: bool,
) -> Result<(), anyhow::Error> {
    let workflow = infra::table::workflows::get_by_org_wid(org_id, id).await?;
    let Some(mut workflow) = workflow else {
        return Err(anyhow::anyhow!("workflow with id {id} not found"));
    };
    workflow.enabled = enabled;
    db::workflows::update_workflow_record(workflow.clone()).await?;
    db::workflows::notify_workflow_upsert(&workflow).await?;
    Ok(())
}

pub async fn list_workflows(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Workflow>, anyhow::Error> {
    let ret = workflows::list_by_org(org_id)
        .await?
        .into_iter()
        .filter(|pipeline| is_permitted(&pipeline.id, org_id, permitted.as_ref()))
        .collect();
    Ok(ret)
}

pub async fn list_drafts(
    org_id: &str,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Workflow>, anyhow::Error> {
    let ret = workflows::list_drafts_by_org(org_id)
        .await?
        .into_iter()
        .filter(|draft| is_permitted(&draft.id, org_id, permitted.as_ref()))
        .collect();
    Ok(ret)
}

pub async fn get_workflow_by_id(org_id: &str, id: &str) -> Result<Option<Workflow>, anyhow::Error> {
    let ret = db::workflows::get_workflow(org_id, id).await?;
    Ok(ret)
}

pub async fn get_draft_by_id(org_id: &str, id: &str) -> Result<Option<Workflow>, anyhow::Error> {
    let ret = db::workflows::get_draft(org_id, id).await?;
    Ok(ret)
}

pub async fn get_workflow_associations(
    org_id: &str,
    id: &str,
) -> Result<Vec<WorkflowAssociation>, anyhow::Error> {
    db::workflows::get_workflow_associations(org_id, id).await
}

fn is_permitted(workflow_id: &str, org_id: &str, permitted: Option<&Vec<String>>) -> bool {
    match permitted {
        Some(permitted) => {
            permitted.contains(&format!("workflow:{}", workflow_id))
                || permitted.contains(&format!("workflow:_all_{org_id}"))
        }
        None => true,
    }
}

pub async fn delete_workflow(org_id: &str, id: &str) -> Result<(), anyhow::Error> {
    let associations = AssociationDeleteEvent::Workflow {
        org_id: org_id.to_string(),
        workflow_id: id.to_string(),
    };
    db::workflows::delete_workflow_association(associations).await?;
    db::workflows::delete_workflow_record(id).await?;
    remove_ownership(org_id, "workflows", Authz::new(id)).await;
    db::workflows::notify_workflow_delete(id).await?;
    Ok(())
}

pub async fn delete_draft(org_id: &str, id: &str) -> Result<(), anyhow::Error> {
    db::workflows::delete_draft_record(id).await?;
    remove_ownership(org_id, "workflows", Authz::new(id)).await;
    db::workflows::notify_draft_delete(id).await?;
    Ok(())
}

fn run_outcome_for(error: Option<&str>) -> RunOutcome {
    if error.is_some() {
        RunOutcome::Error
    } else {
        RunOutcome::Succeeded
    }
}

/// process_workflow returns Ok with a populated `errors` map when individual nodes fail,
/// so a run that errored on every node is only visible through that map.
fn run_error_from_result(res: &Result<WorkflowResult, anyhow::Error>) -> Option<String> {
    match res {
        Err(e) => Some(e.to_string()),
        Ok(result) if !result.errors.is_empty() => {
            let mut node_ids: Vec<&str> = result.errors.keys().map(String::as_str).collect();
            node_ids.sort_unstable();
            Some(format!("errors in nodes: {}", node_ids.join(", ")))
        }
        Ok(_) => None,
    }
}

/// Records a synchronously-executed run in the history stream. Test and retry
/// runs never enter the trigger queue, so nothing else would publish them.
fn record_workflow_run(
    org_id: &str,
    workflow_id: &str,
    trigger_type: WorkflowTriggerType,
    source_id: &str,
    run_id: &str,
    start_time: i64,
    error: Option<String>,
) {
    let end_time = chrono::Utc::now().timestamp_micros();
    let status = run_outcome_for(error.as_deref());
    publish_triggers_usage(TriggerData {
        _timestamp: start_time,
        org: org_id.to_string(),
        module: TriggerDataType::Workflow,
        key: workflow_history_key(workflow_id, trigger_type, source_id, run_id),
        is_realtime: false,
        is_silenced: false,
        status,
        start_time,
        end_time,
        error,
        source_node: Some(config::cluster::LOCAL_NODE.name.clone()),
        evaluation_took_in_secs: Some((end_time - start_time) as f64 / 1_000_000.0),
        ..Default::default()
    });
}

/// Folds a finished run into the row we persist: node errors plus the per-node input/output
/// maps. A clean run yields an empty `data` and a fully populated map, which is what makes a
/// successful run inspectable after the fact.
fn run_errors_from_parts(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
    node_errors: &HashMap<String, config::meta::self_reporting::error::NodeErrors>,
    input_map: HashMap<String, Vec<Value>>,
    output_map: HashMap<String, Vec<Value>>,
) -> WorkflowRunErrors {
    let mut errored_input_map = HashMap::new();
    let mut workflow_errors = Vec::new();

    for (node_id, errors) in node_errors {
        let mut inputs = Vec::with_capacity(errors.error_count as usize);
        let mut err_list = Vec::with_capacity(errors.error_count as usize);

        for (e, val) in &errors.errors {
            let mut e = e.clone();
            // stored in db, so cap the string length here and the count below
            e.truncate(100);
            err_list.push(e);
            if let Some(mut v) = val.clone() {
                // a vrl fn over a result array errors with the whole array; store the
                // individual entries instead so a retry can replay them
                if let Some(arr) = v.as_array_mut() {
                    for v in arr.drain(0..) {
                        inputs.push(v);
                    }
                } else {
                    inputs.push(v);
                }
            }
        }
        // errors without inputs must still reach the user, so the error list and the
        // input map are populated independently
        if !err_list.is_empty() {
            err_list.truncate(50);
            workflow_errors.push(WorkflowError {
                node_id: node_id.clone(),
                error: err_list,
            });
        }
        if !inputs.is_empty() {
            errored_input_map.insert(node_id.clone(), inputs);
        }
    }

    let ip_map = InputMap {
        error_node_map: errored_input_map,
        input_map,
        output_map,
    };

    // the run errors row doubles as the execution-history map: same structure, so a
    // true error v/s a clean run is distinguished by `data` being empty or not
    WorkflowRunErrors {
        org_id: org_id.to_string(),
        cluster: config::get_cluster_name(),
        id: 0, // will be set directly in db
        workflow_id: workflow_id.to_string(),
        run_id: run_id.to_string(),
        ran_at: chrono::Utc::now().timestamp_micros(),
        data: workflow_errors,
        input_data: Some(serde_json::to_string(&ip_map).unwrap_or_default()),
    }
}

/// The workflow has already run, so a failure to store its history is logged, not returned.
async fn persist_run_errors(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
    errors: WorkflowRunErrors,
) {
    if let Err(e) = db::workflows::save_workflow_errors(errors).await {
        log::error!(
            "[Workflows] : error saving workflow run errors for run id {run_id} for workflow {org_id}/{workflow_id} in db : {e}"
        );
    }
}

/// `workflow_id` is the REAL saved id, not the synthetic `test-<uuid>` the executable runs
/// under: the history API matches on `key LIKE '{workflow_id}/%'`, so a synthetic id there
/// would make every Test row unreadable.
pub async fn test_workflow(
    org_id: &str,
    workflow_id: &str,
    workflow: Workflow,
    inputs: Vec<serde_json::Value>,
    from_node: Option<String>,
    options: TestWorkflowOptions,
    user_id: &str,
) -> Result<WorkflowResult, anyhow::Error> {
    let TestWorkflowOptions {
        is_draft,
        suppress_destinations,
    } = options;
    validate_workflow(&workflow, is_draft).await?;
    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;
    let run_id = config::ider::uuid();
    let start_time = chrono::Utc::now().timestamp_micros();
    let res = executable
        .process_workflow_with_options(
            org_id,
            inputs,
            from_node,
            WorkflowRunOptions {
                suppress_destinations,
            },
        )
        .await;
    record_workflow_run(
        org_id,
        workflow_id,
        WorkflowTriggerType::Test,
        user_id,
        &run_id,
        start_time,
        run_error_from_result(&res),
    );
    // a test run is listed in history like any other, so its per-node data has to be
    // stored too or re-opening it later shows every node as never having run
    if let Ok(result) = &res {
        let errors = run_errors_from_parts(
            org_id,
            workflow_id,
            &run_id,
            &result.errors,
            result.inputs.clone(),
            result.outputs.clone(),
        );
        persist_run_errors(org_id, workflow_id, &run_id, errors).await;
    }
    res
}

pub async fn trigger_workflow(
    org_id: &str,
    id: &str,
    inputs: Vec<serde_json::Value>,
    user_id: &str,
) -> Result<String, anyhow::Error> {
    if db::workflows::get_workflow(org_id, id).await?.is_none() {
        return Err(anyhow::anyhow!("workflow with id {id} not found"));
    }

    let metadata = [("event_type", "manual"), ("user_id", user_id)]
        .into_iter()
        .map(|(k, v)| (k.into(), v.into()))
        .collect();

    let trace_id = format!("webhook-{}", config::ider::generate_trace_id());
    log::info!(
        "received webhook trigger for workflow {org_id}/{id} from user {user_id}, assigning trace id {trace_id}"
    );

    if let Err(e) = send_workflow_trigger(
        &trace_id,
        org_id,
        user_id.to_string(),
        WorkflowTriggerType::Manual,
        id,
        metadata,
        &inputs,
    )
    .await
    {
        log::error!(
            "error in sending webhook trigger for workflow {org_id}/{id} from user {user_id}, trace id {trace_id} error : {e}"
        );
        return Err(e);
    }
    log::info!(
        "successfully triggered workflow {org_id}/{id} from user {user_id}, with trace id {trace_id}"
    );
    Ok(trace_id)
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

    let res = executable.process_workflow(org_id, inputs, None).await?;

    let WorkflowResult {
        errors: node_errors,
        inputs: input_map,
        outputs: output_map,
        ..
    } = res;
    let errors = run_errors_from_parts(org_id, id, run_id, &node_errors, input_map, output_map);
    // if this is not empty, then some node errored
    let errored = !errors.data.is_empty();
    persist_run_errors(org_id, id, run_id, errors).await;

    if errored {
        Ok(WorkflowExecutionStatus::Errored)
    } else {
        Ok(WorkflowExecutionStatus::Success)
    }
}

pub async fn get_workflow_errors(
    org_id: &str,
    wid: &str,
    run_id: &str,
) -> Result<Option<WorkflowRunErrors>, anyhow::Error> {
    let res = workflows::get_errors_for_run(org_id, wid, run_id).await?;
    Ok(res)
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

    let mut start_id = None;
    for node in &workflow.nodes {
        if matches!(node.data, NodeData::WorkflowTrigger) {
            start_id = Some(node.id.clone());
            break;
        }
    }
    let Some(start_id) = start_id else {
        log::error!(
            "missing workflow trigger node in workflow {org_id}/{wid} for retry run {run_id}"
        );
        return Err(anyhow::anyhow!("workflow trigger node missing in workflow"));
    };

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

    let node_id = from_node.as_ref().unwrap_or(&start_id);

    let inputs = ip_map.input_map.remove(node_id).ok_or(anyhow::anyhow!(
        "node id {node_id} does not have any associated input data in the stored inputs"
    ))?;

    let start_time = chrono::Utc::now().timestamp_micros();
    let res = executable.process_workflow(org_id, inputs, from_node).await;
    // the retry is its own run; the failed run's id stays as source_id for provenance
    let retry_run_id = config::ider::uuid();
    record_workflow_run(
        org_id,
        wid,
        WorkflowTriggerType::Retry,
        run_id,
        &retry_run_id,
        start_time,
        run_error_from_result(&res),
    );
    res
}

pub async fn send_workflow_trigger(
    trace_id: &str,
    org_id: &str,
    source_id: String,
    trigger_type: WorkflowTriggerType,
    workflow_id: &str,
    metadata: HashMap<String, Value>,
    data: &[Value],
) -> Result<(), anyhow::Error> {
    let o2_cfg = get_o2_config();
    if !o2_cfg.common.workflows_enabled {
        return Ok(());
    }

    let data = serde_json::to_string(data)?;
    let run_id = config::ider::uuid();

    let entry = WorkflowRunData {
        id: 0,
        org_id: org_id.to_string(),
        workflow_id: workflow_id.to_string(),
        run_id: run_id.clone(),
        triggered_at: chrono::Utc::now().timestamp_micros(),
        data,
    };

    infra::table::workflows::save_workflow_run_data(entry).await.inspect_err(|e|{
        log::error!("error saving workflow run data for {org_id}/{workflow_id} trace_id {trace_id} run id {run_id} : {e}");
    })?;

    log::info!("sending workflow trigger for trace id {trace_id} with run id {run_id}");
    let trigger = WorkflowTrigger {
        trace_id: trace_id.to_string(),
        source_id,
        trigger_type,
        org_id: org_id.to_string(),
        workflow_id: workflow_id.to_string(),
        metadata,
        run_id: run_id.clone(),
        origin_cluster: config::get_cluster_name(),
    };
    runtime::send_workflow_trigger(trigger).await?;
    log::info!("successfully sent workflow trigger for trace id {trace_id} run id {run_id}");

    Ok(())
}

/// The 4-part positional run-history key. Display, not Debug: a Debug-formatted
/// variant would put braces and spaces into a key the history API parses.
pub fn workflow_history_key(
    workflow_id: &str,
    trigger_type: WorkflowTriggerType,
    source_id: &str,
    run_id: &str,
) -> String {
    format!("{workflow_id}/{trigger_type}/{source_id}/{run_id}")
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
        key: workflow_history_key(
            &trigger.workflow_id,
            trigger.trigger_type,
            &trigger.source_id,
            &run_id,
        ),
        is_realtime: false,
        is_silenced: false,
        status: RunOutcome::Succeeded,
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

pub async fn get_data_for_run(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<Option<String>, anyhow::Error> {
    let ret = infra::table::workflows::get_run_data(org_id, workflow_id, run_id).await?;
    Ok(ret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_key_for_a_manual_run_records_manual_and_the_firing_user() {
        let key = workflow_history_key(
            "wf123",
            WorkflowTriggerType::Manual,
            "user@example.com",
            "run789",
        );
        assert_eq!(key, "wf123/Manual/user@example.com/run789");
        assert!(
            !key.contains("/Webhook/"),
            "a manual run must not be recorded as a webhook"
        );
    }

    #[test]
    fn history_key_source_id_is_the_user_not_the_literal_trigger_name() {
        let key = workflow_history_key(
            "wf123",
            WorkflowTriggerType::Manual,
            "user@example.com",
            "run789",
        );
        let source_id = key.split('/').nth(2).unwrap();
        assert_ne!(source_id, "Webhook");
        assert_eq!(source_id, "user@example.com");
    }

    #[test]
    fn history_key_for_test_and_retry_runs_use_their_own_trigger_types() {
        assert_eq!(
            workflow_history_key("wf1", WorkflowTriggerType::Test, "u1", "r1"),
            "wf1/Test/u1/r1"
        );
        assert_eq!(
            workflow_history_key("wf1", WorkflowTriggerType::Retry, "u1", "r1"),
            "wf1/Retry/u1/r1"
        );
    }

    #[test]
    fn history_key_is_positional_with_the_trigger_type_second() {
        let key = workflow_history_key("wf1", WorkflowTriggerType::AlertFired, "src", "run");
        let parts: Vec<_> = key.split('/').collect();
        assert_eq!(parts[0], "wf1");
        assert_eq!(parts[1], "AlertFired");
        assert_eq!(parts[3], "run");
    }
    #[tokio::test]
    async fn an_unsupported_node_is_rejected_before_it_can_be_saved() {
        // Unsupported is what a node type from a NEWER build decodes to. Re-serializing it
        // rewrites that node as {"node_type":"unsupported"}, so saving one destroys data.
        // The allowlist check runs before any DB lookup, so this needs no fixtures.
        let workflow = Workflow {
            id: "w1".to_string(),
            org_id: "org1".to_string(),
            name: "w".to_string(),
            description: String::new(),
            enabled: true,
            created_at: 0,
            updated_at: 0,
            created_by: String::new(),
            nodes: vec![config::meta::pipeline::components::Node::new(
                "u1".to_string(),
                NodeData::Unsupported,
                0.0,
                0.0,
                "default".to_string(),
            )],
            edges: vec![],
        };

        assert!(validate_workflow(&workflow, false).await.is_err());
        assert!(validate_workflow(&workflow, true).await.is_err());
    }

    fn node_errors_with(msg: &str) -> config::meta::self_reporting::error::NodeErrors {
        let mut ne = config::meta::self_reporting::error::NodeErrors::new(
            "n1".to_string(),
            "FunctionNode".to_string(),
            None,
        );
        ne.errors.insert((msg.to_string(), None));
        ne.error_count = 1;
        ne
    }

    #[test]
    fn a_run_whose_nodes_all_errored_is_not_recorded_as_succeeded() {
        let mut result = WorkflowResult::default();
        result
            .errors
            .insert("n1".to_string(), node_errors_with("boom"));

        let error = run_error_from_result(&Ok(result));
        assert!(
            error.is_some(),
            "node-level errors must surface as a run error"
        );
        assert_eq!(run_outcome_for(error.as_deref()), RunOutcome::Error);
    }

    #[test]
    fn a_failed_run_is_recorded_as_error_not_succeeded() {
        let res: Result<WorkflowResult, anyhow::Error> = Err(anyhow::anyhow!("exploded"));
        let error = run_error_from_result(&res);
        assert_eq!(error.as_deref(), Some("exploded"));
        assert_eq!(run_outcome_for(error.as_deref()), RunOutcome::Error);
    }

    #[test]
    fn a_clean_run_is_still_recorded_as_succeeded() {
        let res: Result<WorkflowResult, anyhow::Error> = Ok(WorkflowResult::default());
        let error = run_error_from_result(&res);
        assert!(error.is_none());
        assert_eq!(run_outcome_for(error.as_deref()), RunOutcome::Succeeded);
    }

    #[test]
    fn a_retry_run_gets_its_own_run_id_and_keeps_the_original_as_source() {
        let original_run_id = "original-run-1";
        let retry_run_id = config::ider::uuid();
        assert_ne!(
            retry_run_id, original_run_id,
            "a retry must not reuse the failed run's id as its own run_id"
        );

        let key = workflow_history_key(
            "wf1",
            WorkflowTriggerType::Retry,
            original_run_id,
            &retry_run_id,
        );
        let parts: Vec<_> = key.split('/').collect();
        assert_eq!(parts[2], original_run_id, "source_id keeps the provenance");
        assert_ne!(parts[3], parts[2], "run_id must be a fresh id");
    }

    #[test]
    fn a_test_run_is_recorded_under_the_real_workflow_id() {
        // the history API queries `key LIKE '{workflow_id}/%'`, so a synthetic
        // `test-<uuid>` id in slot 0 would make every Test row unreadable
        let key = workflow_history_key(
            "wf-real-id",
            WorkflowTriggerType::Test,
            "user@example.com",
            "run1",
        );
        assert!(key.starts_with("wf-real-id/"));
        assert!(!key.starts_with("test-"));
        assert_eq!(key.split('/').nth(2).unwrap(), "user@example.com");
    }

    #[test]
    fn a_clean_run_still_stores_every_nodes_input_and_output() {
        // a successful run has no node errors, so the only thing that can make its
        // steps inspectable later is the input/output map being persisted anyway
        let mut result = WorkflowResult::default();
        result
            .inputs
            .insert("n1".to_string(), vec![serde_json::json!({"in": 1})]);
        result
            .outputs
            .insert("n1".to_string(), vec![serde_json::json!({"out": 2})]);

        let errors = run_errors_from_parts(
            "org1",
            "wf1",
            "run1",
            &result.errors,
            result.inputs.clone(),
            result.outputs.clone(),
        );

        assert!(
            errors.data.is_empty(),
            "a clean run must not fabricate node errors"
        );
        let ip_map: InputMap = serde_json::from_str(
            errors
                .input_data
                .as_deref()
                .expect("input_data must be stored"),
        )
        .expect("stored input_data must be a valid InputMap");
        assert_eq!(
            ip_map.input_map.get("n1").map(Vec::len),
            Some(1),
            "every node's input must be stored so the run can be inspected later"
        );
        assert_eq!(
            ip_map.output_map.get("n1").map(Vec::len),
            Some(1),
            "every node's output must be stored so the run can be inspected later"
        );
    }

    #[test]
    fn an_errored_node_still_records_its_error_and_replay_input() {
        let mut result = WorkflowResult::default();
        result
            .errors
            .insert("n1".to_string(), node_errors_with("boom"));

        let errors = run_errors_from_parts(
            "org1",
            "wf1",
            "run1",
            &result.errors,
            result.inputs.clone(),
            result.outputs.clone(),
        );

        assert_eq!(errors.data.len(), 1, "the node error must be persisted");
        assert_eq!(errors.data[0].node_id, "n1");
        assert_eq!(errors.data[0].error, vec!["boom".to_string()]);
    }
}
