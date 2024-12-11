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
    prelude::Expr, ColumnTrait, EntityTrait, FromQueryResult, QueryFilter, QuerySelect, Set,
    TransactionTrait,
};

use super::{entity::background_job_partitions::*, get_lock};
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
pub struct Status {
    pub status: i32,
}

pub async fn cancel_partition_job(job_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(1))
        .filter(Column::Id.eq(job_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("cancel_partition_job failed: {}", e));
    }

    Ok(())
}

pub async fn is_have_partition_jobs(job_id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // sql: select id from background_job_partitions where id = job_id limit 1
    let status = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::Id.eq(job_id))
        .one(client)
        .await;

    match status {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(e) => orm_err!(format!("is_have_partition_jobs failed: {}", e)),
    }
}

pub async fn submit_partitions(job_id: &str, partitions: &[[i64; 2]]) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let mut jobs = Vec::with_capacity(partitions.len());
    for (idx, partition) in partitions.iter().enumerate() {
        jobs.push(ActiveModel {
            job_id: Set(job_id.to_string()),
            partition_id: Set(idx as i32),
            start_time: Set(partition[0]),
            end_time: Set(partition[1]),
            created_at: Set(chrono::Utc::now().timestamp_micros()),
            status: Set(0),
            ..Default::default()
        });
    }

    let tx = match client.begin().await {
        Ok(tx) => tx,
        Err(e) => return orm_err!(format!("submit partition job start transaction error: {e}")),
    };

    let res = Entity::insert_many(jobs).exec(&tx).await;

    if let Err(e) = res {
        log::error!("submit partition job insert error: {}", e);
        if let Err(e) = tx.rollback().await {
            return orm_err!(format!("submit partition job rollback error: {e}"));
        }
        return orm_err!(format!("submit partition job insert error: {e}"));
    } else if let Err(e) = tx.commit().await {
        return orm_err!(format!("submit partition job commit error: {e}"));
    }

    Ok(())
}

pub async fn get_partition_jobs_by_job_id(job_id: &str) -> Result<Vec<Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    // sql: select * from background_job_partitions where job_id = job_id and status = 0
    let res = Entity::find()
        .filter(Column::JobId.eq(job_id))
        .filter(Column::Status.eq(0))
        .all(client)
        .await;

    match res {
        Ok(jobs) => Ok(jobs),
        Err(e) => orm_err!(format!("get_partition_jobs_by_job_id failed: {}", e)),
    }
}

pub async fn set_partition_job_start(job_id: &str, partition_id: i32) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(1))
        .col_expr(
            Column::StartedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .filter(Column::JobId.eq(job_id))
        .filter(Column::PartitionId.eq(partition_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set_partition_job_start failed: {}", e));
    }

    Ok(())
}

pub async fn set_partition_job_finish(
    job_id: &str,
    partition_id: i32,
    path: &str,
) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(2))
        .col_expr(
            Column::EndedAt,
            Expr::value(chrono::Utc::now().timestamp_micros()),
        )
        .col_expr(Column::ResultPath, Expr::value(path))
        .filter(Column::JobId.eq(job_id))
        .filter(Column::PartitionId.eq(partition_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set_partition_job_finish failed: {}", e));
    }

    Ok(())
}

pub async fn set_partition_job_error_message(
    job_id: &str,
    partition_id: i32,
    error_message: &str,
) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::update_many()
        .col_expr(Column::ErrorMessage, Expr::value(error_message))
        .col_expr(Column::Status, Expr::value(2))
        .filter(Column::JobId.eq(job_id))
        .filter(Column::PartitionId.eq(partition_id))
        .exec(client)
        .await;

    if let Err(e) = res {
        return orm_err!(format!("set_partition_job_error_message failed: {}", e));
    }

    Ok(())
}
