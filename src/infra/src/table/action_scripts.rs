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

use std::str::FromStr;

use config::meta::actions::action::{Action, ActionStatus, ExecutionDetailsType};
use sea_orm::{
    entity::prelude::*, ColumnTrait, ConnectionTrait, EntityTrait, JsonValue, Order,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Schema, Set,
};

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
    pub file_path: String, // Zip file for action script
    pub file_name: String,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub org_id: String,
    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub created_by: String,
    #[sea_orm(column_type = "Json")]
    pub env: JsonValue, // Environment variables serialized as JSON
    #[sea_orm(column_type = "Json")]
    pub execution_details: ExecutionDetailsType,
    #[sea_orm(column_type = "String(StringLen::N(32))")]
    pub cron_expr: Option<String>,
    #[sea_orm(default_value = "CURRENT_TIMESTAMP")]
    pub created_at: DateTimeUtc, // Automatically set on insert
    pub last_modified_at: DateTimeUtc,
    pub last_executed_at: Option<DateTimeUtc>,
    pub last_successful_at: Option<DateTimeUtc>,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    pub status: ActionStatus,
}

impl TryFrom<Model> for Action {
    type Error = errors::Error;

    fn try_from(model: Model) -> Result<Self, Self::Error> {
        Ok(Action {
            id: Some(
                svix_ksuid::Ksuid::from_str(&model.id)
                    .map_err(|e| Error::Message(e.to_string()))?,
            ),
            name: model.name,
            org_id: model.org_id,
            environment_variables: serde_json::from_value(model.env)?,
            created_by: model.created_by,
            execution_details: model.execution_details,
            zip_file_path: Some(model.file_path),
            created_at: model.created_at,
            last_executed_at: model.last_executed_at,
            description: model.description,
            cron_expr: model.cron_expr,
            status: model.status,
            zip_file_name: model.file_name,
            last_modified_at: model.last_modified_at,
            last_successful_at: model.last_successful_at,
        })
    }
}
#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

// #[derive(FromQueryResult, Debug, Serialize)]
// pub struct ActionScriptDetails {
//     pub id: String,
//     pub name: String,
//     pub env: JsonValue,
//     pub execution_details: ExecutionDetailsType,
//     pub cron_expr: Option<String>,
// }

// #[derive(FromQueryResult, Debug, Serialize, Deserialize)]
// pub struct ActionScriptInfo {
//     pub id: String,
//     pub name: String,
//     pub running: bool,
//     pub created_at: DateTimeUtc,         // Automatically set on insert
//     pub updated_at: Option<DateTimeUtc>, // Automatically updated
//     pub last_executed_at: Option<DateTimeUtc>, // Automatically set on insert
//     pub failure_count: i32,              // Number of times the script has failed
// }

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

pub async fn add(action: &Action) -> Result<(), errors::Error> {
    let record = ActiveModel {
        id: Set(action.id.unwrap().to_string()),
        name: Set(action.name.clone()),
        org_id: Set(action.org_id.to_string()),
        file_path: Set(action
            .zip_file_path
            .clone()
            .ok_or(Error::Message(format!("file path not set")))?),
        env: Set(serde_json::json!(action.environment_variables.clone())),
        execution_details: Set(action.execution_details.clone()),
        cron_expr: Set(action.cron_expr.clone()),
        created_at: Set(action.created_at),
        last_modified_at: Set(action.last_modified_at.clone()),
        last_executed_at: Set(action.last_executed_at.clone()),
        last_successful_at: Set(action.last_successful_at.clone()),
        description: Set(action.description.clone()),
        file_name: Set(action.zip_file_name.clone()),
        created_by: Set(action.created_by.clone()),
        status: Set(action.status.clone()),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn remove(org_id: &str, id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _ = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get(id: &str, org_id: &str) -> Result<Action, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find_by_id(id)
        .filter(Column::OrgId.eq(org_id))
        .one(client)
        .await?
        .ok_or_else(|| {
            Error::DbError(DbError::SeaORMError("Action Script not found".to_string()))
        })?;

    Ok(record.try_into()?)
}

pub async fn list(org_id: &str, limit: Option<i64>) -> Result<Vec<Action>, errors::Error> {
    let limit = limit.unwrap_or(100);
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .limit(limit as u64)
        .order_by(Column::Id, Order::Desc);

    let records = res
        .all(client)
        .await?
        .into_iter()
        .map(Action::try_from)
        .collect::<Result<_, errors::Error>>()?;

    Ok(records)
}

pub async fn update(action: &Action) -> Result<(), errors::Error> {
    let id = action.id.ok_or(Error::Message("id not set".to_string()))?;
    let record = ActiveModel {
        id: Set(id.to_string()),
        name: Set(action.name.clone()),
        org_id: Set(action.org_id.to_string()),
        file_path: Set(action
            .zip_file_path
            .clone()
            .ok_or(Error::Message(format!("file path not set")))?),
        env: Set(serde_json::json!(action.environment_variables.clone())),
        execution_details: Set(action.execution_details.clone()),
        cron_expr: Set(action.cron_expr.clone()),
        created_at: Set(action.created_at),
        last_modified_at: Set(action.last_modified_at.clone()),
        last_executed_at: Set(action.last_executed_at.clone()),
        last_successful_at: Set(action.last_successful_at.clone()),
        description: Set(action.description.clone()),
        file_name: Set(action.zip_file_name.clone()),
        created_by: Set(action.created_by.clone()),
        status: Set(action.status.clone()),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}
pub async fn contains(id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

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
