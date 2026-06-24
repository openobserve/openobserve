use infra::table::workflows::{self, Workflow};

use crate::service::pipeline::batch_execution::ExecutablePipeline;

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
) -> Result<(), anyhow::Error> {
    let workflow = workflows::get_by_org_wid(org_id, id)
        .await?
        .ok_or(anyhow::anyhow!("workflow with given id not found"))?;
    let executable = ExecutablePipeline::new_from_workflow(&workflow).await?;

    executable.process_workflow(org_id, inputs).await?;
    Ok(())
}
