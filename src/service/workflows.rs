use std::collections::HashMap;

use infra::table::workflows::{self, Workflow, WorkflowError, WorkflowRunErrors};
use serde::Serialize;
use serde_json::Value;

use crate::service::pipeline::batch_execution::{ExecutablePipeline, WorkflowResult};

#[derive(Serialize)]
pub struct InputMap {
    complete: Vec<Value>,
    node_map: HashMap<String, Vec<Value>>,
}

fn get_inputs_file_path(org_id: &str, workflow_id: &str, run_id: &str) -> String {
    format!("files/{org_id}/workflow_inputs/{workflow_id}-{run_id}.json")
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
    // TODO YJDOc2: add pipeline like validation as well
    Ok(())
}

// TODO YJDoc2: add cluster sync
pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow)?;
    workflows::save_workflow(workflow).await?;
    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    validate_workflow(&workflow)?;
    workflows::update_workflow(workflow).await?;
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

// TOO YJDoc2: handle cluster sync
pub async fn delete_workflow(id: &str) -> Result<(), anyhow::Error> {
    workflows::delete_workflow(id).await?;
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

        for (e, val) in errors.errors {
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
        // TODO YJDOc2: truncate individual error at 100 chars and
        // total errors at 50 count
        // it is possible that we have errors, but no corresponding inputs
        // we should always show the errors to user, so we store it in db
        // but only create entry in input map if inputs are present
        if !err_list.is_empty() {
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
            id: 0, // will be set directly in db
            workflow_id: id.to_string(),
            run_id: run_id.to_string(),
            ran_at: now,
            data: workflow_errors,
        };
        // workflow has already run, so not much point in returning error because
        // we couldn't save the errors to db, log and ignore
        if let Err(e) = workflows::save_workflow_errors(errors).await {
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
