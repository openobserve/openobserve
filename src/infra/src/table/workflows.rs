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

use config::meta::pipeline::components::{Edge, Node};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait, prelude::Expr};
use serde::{Deserialize, Serialize};

use super::{
    entity::{workflow_errors, workflows},
    get_lock,
};
use crate::db::{ORM_CLIENT, connect_to_orm};

#[derive(Deserialize, Serialize, Clone)]
pub struct Workflow {
    pub id: String,
    pub org_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub created_by: String,
    pub enabled: bool,
    pub name: String,
    pub description: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct WorkflowError {
    pub node_id: String,
    pub error: Vec<String>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct WorkflowRunErrors {
    pub id: i32,
    pub cluster: String,
    pub org_id: String,
    pub workflow_id: String,
    pub run_id: String,
    pub ran_at: i64,
    pub data: Vec<WorkflowError>,
}

impl TryFrom<workflows::Model> for Workflow {
    type Error = anyhow::Error;
    fn try_from(value: workflows::Model) -> Result<Self, Self::Error> {
        let ret = Self {
            id: value.id,
            org_id: value.org_id,
            created_at: value.created_at,
            updated_at: value.updated_at,
            created_by: value.created_by,
            enabled: value.enabled,
            name: value.name,
            description: value.description,
            nodes: serde_json::from_str(&value.nodes)?,
            edges: serde_json::from_str(&value.edges)?,
        };
        Ok(ret)
    }
}

impl TryFrom<workflow_errors::Model> for WorkflowRunErrors {
    type Error = anyhow::Error;
    fn try_from(value: workflow_errors::Model) -> Result<Self, Self::Error> {
        let ret = Self {
            id: value.id,
            cluster: value.cluster,
            org_id: value.org_id,
            workflow_id: value.workflow_id,
            run_id: value.run_id,
            ran_at: value.ran_at,
            data: serde_json::from_str(&value.data)?,
        };
        Ok(ret)
    }
}

pub async fn list_all() -> Result<Vec<Workflow>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let entities = workflows::Entity::find().all(client).await?;
    let mut ret = Vec::with_capacity(entities.len());
    for e in entities {
        ret.push(e.try_into()?);
    }
    Ok(ret)
}

pub async fn list_by_org(org_id: &str) -> Result<Vec<Workflow>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let entities = workflows::Entity::find()
        .filter(workflows::Column::OrgId.eq(org_id))
        .all(client)
        .await?;
    let mut ret = Vec::with_capacity(entities.len());
    for e in entities {
        ret.push(e.try_into()?);
    }
    Ok(ret)
}

pub async fn get_by_org_wid(
    org_id: &str,
    workflow_id: &str,
) -> Result<Option<Workflow>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = workflows::Entity::find()
        .filter(workflows::Column::Id.eq(workflow_id))
        .filter(workflows::Column::OrgId.eq(org_id))
        .one(client)
        .await?;

    let ret = res.map(|v| v.try_into()).transpose()?;
    Ok(ret)
}

pub async fn get_errors_for_run(
    org_id: &str,
    wid: &str,
    run_id: &str,
) -> Result<Option<WorkflowRunErrors>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = workflow_errors::Entity::find()
        .filter(workflow_errors::Column::OrgId.eq(org_id))
        .filter(workflow_errors::Column::WorkflowId.eq(wid))
        .filter(workflow_errors::Column::RunId.eq(run_id))
        .one(client)
        .await?;

    let ret = res.map(|v| v.try_into()).transpose()?;

    Ok(ret)
}

pub async fn list_errors_for_workflow_run(
    org_id: &str,
    wid: &str,
    run_id: &str,
) -> Result<Option<WorkflowRunErrors>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = workflow_errors::Entity::find()
        .filter(workflow_errors::Column::OrgId.eq(org_id))
        .filter(workflow_errors::Column::WorkflowId.eq(wid))
        .filter(workflow_errors::Column::RunId.eq(run_id))
        .one(client)
        .await?;

    let ret = res.map(|v| v.try_into()).transpose()?;
    Ok(ret)
}

pub async fn save_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let now = chrono::Utc::now().timestamp_millis();
    let model = workflows::ActiveModel {
        id: Set(workflow.id),
        org_id: Set(workflow.org_id),
        created_at: Set(now),
        updated_at: Set(now),
        created_by: Set(workflow.created_by),
        enabled: Set(workflow.enabled),
        name: Set(workflow.name),
        description: Set(workflow.description),
        nodes: Set(serde_json::to_string(&workflow.nodes)?),
        edges: Set(serde_json::to_string(&workflow.edges)?),
    };
    workflows::Entity::insert(model).exec(client).await?;
    Ok(())
}

pub async fn update_workflow(workflow: Workflow) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let now = chrono::Utc::now().timestamp_millis();
    let model = workflows::ActiveModel {
        updated_at: Set(now),
        enabled: Set(workflow.enabled),
        name: Set(workflow.name),
        description: Set(workflow.description),
        nodes: Set(serde_json::to_string(&workflow.nodes)?),
        edges: Set(serde_json::to_string(&workflow.edges)?),
        ..Default::default()
    };
    workflows::Entity::update_many()
        .filter(workflows::Column::Id.eq(workflow.id))
        .set(model)
        .exec(client)
        .await?;
    Ok(())
}

pub async fn save_workflow_errors(errors: WorkflowRunErrors) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;
    let model = workflow_errors::ActiveModel {
        cluster: Set(errors.cluster),
        org_id: Set(errors.org_id),
        workflow_id: Set(errors.workflow_id),
        run_id: Set(errors.run_id),
        ran_at: Set(errors.ran_at),
        data: Set(serde_json::to_string(&errors.data)?),
        ..Default::default()
    };
    workflow_errors::Entity::insert(model).exec(client).await?;
    Ok(())
}

pub async fn update_error_input_file_cluster(
    errors: WorkflowRunErrors,
) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_errors::Entity::update_many()
        .filter(workflow_errors::Column::OrgId.eq(errors.org_id))
        .filter(workflow_errors::Column::WorkflowId.eq(errors.workflow_id))
        .filter(workflow_errors::Column::RunId.eq(errors.run_id))
        .col_expr(
            workflow_errors::Column::Cluster,
            Expr::value(errors.cluster),
        )
        .exec(client)
        .await?;

    Ok(())
}

pub async fn delete_workflow(id: &str) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflows::Entity::delete_many()
        .filter(workflows::Column::Id.eq(id))
        .exec(client)
        .await?;
    // we do not handler workflow errors here, as background job will take care of them eventually,
    // and will also handle input data file deletion
    Ok(())
}

pub async fn delete_all_errors_older_than(
    ts: i64,
) -> Result<Vec<WorkflowRunErrors>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    // ideally this could be delete returning, but sqlite does not
    // support that with seaorm, so transaction instead, which is still not
    // the same, but should be ok
    let txn = client.begin().await?;

    let errors = match workflow_errors::Entity::find()
        .filter(workflow_errors::Column::RanAt.lte(ts))
        .all(&txn)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("db error in getting workflow errors : {e}");
            txn.rollback().await?;
            return Err(e.into());
        }
    };

    if let Err(e) = workflow_errors::Entity::delete_many()
        .filter(workflow_errors::Column::RanAt.lte(ts))
        .exec(&txn)
        .await
    {
        log::error!("db error in deleting workflow errors : {e}");
        txn.rollback().await?;
        return Err(e.into());
    };

    txn.commit().await?;

    let ret: Result<Vec<_>, anyhow::Error> = errors.into_iter().map(|v| v.try_into()).collect();

    Ok(ret?)
}
