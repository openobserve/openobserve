// Copyright 2024 OpenObserve Inc.
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

use sea_orm::{
    prelude::Expr, sea_query::LockType, ColumnTrait, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};

use super::{entity::background_jobs::*, get_lock};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, DbError, Error},
};

// in background_jobs table
// status 0: pending
// status 1: running
// status 2: finish
// status 3: cancel
// status 4: delete

#[derive(FromQueryResult, Debug)]
pub struct TraceId {
    pub trace_id: String,
}

#[derive(FromQueryResult, Debug)]
pub struct Status {
    pub status: i32,
}

#[derive(FromQueryResult, Debug)]
pub struct JobResult {
    pub path: String,
    pub error_message: String,
}

pub async fn submit(
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &str,
    payload: &str,
    start_time: i64,
    end_time: i64,
) -> Result<i64, errors::Error> {
    let record = ActiveModel {
        trace_id: Set(trace_id.to_string()),
        org_id: Set(org_id.to_string()),
        user_id: Set(user_id.to_string()),
        stream_type: Set(stream_type.to_string()),
        payload: Set(payload.to_string()),
        start_time: Set(start_time),
        end_time: Set(end_time),
        created_at: Set(chrono::Utc::now().timestamp_micros()),
        updated_at: Set(chrono::Utc::now().timestamp_micros()),
        status: Set(0),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::insert(record).exec(client).await?;

    // TODO: check if it is correct
    let id = res.last_insert_id as i64;

    Ok(id)
}

pub async fn get_status_by_org_id(org_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await?;

    Ok(res)
}

pub async fn get_status_by_job_id(job_id: i32) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Id.eq(job_id))
        .all(client)
        .await?;

    Ok(res)
}

pub async fn get_trace_id(job_id: i32) -> Result<String, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .select_only()
        .filter(Column::Id.eq(job_id))
        .column(Column::TraceId)
        .into_model::<TraceId>()
        .one(client)
        .await?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(format!(
                "job_id: {} not found",
                job_id
            )))
        })?;

    Ok(res.trace_id)
}

pub async fn cancel_job(job_id: i32) -> Result<i32, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = client.begin().await?;
    let res = Entity::find()
        .select_only()
        .column(Column::Status)
        .filter(Column::Id.eq(job_id))
        .lock(LockType::Update)
        .into_model::<Status>()
        .one(&tx)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())));
    if let Err(e) = res {
        tx.rollback().await?;
        return Err(e);
    }

    let status;
    if let Some(res) = res.unwrap() {
        if res.status == 1 || res.status == 0 {
            status = res.status;
            Entity::update_many()
                .col_expr(Column::Status, Expr::value(3))
                .filter(Column::Id.eq(job_id))
                .exec(&tx)
                .await?;
        } else {
            tx.rollback().await?;
            return Err(Error::DbError(DbError::SeaORMError(format!(
                "job_id: {job_id} is not running or pending, cannot cancel"
            ))));
        }
    } else {
        tx.rollback().await?;
        return Err(Error::DbError(DbError::SeaORMError(format!(
            "job_id: {job_id} not found"
        ))));
    }

    tx.commit().await?;

    Ok(status)
}

pub async fn get_result_path(job_id: &str) -> Result<JobResult, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .select_only()
        .filter(Column::Id.eq(job_id))
        .column(Column::ResultPath)
        .column(Column::ErrorMessage)
        .into_model::<JobResult>()
        .one(client)
        .await?;

    match res {
        Some(res) => Ok(res),
        None => Err(Error::DbError(DbError::SeaORMError(format!(
            "job_id: {job_id} not found"
        )))),
    }
}

pub async fn get_job() -> Result<Option<Model>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = client.begin().await?;
    // sql: select * from background_jobs where status = 0 order by created_at limit 1 for update
    let res = Entity::find()
        .lock(LockType::Update)
        .filter(Column::Status.eq(0))
        .order_by_asc(Column::CreatedAt)
        .one(&tx)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())));
    if let Err(e) = res {
        tx.rollback().await?;
        return Err(e);
    }

    let model = res.unwrap();
    if let Some(model) = &model {
        Entity::update_many()
            .col_expr(Column::Status, Expr::value(1))
            .filter(Column::Id.eq(model.id))
            .exec(&tx)
            .await?;
    }

    tx.commit().await?;

    Ok(model)
}

pub async fn set_error_message(id: i32, error_message: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::update_many()
        .col_expr(Column::ErrorMessage, Expr::value(error_message))
        .col_expr(Column::Status, Expr::value(2))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn set_status(id: i32, status: i32) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::update_many()
        .col_expr(Column::Status, Expr::value(status))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}
