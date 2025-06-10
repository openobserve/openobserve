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

use config::meta::ai::SystemPrompt;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Schema, Set, Unchanged,
};

use super::{entity::system_prompts::Model, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
    table::entity::system_prompts::{ActiveModel, Column, Entity},
};

impl TryFrom<Model> for SystemPrompt {
    type Error = errors::Error;

    fn try_from(model: Model) -> Result<Self, Self::Error> {
        Ok(SystemPrompt {
            id: model.id,
            name: model.name,
            content: model.content,
            version: model.version,
            created_at: model.created_at,
            updated_at: model.updated_at,
            is_active: model.is_active,
            tags: serde_json::from_value(model.tags.clone())?,
        })
    }
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

pub async fn add(prompt: &SystemPrompt) -> Result<String, errors::Error> {
    let record = ActiveModel {
        id: Set(prompt.id.clone()),
        name: Set(prompt.name.clone()),
        content: Set(prompt.content.clone()),
        version: Set(prompt.version),
        created_at: Set(prompt.created_at),
        updated_at: Set(prompt.updated_at),
        is_active: Set(prompt.is_active),
        tags: Set(prompt.tags.clone().into()),
    };
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let uuid = Entity::insert(record).exec(client).await?.last_insert_id;

    Ok(uuid)
}

pub async fn update(prompt: &SystemPrompt) -> Result<String, errors::Error> {
    let id = prompt.id.clone();
    let record = ActiveModel {
        id: Unchanged(id),
        name: Set(prompt.name.clone()),
        content: Set(prompt.content.clone()),
        version: Set(prompt.version),
        created_at: Set(prompt.created_at),
        updated_at: Set(prompt.updated_at),
        is_active: Set(prompt.is_active),
        tags: Set(prompt.tags.clone().into()),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let prompt = Entity::update(record).exec(client).await?;

    Ok(prompt.id)
}
pub async fn remove(_org_id: &str, id: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _ = Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get(id: &str, _org_id: &str) -> Result<SystemPrompt, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find_by_id(id).one(client).await?.ok_or_else(|| {
        Error::DbError(DbError::SeaORMError("System Prompt not found".to_string()))
    })?;

    record.try_into()
}

pub async fn list(_org_id: &str, limit: Option<i64>) -> Result<Vec<SystemPrompt>, errors::Error> {
    let limit = limit.unwrap_or(100);
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .limit(limit as u64)
        .order_by(Column::Id, Order::Desc);

    let records = res
        .all(client)
        .await?
        .into_iter()
        .map(SystemPrompt::try_from)
        .collect::<Result<_, errors::Error>>()?;

    Ok(records)
}

pub async fn contains(id: &str, _org_id: &str) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find().filter(Column::Id.eq(id)).one(client).await?;

    Ok(record.is_some())
}

pub async fn len() -> Result<usize, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let len = Entity::find().count(client).await?;
    Ok(len as usize)
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

pub async fn is_empty() -> Result<bool, errors::Error> {
    Ok(len().await? == 0)
}
