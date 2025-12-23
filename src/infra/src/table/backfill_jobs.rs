// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};

use super::get_lock;
pub use crate::table::entity::backfill_jobs::{ActiveModel, Column, Entity, Model, Relation};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors, orm_err,
};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, Debug)]
pub struct BackfillJob {
    pub id: String,
    pub org: String,
    pub pipeline_id: String,
    pub start_time: i64, // microseconds
    pub end_time: i64,   // microseconds
    pub chunk_period_minutes: Option<i64>,
    pub delay_between_chunks_secs: Option<i64>,
    pub delete_before_backfill: bool,
    pub created_at: i64, // microseconds
}

impl From<Model> for BackfillJob {
    fn from(model: Model) -> Self {
        Self {
            id: model.id,
            org: model.org,
            pipeline_id: model.pipeline_id,
            start_time: model.start_time,
            end_time: model.end_time,
            chunk_period_minutes: model.chunk_period_minutes,
            delay_between_chunks_secs: model.delay_between_chunks_secs,
            delete_before_backfill: model.delete_before_backfill,
            created_at: model.created_at,
        }
    }
}

pub async fn get(org: &str, job_id: &str) -> Result<BackfillJob, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(job_id))
        .one(client)
        .await;
    match res {
        Ok(Some(model)) => Ok(model.into()),
        Ok(None) => orm_err!("backfill job not found"),
        Err(e) => orm_err!(format!("get backfill job error: {e}")),
    }
}

pub async fn list_by_org(org: &str) -> Result<Vec<BackfillJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find().filter(Column::Org.eq(org)).all(client).await;
    match res {
        Ok(models) => Ok(models.into_iter().map(|model| model.into()).collect()),
        Err(e) => orm_err!(format!("list backfill jobs error: {e}")),
    }
}

pub async fn list_by_pipeline(
    org: &str,
    pipeline_id: &str,
) -> Result<Vec<BackfillJob>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::PipelineId.eq(pipeline_id))
        .all(client)
        .await;
    match res {
        Ok(models) => Ok(models.into_iter().map(|model| model.into()).collect()),
        Err(e) => orm_err!(format!("list backfill jobs by pipeline error: {e}")),
    }
}

pub async fn add(job: BackfillJob) -> Result<(), errors::Error> {
    let active = ActiveModel {
        id: Set(job.id.clone()),
        org: Set(job.org.clone()),
        pipeline_id: Set(job.pipeline_id.clone()),
        start_time: Set(job.start_time),
        end_time: Set(job.end_time),
        chunk_period_minutes: Set(job.chunk_period_minutes),
        delay_between_chunks_secs: Set(job.delay_between_chunks_secs),
        delete_before_backfill: Set(job.delete_before_backfill),
        created_at: Set(job.created_at),
    };

    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = active.insert(client).await;
    match res {
        Ok(_) => Ok(()),
        Err(e) => orm_err!(format!("add backfill job error: {e}")),
    }
}

pub async fn delete(org: &str, job_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;
    match res {
        Ok(_) => Ok(()),
        Err(e) => orm_err!(format!("delete backfill job error: {e}")),
    }
}

pub async fn update(job: &BackfillJob) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // Find existing model
    let existing = Entity::find()
        .filter(Column::Org.eq(&job.org))
        .filter(Column::Id.eq(&job.id))
        .one(client)
        .await;

    match existing {
        Ok(Some(model)) => {
            let mut active: ActiveModel = model.into();
            active.pipeline_id = Set(job.pipeline_id.clone());
            active.start_time = Set(job.start_time);
            active.end_time = Set(job.end_time);
            active.chunk_period_minutes = Set(job.chunk_period_minutes);
            active.delay_between_chunks_secs = Set(job.delay_between_chunks_secs);
            active.delete_before_backfill = Set(job.delete_before_backfill);

            let res = active.update(client).await;
            match res {
                Ok(_) => Ok(()),
                Err(e) => orm_err!(format!("update backfill job error: {e}")),
            }
        }
        Ok(None) => orm_err!("backfill job not found"),
        Err(e) => orm_err!(format!("find backfill job error: {e}")),
    }
}
