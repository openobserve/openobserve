// Copyright 2025 OpenObserve Inc.
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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use serde::{Deserialize, Serialize};

use super::{get_lock, migration::Expr};
pub use crate::table::entity::compactor_manual_jobs::{
    ActiveModel, Column, Entity, Model, Relation,
};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors, orm_err,
};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactorManualJob {
    pub id: String,
    pub key: String,
    pub created_at: i64,
    pub ended_at: i64,
    pub status: Status,
}

impl From<Model> for CompactorManualJob {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            key: model.key,
            created_at: model.created_at,
            ended_at: model.ended_at,
            status: Status::from(model.status),
        }
    }
}

impl TryFrom<CompactorManualJob> for String {
    type Error = serde_json::Error;
    fn try_from(job: CompactorManualJob) -> Result<Self, Self::Error> {
        serde_json::to_string(&job)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Status {
    Pending = 0,
    Running = 1,
    Completed = 2,
}

impl From<i64> for Status {
    fn from(value: i64) -> Self {
        match value {
            0 => Status::Pending,
            1 => Status::Running,
            2 => Status::Completed,
            _ => unreachable!(),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompactorManualJobResEntry {
    #[serde(skip_serializing_if = "String::is_empty")]
    pub cluster: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub region: String,
    #[serde(flatten)]
    pub job: CompactorManualJob,
}

#[derive(Serialize)]
pub struct CompactorManualJobStatusRes {
    pub id: String,
    pub status: Status,
    pub metadata: Vec<CompactorManualJobResEntry>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<serde_json::Value>,
}

pub async fn get(ksuid: &str) -> Result<CompactorManualJob, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Id.eq(ksuid))
        .one(client)
        .await;
    match res {
        Ok(Some(model)) => Ok(model.into()),
        Ok(None) => orm_err!("job not found"),
        Err(e) => orm_err!(format!("get job error: {e}")),
    }
}

pub async fn get_by_key(
    key: &str,
    status: Option<Status>,
) -> Result<CompactorManualJob, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res;
    if let Some(status) = status {
        res = Entity::find()
            .filter(Column::Key.eq(key))
            .filter(Column::Status.eq(status as i64))
            .one(client)
            .await;
    } else {
        res = Entity::find().filter(Column::Key.eq(key)).one(client).await;
    }
    match res {
        Ok(Some(model)) => Ok(model.into()),
        Ok(None) => orm_err!("job not found"),
        Err(e) => orm_err!(format!("get job error: {e}")),
    }
}

pub async fn list_by_key(key: &str) -> Result<Vec<CompactorManualJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find().filter(Column::Key.eq(key)).all(client).await;
    match res {
        Ok(models) => Ok(models.into_iter().map(|model| model.into()).collect()),
        Err(e) => orm_err!(format!("get job error: {e}")),
    }
}

pub async fn add(job: CompactorManualJob) -> Result<(), errors::Error> {
    let active = ActiveModel {
        id: Set(job.id.to_string()),
        key: Set(job.key.to_string()),
        created_at: Set(job.created_at),
        ended_at: Set(job.ended_at),
        status: Set(job.status as i64),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(active).exec(client).await.map_err(|e| {
        log::error!("[COMPACTOR] add job error: {e}");
        e
    })?;

    Ok(())
}

pub async fn update(ksuid: &str, ended_at: i64, status: Status) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::update_many()
        .col_expr(Column::EndedAt, Expr::value(ended_at))
        .col_expr(Column::Status, Expr::value(status as i64))
        .filter(Column::Id.eq(ksuid))
        .exec(client)
        .await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => orm_err!(format!("update job error: {e}")),
    }
}

pub async fn bulk_update(jobs: Vec<CompactorManualJob>) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let tx = client.begin().await?;

    for job in jobs {
        Entity::update_many()
            .col_expr(Column::EndedAt, Expr::value(job.ended_at))
            .col_expr(Column::Status, Expr::value(job.status as i64))
            .filter(Column::Id.eq(&job.id))
            .exec(&tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}
