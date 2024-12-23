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
    prelude::Expr,
    sea_query::{Keyword, LockType, SimpleExpr},
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait, UpdateMany,
};

use super::{
    entity::{
        background_job_partitions::{Column as PartitionJobColumn, Entity as PartitionJobEntity},
        background_job_results::{ActiveModel as JobResultModel, Entity as JobResultEntity},
        background_jobs::*,
    },
    get_lock,
};
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

#[allow(clippy::too_many_arguments)]
pub async fn submit(
    job_id: &str,
    trace_id: &str,
    org_id: &str,
    user_id: &str,
    stream_type: &str,
    stream_names: &str,
    payload: &str,
    start_time: i64,
    end_time: i64,
    created_at: i64,
    update_at: i64,
) -> Result<String, errors::Error> {
    let record = ActiveModel {
        id: Set(job_id.to_string()),
        trace_id: Set(trace_id.to_string()),
        org_id: Set(org_id.to_string()),
        user_id: Set(user_id.to_string()),
        stream_type: Set(stream_type.to_string()),
        stream_names: Set(stream_names.to_string()),
        payload: Set(payload.to_string()),
        start_time: Set(start_time),
        end_time: Set(end_time),
        created_at: Set(created_at),
        updated_at: Set(update_at),
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

    Ok(job_id.to_string())
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
            .col_expr(Column::Cluster, Expr::value(config::get_cluster_name()))
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

pub async fn list_status_by_org_id(org_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Status.ne(4))
        .all(client)
        .await;

    let res = match res {
        Ok(res) => res,
        Err(e) => return orm_err!(format!("get background job by org_id error: {e}")),
    };

    Ok(res)
}

pub async fn get(job_id: &str, org_id: &str) -> Result<Model, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::Id.eq(job_id))
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await;

    match res {
        Ok(Some(res)) => Ok(res),
        Ok(None) => orm_err!(format!("job_id: {job_id} not found")),
        Err(e) => orm_err!(format!("get background job by job_id: {job_id} error: {e}")),
    }
}

pub async fn cancel_job_by_job_id(job_id: &str) -> Result<i64, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = match client.begin().await {
        Ok(tx) => tx,
        Err(e) => return orm_err!(format!("cancel job start transaction error: {e}")),
    };

    let res = Entity::find()
        .filter(Column::Id.eq(job_id))
        .lock(LockType::Update)
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
            return orm_err!(format!(
                "job_id: {job_id} status is not pending or running, can not cancel"
            ));
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
        .filter(Column::Status.eq(1)) // make sure the job is running
        .exec(client)
        .await;

    match res {
        Ok(res) if res.rows_affected == 1 => Ok(()),
        Ok(_) => orm_err!("job_id not found or status is not running"),
        Err(e) => orm_err!(format!("set job finish error: {e}")),
    }
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

pub async fn set_partition_num(job_id: &str, partition_num: i64) -> Result<(), errors::Error> {
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

pub async fn get_deleted_jobs() -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::find()
        .filter(Column::Status.eq(4))
        .all(client)
        .await;

    match res {
        Ok(res) => Ok(res),
        Err(e) => orm_err!(format!("get deleted jobs error: {e}")),
    }
}

pub async fn clean_deleted_job(job_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::delete_many()
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("clean deleted jobs error: {e}"));
    }

    Ok(())
}

pub async fn set_job_deleted(job_id: &str) -> Result<bool, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(4))
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    match res {
        Ok(res) if res.rows_affected == 1 => Ok(true),
        Ok(_) => Ok(false),
        Err(e) => orm_err!(format!("set job deleted error: {e}")),
    }
}

// 1. start a transaction
// 2. move the status from job table -> job result table,
// 3. clean old status: trace_id updated_at started_at ended_at node status result_path
//    error_message partition_num
// 4. generate the new trace_id,
// 5. make the job as pending status
// 6. commit the transaction
// NOTE: this function can ensure,
// 1. for finished job, it reset all partition job's status, result_path, error_message
// 2. for failed job, it reset faild job and all pending job's status, result_path, error_message
pub async fn retry_background_job(job_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let tx = match client.begin().await {
        Ok(tx) => tx,
        Err(e) => return orm_err!(format!("retry job start transaction error: {e}")),
    };

    let res = Entity::find()
        .filter(Column::Id.eq(job_id))
        .lock(LockType::Update)
        .one(&tx)
        .await;

    let res = match res {
        Ok(Some(res)) => res,
        Ok(None) => {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("retry job rollback error: {e}"));
            }
            return orm_err!("job_id not found");
        }
        Err(e) => {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("retry job rollback error: {e}"));
            }
            return orm_err!(format!("retry job get job error: {e}"));
        }
    };

    // move the status from job table -> job result table
    let record = JobResultModel {
        job_id: Set(res.id.clone()),
        trace_id: Set(res.trace_id.clone()),
        started_at: Set(res.started_at),
        ended_at: Set(res.ended_at),
        cluster: Set(res.cluster.clone()),
        result_path: Set(res.result_path.clone()),
        error_message: Set(res.error_message.clone()),
    };

    // insert into job result table
    if let Err(e) = JobResultEntity::insert(record).exec(&tx).await {
        if let Err(e) = tx.rollback().await {
            return orm_err!(format!("retry job rollback error: {e}"));
        }
        return orm_err!(format!("retry job insert job result error: {e}"));
    };

    // reset all error job's status, result_path, error_message
    let mut query = generate_reset_partition_job_query(job_id);
    query = query.filter(PartitionJobColumn::ErrorMessage.is_not_null());
    let result = query.exec(&tx).await;
    if let Err(e) = result {
        if let Err(e) = tx.rollback().await {
            return orm_err!(format!("retry job rollback error: {e}"));
        }
        return orm_err!(format!("retry job update partition job error: {e}"));
    }

    // reset all finish job's status, result_path, error_message in partition job table
    if res.result_path.is_some() {
        let query = generate_reset_partition_job_query(job_id);
        let result = query.exec(&tx).await;
        if let Err(e) = result {
            if let Err(e) = tx.rollback().await {
                return orm_err!(format!("retry job rollback error: {e}"));
            }
            return orm_err!(format!("retry job update partition job error: {e}"));
        }
    }

    let mut model: ActiveModel = res.into();
    model.trace_id = Set(config::ider::uuid());
    model.status = Set(0);
    model.updated_at = Set(chrono::Utc::now().timestamp_micros());
    model.started_at = Set(None);
    model.ended_at = Set(None);
    model.node = Set(None);
    model.result_path = Set(None);
    model.error_message = Set(None);

    let res = model.update(&tx).await;

    if let Err(e) = res {
        if let Err(e) = tx.rollback().await {
            return orm_err!(format!("retry job rollback error: {e}"));
        }
        return orm_err!(format!("retry job update job error: {e}"));
    }

    if let Err(e) = tx.commit().await {
        return orm_err!(format!("retry job commit error: {e}"));
    }

    Ok(())
}

fn generate_reset_partition_job_query(job_id: &str) -> UpdateMany<PartitionJobEntity> {
    PartitionJobEntity::update_many()
        .col_expr(
            PartitionJobColumn::StartedAt,
            SimpleExpr::Keyword(Keyword::Null),
        )
        .col_expr(
            PartitionJobColumn::EndedAt,
            SimpleExpr::Keyword(Keyword::Null),
        )
        .col_expr(PartitionJobColumn::Status, Expr::value(0))
        .col_expr(
            PartitionJobColumn::Cluster,
            SimpleExpr::Keyword(Keyword::Null),
        )
        .col_expr(
            PartitionJobColumn::ResultPath,
            SimpleExpr::Keyword(Keyword::Null),
        )
        .col_expr(
            PartitionJobColumn::ErrorMessage,
            SimpleExpr::Keyword(Keyword::Null),
        )
        .filter(PartitionJobColumn::JobId.eq(job_id))
}
