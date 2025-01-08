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
    entity::prelude::*, ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait,
    DatabaseBackend, EntityTrait, FromQueryResult, Order, QueryFilter, QueryOrder, QuerySelect,
    Schema, Set, TryIntoModel,
};
use serde::{Deserialize, Serialize};

use super::get_lock;
use crate::{
    db::{connect_to_orm, mysql, postgres, sqlite, IndexStatement, ORM_CLIENT},
    errors::{self, DbError, Error},
};

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "i16", db_type = "Integer")]
pub enum TaskStatus {
    #[sea_orm(num_value = 0)]
    Pending,
    #[sea_orm(num_value = 1)]
    InProgress,
    #[sea_orm(num_value = 2)]
    Completed,
    #[sea_orm(num_value = 3)]
    Failed,
    #[sea_orm(num_value = 4)]
    FileDownload,
}

impl From<TaskStatus> for i16 {
    fn from(value: TaskStatus) -> Self {
        match value {
            TaskStatus::Pending => 0,
            TaskStatus::InProgress => 1,
            TaskStatus::Completed => 2,
            TaskStatus::Failed => 3,
            TaskStatus::FileDownload => 4,
        }
    }
}

impl From<i16> for TaskStatus {
    fn from(value: i16) -> Self {
        match value {
            0 => TaskStatus::Pending,
            1 => TaskStatus::InProgress,
            2 => TaskStatus::Completed,
            3 => TaskStatus::Failed,
            4 => TaskStatus::FileDownload,
            _ => unimplemented!("TaskStatus enum value not found"),
        }
    }
}

// Define the table schema for enrichment_table_jobs
#[derive(Debug, Clone, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "enrichment_table_jobs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub task_id: String,
    #[sea_orm(column_type = "Integer", default = "0")]
    pub task_status: i16,
    #[sea_orm(column_type = "Text", nullable)]
    pub file_key: Option<String>, // Optional field for file key on the local disk
    #[sea_orm(column_type = "Text", nullable)]
    pub file_link: Option<String>, // Optional field for HTTP link to the file
    pub created_ts: i64,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Debug, Clone, PartialEq, FromQueryResult)]
pub struct EnrichmentTableJobsRecord {
    pub task_id: String,
    pub task_status: TaskStatus,
    pub file_key: Option<String>,
    pub file_link: Option<String>,
}

impl EnrichmentTableJobsRecord {
    pub fn new(task_id: &str, file_key: Option<String>, file_link: Option<String>) -> Self {
        Self {
            task_id: task_id.to_string(),
            task_status: TaskStatus::Pending,
            file_key,
            file_link,
        }
    }
}

impl From<Model> for EnrichmentTableJobsRecord {
    fn from(value: Model) -> Self {
        Self {
            task_id: value.task_id,
            task_status: TaskStatus::from(value.task_status),
            file_key: value.file_key,
            file_link: value.file_link,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TaskId {
    pub task_id: String,
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    create_table_index().await?;
    Ok(())
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client.execute(builder.build(&create_table_stmt)).await?;

    Ok(())
}

pub async fn create_table_index() -> Result<(), errors::Error> {
    let index1 = IndexStatement::new(
        "enrichment_table_jobs_task_id_idx",
        "enrichment_table_jobs",
        true,
        &["task_id"],
    );
    let index2 = IndexStatement::new(
        "enrichment_table_jobs_task_status_created_ts_idx",
        "enrichment_table_jobs",
        true,
        &["task_status", "created_ts"],
    );

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match client.get_database_backend() {
        DatabaseBackend::MySql => {
            mysql::create_index(index1).await?;
            mysql::create_index(index2).await?;
        }
        DatabaseBackend::Postgres => {
            postgres::create_index(index1).await?;
            postgres::create_index(index2).await?;
        }
        _ => {
            sqlite::create_index(index1).await?;
            sqlite::create_index(index2).await?;
        }
    }
    Ok(())
}

pub async fn add(
    task_id: &str,
    task_status: TaskStatus,
    file_key: Option<String>,
    file_link: Option<String>,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        task_id: Set(task_id.to_string()),
        task_status: Set(task_status.into()),
        file_key: Set(file_key),
        file_link: Set(file_link),
        created_ts: Set(chrono::Utc::now().timestamp()),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn put(
    task_id: &str,
    task_status: TaskStatus,
    file_key: Option<String>,
    file_link: Option<String>,
) -> Result<EnrichmentTableJobsRecord, errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let active: ActiveModel = match get_model(client, task_id).await? {
        Some(model) => {
            let mut active: ActiveModel = model.into();
            active.task_status = Set(task_status.into());
            active.file_key = Set(file_key);
            active.file_link = Set(file_link);
            active
        }
        None => ActiveModel {
            id: NotSet,
            task_id: Set(task_id.to_string()),
            task_status: Set(task_status.into()),
            file_key: Set(file_key),
            file_link: Set(file_link),
            created_ts: Set(chrono::Utc::now().timestamp()),
        },
    };

    let model: Model = active.save(client).await?.try_into_model()?;

    Ok(model.into())
}

pub async fn remove(task_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::TaskId.eq(task_id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get(task_id: &str) -> Result<EnrichmentTableJobsRecord, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .select_only()
        .column(Column::TaskId)
        .column(Column::TaskStatus)
        .column(Column::FileKey)
        .column(Column::FileLink)
        .filter(Column::TaskId.eq(task_id))
        .into_model::<EnrichmentTableJobsRecord>()
        .one(client)
        .await?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError(
                "Enrichment table jobs task id not found".to_string(),
            ))
        })?;

    Ok(record)
}

pub async fn list(limit: Option<i64>) -> Result<Vec<EnrichmentTableJobsRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut records = Entity::find()
        .select_only()
        .column(Column::TaskId)
        .column(Column::TaskStatus)
        .column(Column::FileKey)
        .column(Column::FileLink)
        .order_by(Column::CreatedTs, Order::Desc);

    if let Some(limit) = limit {
        records = records.limit(limit as u64);
    }

    let records = records
        .into_model::<EnrichmentTableJobsRecord>()
        .all(client)
        .await?;

    Ok(records)
}

pub async fn len() -> usize {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("enrichment_table_jobs len error: {}", e);
            0
        }
    }
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

pub async fn get_pending_task() -> Option<EnrichmentTableJobsRecord> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::find()
        .select_only()
        .column(Column::TaskId)
        .column(Column::TaskStatus)
        .column(Column::FileKey)
        .column(Column::FileLink)
        .filter(Column::TaskStatus.eq(TaskStatus::Pending))
        .order_by(Column::CreatedTs, Order::Asc)
        .into_model::<EnrichmentTableJobsRecord>()
        .one(client)
        .await
        .ok()?
}

pub async fn update_running_job(task_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let active: ActiveModel = match get_model(client, task_id).await? {
        Some(model) => {
            let mut active: ActiveModel = model.into();
            active.task_status = Set(TaskStatus::InProgress.into());
            active
        }
        None => {
            return Err(Error::DbError(DbError::SeaORMError(
                "Task not found".to_string(),
            )))
        }
    };
    active.save(client).await?;

    Ok(())
}

pub async fn set_job_finish(task_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let active: ActiveModel = match get_model(client, task_id).await? {
        Some(model) => {
            let mut active: ActiveModel = model.into();
            active.task_status = Set(TaskStatus::Completed.into());
            active
        }
        None => {
            return Err(Error::DbError(DbError::SeaORMError(
                "Task not found".to_string(),
            )))
        }
    };
    active.save(client).await?;

    Ok(())
}

pub async fn set_job_failed(task_id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let active: ActiveModel = match get_model(client, task_id).await? {
        Some(model) => {
            let mut active: ActiveModel = model.into();
            active.task_status = Set(TaskStatus::Failed.into());
            active
        }
        None => {
            return Err(Error::DbError(DbError::SeaORMError(
                "Task not found".to_string(),
            )))
        }
    };
    active.save(client).await?;

    Ok(())
}

pub async fn set_job_status(task_id: &str, task_status: TaskStatus) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let active: ActiveModel = match get_model(client, task_id).await? {
        Some(model) => {
            let mut active: ActiveModel = model.into();
            active.task_status = Set(task_status.into());
            active
        }
        None => {
            return Err(Error::DbError(DbError::SeaORMError(
                "Task not found".to_string(),
            )))
        }
    };
    active.save(client).await?;

    Ok(())
}

pub async fn delete_jobs() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::TaskStatus.eq(TaskStatus::Completed))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn is_empty() -> bool {
    len().await == 0
}

pub(crate) async fn get_model<C: ConnectionTrait>(
    db: &C,
    task_id: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::TaskId.eq(task_id))
        .one(db)
        .await
}
