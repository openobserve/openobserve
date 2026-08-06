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
    entity::{workflow_errors, workflow_run_data, workflows},
    get_lock,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    table::entity::workflow_associations,
};

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
    pub input_data: Option<String>,
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
            input_data: value.input_data,
        };
        Ok(ret)
    }
}

pub struct WorkflowRunData {
    pub id: i32,
    pub org_id: String,
    pub workflow_id: String,
    pub run_id: String,
    pub triggered_at: i64,
    pub data: String,
}

impl From<workflow_run_data::Model> for WorkflowRunData {
    fn from(value: workflow_run_data::Model) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            workflow_id: value.workflow_id,
            run_id: value.run_id,
            triggered_at: value.triggered_at,
            data: value.data,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorkflowAssociation {
    pub id: i32,
    pub org_id: String,
    pub entity_id: String,
    pub entity_type: String,
    pub workflow_id: String,
    pub trigger_type: String,
    pub created_at: i64,
}

impl From<workflow_associations::Model> for WorkflowAssociation {
    fn from(value: workflow_associations::Model) -> Self {
        Self {
            id: value.id,
            org_id: value.org_id,
            entity_id: value.entity_id,
            entity_type: value.entity_type,
            workflow_id: value.workflow_id,
            trigger_type: value.trigger_type,
            created_at: value.created_at,
        }
    }
}

pub enum WorkflowTriggerEntity {
    Alert,
    Incident,
}

impl std::fmt::Display for WorkflowTriggerEntity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Alert => write!(f, "alert"),
            Self::Incident => write!(f, "incident"),
        }
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
        input_data: Set(errors.input_data),
        ..Default::default()
    };
    workflow_errors::Entity::insert(model).exec(client).await?;
    Ok(())
}

pub async fn update_error_input_file_cluster_data(
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
        .col_expr(
            workflow_errors::Column::InputData,
            Expr::value(errors.input_data),
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

    errors.into_iter().map(|v| v.try_into()).collect()
}

pub async fn delete_all_runs_older_than(ts: i64) -> Result<Vec<WorkflowRunData>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    // ideally this could be delete returning, but sqlite does not
    // support that with seaorm, so transaction instead, which is still not
    // the same, but should be ok
    let txn = client.begin().await?;

    let data = match workflow_run_data::Entity::find()
        .filter(workflow_run_data::Column::TriggeredAt.lte(ts))
        .all(&txn)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!("db error in getting workflow runs to clean : {e}");
            txn.rollback().await?;
            return Err(e.into());
        }
    };

    if let Err(e) = workflow_run_data::Entity::delete_many()
        .filter(workflow_run_data::Column::TriggeredAt.lte(ts))
        .exec(&txn)
        .await
    {
        log::error!("db error in deleting workflow runs to clean : {e}");
        txn.rollback().await?;
        return Err(e.into());
    };

    txn.commit().await?;

    let ret: Vec<_> = data.into_iter().map(|v| v.into()).collect();

    Ok(ret)
}

pub async fn get_run_data(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<Option<String>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let ret = workflow_run_data::Entity::find()
        .filter(workflow_run_data::Column::OrgId.eq(org_id))
        .filter(workflow_run_data::Column::WorkflowId.eq(workflow_id))
        .filter(workflow_run_data::Column::RunId.eq(run_id))
        .one(client)
        .await?;

    Ok(ret.map(|v| v.data))
}

pub async fn delete_run_data(
    org_id: &str,
    workflow_id: &str,
    run_id: &str,
) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_run_data::Entity::delete_many()
        .filter(workflow_run_data::Column::OrgId.eq(org_id))
        .filter(workflow_run_data::Column::WorkflowId.eq(workflow_id))
        .filter(workflow_run_data::Column::RunId.eq(run_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn save_workflow_run_data(entry: WorkflowRunData) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let model = workflow_run_data::ActiveModel {
        org_id: Set(entry.org_id),
        workflow_id: Set(entry.workflow_id),
        run_id: Set(entry.run_id),
        triggered_at: Set(entry.triggered_at),
        data: Set(entry.data),
        ..Default::default()
    };
    workflow_run_data::Entity::insert(model)
        .exec(client)
        .await?;
    Ok(())
}

pub async fn get_all_associations_for_workflow(
    org_id: &str,
    workflow_id: &str,
) -> Result<Vec<WorkflowAssociation>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let ret = workflow_associations::Entity::find()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::WorkflowId.eq(workflow_id))
        .all(client)
        .await?;
    let res = ret.into_iter().map(Into::into).collect();
    Ok(res)
}

pub async fn get_all_associations_for_entity(
    org_id: &str,
    entity_id: &str,
    entity_type: &str,
) -> Result<Vec<WorkflowAssociation>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let ret = workflow_associations::Entity::find()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::EntityId.eq(entity_id))
        .filter(workflow_associations::Column::EntityType.eq(entity_type))
        .all(client)
        .await?;
    let res = ret.into_iter().map(Into::into).collect();
    Ok(res)
}

pub async fn get_all_associations_for_trigger_type(
    org_id: &str,
    trigger: &str,
) -> Result<Vec<WorkflowAssociation>, anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let ret = workflow_associations::Entity::find()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::TriggerType.eq(trigger))
        .all(client)
        .await?;
    let res = ret.into_iter().map(Into::into).collect();
    Ok(res)
}

pub async fn add_workflow_association(entry: WorkflowAssociation) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let model = workflow_associations::ActiveModel {
        id: Default::default(),
        org_id: Set(entry.org_id),
        workflow_id: Set(entry.workflow_id),
        entity_id: Set(entry.entity_id),
        entity_type: Set(entry.entity_type),
        trigger_type: Set(entry.trigger_type),
        created_at: Set(entry.created_at),
    };
    workflow_associations::Entity::insert(model)
        .exec(client)
        .await?;
    Ok(())
}

pub async fn delete_workflow_association(
    org_id: &str,
    workflow_id: &str,
    entity_id: &str,
) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_associations::Entity::delete_many()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::WorkflowId.eq(workflow_id))
        .filter(workflow_associations::Column::EntityId.eq(entity_id))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn delete_association_by_workflow(org_id: &str, id: &str) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_associations::Entity::delete_many()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::WorkflowId.eq(id))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn delete_association_by_trigger(
    org_id: &str,
    trigger: &str,
) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_associations::Entity::delete_many()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::TriggerType.eq(trigger))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn delete_association_by_entity(org_id: &str, entity: &str) -> Result<(), anyhow::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    workflow_associations::Entity::delete_many()
        .filter(workflow_associations::Column::OrgId.eq(org_id))
        .filter(workflow_associations::Column::EntityId.eq(entity))
        .exec(client)
        .await?;
    Ok(())
}
