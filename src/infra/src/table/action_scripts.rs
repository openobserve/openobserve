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

use config::meta::actions::action::{Action, ExecutionDetailsType};
use sea_orm::{
    entity::prelude::*, ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, JsonValue,
    Order, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema, Set,
};
use serde::Serialize;

use super::get_lock;
use crate::{
    db::{connect_to_orm, ORM_CLIENT},
    errors::{self, DbError, Error},
};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "action_scripts")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String, // Primary key, unique identifier
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub name: String, // Name with a max length of 32 characters
    #[sea_orm(column_type = "Text")]
    pub function: String, // The main action script
    #[sea_orm(column_type = "Json")]
    pub dependencies: String, // Dependencies or setup instructions
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub org_id: String,
    #[sea_orm(column_type = "Json")]
    pub env: JsonValue, // Environment variables serialized as JSON
    #[sea_orm(column_type = "Json")]
    pub execution_details: ExecutionDetailsType,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub cron_expr: Option<String>,
    #[sea_orm(default_value = "CURRENT_TIMESTAMP")]
    pub created_at: DateTimeUtc, // Automatically set on insert
    pub updated_at: Option<DateTimeUtc>, // Automatically updated
    pub last_executed_at: Option<DateTimeUtc>, // Automatically set on insert
    pub last_failure_at: Option<DateTimeUtc>, // Automatically updated
    #[sea_orm(default_value = "0")]
    pub failure_count: i32, // Number of times the script has failed
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(FromQueryResult, Debug, Serialize)]
pub struct ActionScriptDetails {
    pub id: String,
    pub name: String,
    pub function: String,
    pub dependencies: String,
    pub env: JsonValue,
    pub execution_details: ExecutionDetailsType,
    pub cron_expr: Option<String>,
}

#[derive(FromQueryResult, Debug, Serialize)]
pub struct ActionScriptInfo {
    pub id: String,
    pub name: String,
    pub created_at: DateTimeUtc,         // Automatically set on insert
    pub updated_at: Option<DateTimeUtc>, // Automatically updated
    pub last_executed_at: Option<DateTimeUtc>, // Automatically set on insert
    pub last_failure_at: Option<DateTimeUtc>, // Automatically updated
    pub failure_count: i32,              // Number of times the script has failed
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
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

// pub async fn create_table_index() -> Result<(), errors::Error> {
//     let index1 = IndexStatement::new("action_scripts_short_id_idx", "short_urls", true,
// &["short_id"]);     let index2 = IndexStatement::new(
//         "short_urls_created_ts_idx",
//         "short_urls",
//         false,
//         &["created_ts"],
//     );
//
//     let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
//     match client.get_database_backend() {
//         DatabaseBackend::MySql => {
//             mysql::create_index(index1).await?;
//             mysql::create_index(index2).await?;
//         }
//         DatabaseBackend::Postgres => {
//             postgres::create_index(index1).await?;
//             postgres::create_index(index2).await?;
//         }
//         _ => {
//             sqlite::create_index(index1).await?;
//             sqlite::create_index(index2).await?;
//         }
//     }
//     Ok(())
// }

pub async fn add(
    action: &Action,
    created_at: DateTimeUtc,
    org_id: &str,
) -> Result<(), errors::Error> {
    let record = ActiveModel {
        id: Set(action.id.unwrap().to_string().to_lowercase()),
        name: Set(action.name.clone()),
        org_id: Set(org_id.to_string()),
        function: Set(action.blob.clone()),
        env: Set(serde_json::json!(action.environment_variables.clone())),
        dependencies: Set(action.dependencies.join(",")),
        execution_details: Set(action.execution_details.clone()),
        created_at: Set(created_at),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn remove(id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get(id: &str, org_id: &str) -> Result<ActionScriptDetails, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    dbg!(&id, &org_id);
    let record = dbg!(
        Entity::find()
            .select_only()
            .column(Column::Id)
            .column(Column::Name)
            .column(Column::Function)
            .column(Column::Dependencies)
            .column(Column::Env)
            .column(Column::ExecutionDetails)
            .column(Column::CronExpr)
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::Id.eq(id))
            .into_model::<ActionScriptDetails>()
            .one(client)
            .await?
    )
    .ok_or_else(|| Error::DbError(DbError::SeaORMError("Action Script not found".to_string())))?;

    Ok(record)
}

pub async fn list(
    org_id: &str,
    limit: Option<i64>,
) -> Result<Vec<ActionScriptInfo>, errors::Error> {
    let limit = limit.unwrap_or(100);
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .select_only()
        .column(Column::Id)
        .column(Column::OrgId)
        .column(Column::Name)
        .column(Column::CreatedAt)
        .column(Column::UpdatedAt)
        .column(Column::LastExecutedAt)
        .column(Column::LastFailureAt)
        .column(Column::FailureCount)
        .filter(Column::OrgId.eq(org_id))
        .limit(limit as u64)
        .order_by(Column::Id, Order::Desc);

    let records = res.into_model::<ActionScriptInfo>().all(client).await?;

    Ok(records)
}

pub async fn contains(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Id.eq(id))
        .into_model::<ActionScriptInfo>()
        .one(client)
        .await?;

    Ok(record.is_some())
}

pub async fn len() -> usize {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let len = Entity::find().count(client).await;

    match len {
        Ok(len) => len as usize,
        Err(e) => {
            log::error!("short_urls len error: {}", e);
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

pub async fn is_empty() -> bool {
    len().await == 0
}

// pub async fn get_expired(
//     expired_before: i64,
//     limit: Option<i64>,
// ) -> Result<Vec<String>, errors::Error> {
//     let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
//     let mut res = Entity::find()
//         .select_only()
//         .column(Column::ShortId)
//         .filter(Column::CreatedTs.lt(expired_before));
//     if let Some(limit) = limit {
//         res = res.limit(limit as u64);
//     }
//     let records = res.into_model::<ShortId>().all(client).await?;
//     Ok(records.iter().map(|r| r.short_id.clone()).collect())
// }
//
// pub async fn batch_remove(short_ids: Vec<String>) -> Result<(), errors::Error> {
//     // make sure only one client is writing to the database(only for sqlite)
//     let _lock = get_lock().await;
//
//     let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
//     Entity::delete_many()
//         .filter(Column::ShortId.is_in(short_ids))
//         .exec(client)
//         .await?;
//
//     Ok(())
// }
