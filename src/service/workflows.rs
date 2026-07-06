use std::collections::HashMap;

use infra::table::workflows::{self, Workflow, WorkflowError, WorkflowRunErrors};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::service::{
    db,
    pipeline::batch_execution::{ExecutablePipeline, WorkflowResult},
};

#[derive(Serialize, Deserialize)]
pub struct InputMap {
    complete: Vec<Value>,
    node_map: HashMap<String, Vec<Value>>,
}

pub fn get_inputs_file_path(org_id: &str, workflow_id: &str, run_id: &str) -> String {
    format!("files/{org_id}/workflow_inputs/{workflow_id}-{run_id}.json")
}

// this function does not return error, as we do not have retry.
// if something fails in this attempt which is a temporary failure
// when that sourcemap is fetched again, this will be retried
#[cfg(feature = "enterprise")]
async fn store_file_locally(mut errors: WorkflowRunErrors, file_data: bytes::Bytes) {
    let path = get_inputs_file_path(&errors.org_id, &errors.workflow_id, &errors.run_id);
    log::info!(
        "storing workflow inputs file for org_id {} path {path} in local cluster",
        errors.org_id,
    );
    if let Err(e) = infra::storage::put("", &path, file_data).await {
        log::error!(
            "error storing workflow inputs file for org_id {} at path {path} in local cluster : {e}",
            errors.org_id,
        );
        return;
    }
    let org = errors.org_id.clone();
    errors.cluster = config::get_cluster_name();
    if let Err(e) = db::workflows::update_error_input_file_cluster(errors).await {
        log::error!(
            "error updating db to set local cluster in workflow inputs for file {org} path {path} : {e}"
        );
    }
    log::info!(
        "stored workflow inputs file for org_id {org} path {path} in local cluster successfully"
    );
}

async fn get_inputs_file_data(errors: &WorkflowRunErrors) -> Result<bytes::Bytes, anyhow::Error> {
    let path = get_inputs_file_path(&errors.org_id, &errors.workflow_id, &errors.run_id);
    if errors.cluster == config::get_cluster_name() {
        let get_res = infra::storage::get("", &path).await?;
        let bytes = get_res.bytes().await?;
        return Ok(bytes);
    }

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        use o2_enterprise::enterprise::super_cluster::search::get_cluster_node_by_name;

        let trace_id = config::ider::generate_trace_id();
        let node = get_cluster_node_by_name(&errors.cluster).await?;
        let file_path = path.clone();
        let org = errors.org_id.clone();

        let cluster = errors.cluster.to_string();

        log::info!(
            "getting workflow inputs file for org_id {org} path {path} from cluster {cluster}"
        );

        let task = tokio::task::spawn(async move {
            use infra::client::grpc::make_grpc_search_client;

            let mut request = tonic::Request::new(proto::cluster_rpc::GetFileRequest {
                path: file_path.clone(),
            });
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
            match client.get_file(request).await {
                Ok(res) => {
                    let response = res.into_inner();
                    Ok(response.file_data)
                }
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] error getting workflow inputs file from cluster {cluster} node {} for org_id {org} path {file_path} : {err:?}",
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
                    "successfully received workflow inputs file file org_id {} path {path} from cluster {}",
                    errors.org_id,
                    errors.cluster
                );
                let bytes = bytes::Bytes::from(v);
                let errors_copy = errors.clone();
                let bytes_copy = bytes.clone();
                tokio::spawn(async { store_file_locally(errors_copy, bytes_copy).await });
                return Ok(bytes);
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

fn validate_workflow(workflow: &Workflow) -> Result<(), anyhow::Error> {
    for node in &workflow.nodes {
        if !node.data.is_workflow_node() {
            return Err(anyhow::anyhow!(
                "node {} is not a workflow compatible node",
                node.id
            ));
        }
    }
    config::meta::pipeline::validate_nodes_edges(&workflow.nodes, &workflow.edges)?;
    Ok(())
}

pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow)?;
    db::workflows::save_workflow(workflow).await?;
    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow)?;
    db::workflows::update_workflow(workflow).await?;
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
    let res = workflows::get_by_org_wid(org_id, id).await?;
    Ok(res)
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
    db::workflows::delete_workflow(org_id, id).await?;
    Ok(())
}

pub async fn test_workflow(
    org_id: &str,
    id: &str,
    inputs: Vec<serde_json::Value>,
    from_node: Option<String>,
) -> Result<WorkflowResult, anyhow::Error> {
    let workflow = workflows::get_by_org_wid(org_id, id)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;
    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;

    let res = executable
        .process_workflow(org_id, inputs, from_node)
        .await?;
    Ok(res)
}

pub async fn execute_workflow(
    org_id: &str,
    id: &str,
    run_id: &str,
    inputs: Vec<serde_json::Value>,
) -> Result<(), anyhow::Error> {
    let workflow = workflows::get_by_org_wid(org_id, id)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;
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
        let errors = WorkflowRunErrors {
            org_id: org_id.to_string(),
            cluster: config::get_cluster_name(),
            id: 0, // will be set directly in db
            workflow_id: id.to_string(),
            run_id: run_id.to_string(),
            ran_at: now,
            data: workflow_errors,
        };
        // workflow has already run, so not much point in returning error because
        // we couldn't save the errors to db, log and ignore
        if let Err(e) = db::workflows::save_workflow_errors(errors).await {
            log::error!(
                "[Workflows] : error saving workflow run errors for run id {run_id} for workflow {org_id}/{id} in db : {e}"
            );
        }

        let ip_map = InputMap {
            complete: input_copy,
            node_map: errored_input_map,
        };

        let bytes = serde_json::to_vec(&ip_map)?;
        let path = get_inputs_file_path(org_id, id, run_id);
        infra::storage::put("", &path, bytes.into()).await?;
    }

    Ok(())
}

pub async fn get_workflow_errors(
    org_id: &str,
    wid: &str,
) -> Result<Vec<WorkflowRunErrors>, anyhow::Error> {
    let res = workflows::list_errors_for_workflow(org_id, wid).await?;
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

    let bytes = match get_inputs_file_data(&errors).await {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "error getting workflow run error input file for {org_id}/{wid} run_id {run_id} : {e}"
            );
            return Err(anyhow::anyhow!("error getting workflow run info : {e}"));
        }
    };

    let mut ip_map: InputMap = serde_json::from_slice(&bytes).map_err(|e| {
        log::error!(
            "error deserializing input file for workflow {org_id}/{wid} run id {run_id} : {e}"
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
