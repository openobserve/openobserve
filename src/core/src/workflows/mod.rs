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

use config::meta::pipeline::components::NodeData;
use db::{
    self,
    authz::{remove_ownership, set_ownership},
};
use infra::table::workflows::{self, Workflow, WorkflowRunData, WorkflowRunErrors};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::common::{infra::config::ALERTS, meta::authz::Authz};

pub mod runtime;

#[derive(Serialize, Deserialize, Debug, Default)]
pub enum WorkflowTriggerType {
    #[default]
    AlertFired,
}

impl From<&str> for WorkflowTriggerType {
    fn from(value: &str) -> Self {
        match value {
            "AlertFired" => Self::AlertFired,
            _ => Self::AlertFired,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct InputMap {
    pub(crate) complete: Vec<Value>,
    pub(crate) node_map: HashMap<String, Vec<Value>>,
}

#[derive(Serialize, Deserialize)]
pub struct WorkflowTrigger {
    pub trace_id: String,
    pub source_id: String,
    pub trigger_type: WorkflowTriggerType,
    pub org_id: String,
    pub workflow_id: String,
    pub metadata: HashMap<String, String>,
    pub run_id: String,
    pub origin_cluster: String,
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
pub(crate) async fn get_trigger_run_data(
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

async fn validate_workflow(workflow: &Workflow) -> Result<(), anyhow::Error> {
    for node in &workflow.nodes {
        if !node.data.is_workflow_node() {
            return Err(anyhow::anyhow!(
                "node {} is not a workflow compatible node",
                node.id
            ));
        }
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

    config::meta::pipeline::validate_nodes_edges(&workflow.nodes, &workflow.edges)?;
    Ok(())
}

pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow).await?;
    db::workflows::save_workflow_record(workflow.clone()).await?;
    set_ownership(&workflow.org_id, "workflows", Authz::new(&workflow.id)).await;
    db::workflows::notify_workflow_upsert(&workflow).await?;
    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow).await?;
    db::workflows::update_workflow_record(workflow.clone()).await?;
    db::workflows::notify_workflow_upsert(&workflow).await?;
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

pub async fn get_workflow_by_id(org_id: &str, id: &str) -> Result<Option<Workflow>, anyhow::Error> {
    let ret = db::workflows::get_workflow(org_id, id).await?;
    Ok(ret)
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
    // TODO YJDoc2: later sometime, figure out a better scheme dot this check,
    // as we support more and more places to add workflow, this might become infeasible
    // to check for all cases
    let cacher = ALERTS.read().await;
    for (stream_key, (_, alert)) in cacher.iter() {
        if stream_key.starts_with(&format!("{org_id}/"))
            && alert.workflows.contains(&id.to_string())
        {
            return Err(anyhow::anyhow!("workflow is used by alert {}", alert.name));
        }
    }

    db::workflows::delete_workflow_record(id).await?;
    remove_ownership(org_id, "workflows", Authz::new(id)).await;
    db::workflows::notify_workflow_delete(id).await?;
    Ok(())
}

pub async fn get_workflow_errors(
    org_id: &str,
    wid: &str,
    run_id: &str,
) -> Result<Option<WorkflowRunErrors>, anyhow::Error> {
    let res = workflows::get_errors_for_run(org_id, wid, run_id).await?;
    Ok(res)
}

pub async fn send_workflow_trigger(
    trace_id: &str,
    org_id: &str,
    source_id: String,
    trigger_type: WorkflowTriggerType,
    workflow_id: &str,
    metadata: HashMap<String, String>,
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

pub async fn get_data_for_run(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<Option<String>, anyhow::Error> {
    let ret = infra::table::workflows::get_run_data(org_id, workflow_id, run_id).await?;
    Ok(ret)
}
