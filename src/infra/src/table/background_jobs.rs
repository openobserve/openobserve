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

use config::cluster::LOCAL_NODE;
use sea_orm::{
    prelude::Expr, sea_query::LockType, ColumnTrait, EntityTrait, FromQueryResult, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};

use super::{entity::background_jobs::*, get_lock};
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors, orm_err,
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
pub struct PartitionNum {
    pub partition_num: Option<i32>,
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
) -> Result<String, errors::Error> {
    let job_id = config::ider::uuid();
    let record = ActiveModel {
        id: Set(job_id.clone()),
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
    let _res = match Entity::insert(record).exec(client).await {
        Ok(res) => res,
        Err(e) => return orm_err!(format!("submit background job error: {e}")),
    };

    Ok(job_id)
}

pub async fn get_status_by_org_id(org_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await;

    let res = match res {
        Ok(res) => res,
        Err(e) => return orm_err!(format!("get background job by org_id error: {e}")),
    };

    Ok(res)
}

pub async fn get_status_by_job_id(job_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Id.eq(job_id))
        .all(client)
        .await;

    let res = match res {
        Ok(res) => res,
        Err(e) => return orm_err!(format!("get background job by job_id error: {e}")),
    };

    Ok(res)
}

pub async fn get_trace_id(job_id: &str) -> Result<Option<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .select_only()
        .filter(Column::Id.eq(job_id))
        .column(Column::TraceId)
        .into_model::<TraceId>()
        .one(client)
        .await;

    let res = match res {
        Ok(res) => res,
        Err(e) => return orm_err!(format!("get trace_id by job_id error: {e}")),
    };

    Ok(res.map(|res| res.trace_id))
}

pub async fn cancel_job(job_id: &str) -> Result<i32, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = match client.begin().await {
        Ok(tx) => tx,
        Err(e) => return orm_err!(format!("cancel job start transaction error: {e}")),
    };

    let res = Entity::find()
        .select_only()
        .column(Column::Status)
        .filter(Column::Id.eq(job_id))
        .lock(LockType::Update)
        .into_model::<Status>()
        .one(&tx)
        .await;

    let res = match res {
        Ok(status) => status,
        Err(e) => {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("cancel job rollback error: {e}"));
            };
            return orm_err!(format!("cancel job get status error: {e}"));
        }
    };

    if let Some(res) = &res {
        if res.status == 1 || res.status == 0 {
            if let Err(e) = Entity::update_many()
                .col_expr(Column::Status, Expr::value(3))
                .filter(Column::Id.eq(job_id))
                .exec(&tx)
                .await
            {
                log::error!("cancel job update status error: {e}");
                if let Err(e) = tx.rollback().await {
                    return orm_err!(format!("cancel job rollback update status error: {e}"));
                }
                return orm_err!(format!("cancel job update status error: {e}"));
            }
        } else {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("cancel job rollback error: {e}"));
            }
            return orm_err!(format!("job_id: {job_id} status is pending or running"));
        }
    } else {
        if let Err(e) = tx.rollback().await {
            return orm_err!(format!("cancel job rollback error: {e}"));
        }
        return orm_err!(format!("job_id: {job_id} is not found"));
    }

    if let Err(e) = tx.commit().await {
        return orm_err!(format!("cancel job commit error: {e}"));
    }

    Ok(res.unwrap().status)
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
        .await;

    match res {
        Ok(Some(res)) => Ok(res),
        Ok(None) => orm_err!("job_id not found"),
        Err(e) => orm_err!(format!("get result path error: {e}")),
    }
}

// get the job and update status
pub async fn get_job() -> Result<Option<Model>, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = match client.begin().await {
        Ok(tx) => tx,
        Err(e) => return orm_err!(format!("get job start transaction error: {e}")),
    };
    // sql: select * from background_jobs where status = 0 order by created_at limit 1 for update
    let res = Entity::find()
        .lock(LockType::Update)
        .filter(Column::Status.eq(0))
        .order_by_asc(Column::CreatedAt)
        .one(&tx)
        .await;

    let model = match res {
        Ok(model) => model,
        Err(e) => {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("get job rollback error: {e}"));
            };
            return orm_err!(format!("get job error: {e}"));
        }
    };

    if let Some(model) = &model {
        if let Err(e) = Entity::update_many()
            .col_expr(Column::Status, Expr::value(1))
            .col_expr(
                Column::UpdatedAt,
                Expr::value(chrono::Utc::now().timestamp_micros()),
            )
            .col_expr(
                Column::StartedAt,
                Expr::value(chrono::Utc::now().timestamp_micros()),
            )
            .col_expr(Column::Node, Expr::value(&LOCAL_NODE.uuid))
            .filter(Column::Id.eq(&model.id))
            .exec(&tx)
            .await
        {
            log::error!("get job update status error: {e}");
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("get job rollback update status error: {e}"));
            }
            return orm_err!(format!("get job update status error: {e}"));
        }
    }

    if let Err(e) = tx.commit().await {
        return orm_err!(format!("get job commit error: {e}"));
    }

    Ok(model)
}

pub async fn set_job_error_message(job_id: &str, error_message: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::ErrorMessage, Expr::value(error_message))
        .col_expr(Column::Status, Expr::value(2))
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set job error message error: {e}"));
    }

    Ok(())
}

pub async fn set_job_finish(job_id: &str, result_path: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(2))
        .col_expr(Column::ResultPath, Expr::value(result_path))
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .col_expr(
            Column::EndedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set job finish error: {e}"));
    }

    Ok(())
}

pub async fn update_running_job(job_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(
            Column::UpdatedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::Id.eq(job_id))
        .filter(Column::Status.eq(1))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("update running job error: {e}"));
    }

    Ok(())
}

pub async fn check_running_jobs(update_at: i64) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(0))
        .filter(Column::Status.eq(1))
        .filter(Column::UpdatedAt.lt(update_at))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("check running jobs error: {e}"));
    }

    Ok(())
}

pub async fn set_partition_num(job_id: &str, partition_num: i32) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::PartitionNum, Expr::value(partition_num))
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set partition num error: {e}"));
    }

    Ok(())
}

pub async fn partition_num(job_id: &str) -> Result<i32, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::find()
        .select_only()
        .column(Column::PartitionNum)
        .filter(Column::Id.eq(job_id))
        .into_model::<PartitionNum>()
        .one(client)
        .await;

    match res {
        Ok(Some(num)) => Ok(num.partition_num.unwrap_or_default()),
        Ok(None) => Ok(0),
        Err(e) => orm_err!(format!("get partition num error: {e}")),
    }
}
