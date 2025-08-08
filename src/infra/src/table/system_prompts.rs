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

use config::meta::ai::{AIPrompt, PromptType};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Schema, Set,
};

use super::{entity::system_prompts::Model, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::entity::system_prompts::{ActiveModel, Column, Entity},
};

impl TryFrom<Model> for AIPrompt {
    type Error = errors::Error;

    fn try_from(model: Model) -> Result<Self, Self::Error> {
        Ok(AIPrompt {
            r#type: model.r#type.as_str().into(),
            content: model.content,
            updated_at: model.updated_at,
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

pub async fn add(prompt: &AIPrompt) -> Result<(), errors::Error> {
    let record = ActiveModel {
        r#type: Set(prompt.r#type.to_string()),
        content: Set(prompt.content.clone()),
        updated_at: Set(prompt.updated_at),
    };
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::insert(record).exec(client).await?;

    Ok(())
}

pub async fn update(prompt: &AIPrompt) -> Result<(), errors::Error> {
    let record = ActiveModel {
        r#type: Set(prompt.r#type.to_string()),
        content: Set(prompt.content.clone()),
        updated_at: Set(prompt.updated_at),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;

    Ok(())
}
pub async fn remove(_org_id: &str, r#type: PromptType) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _ = Entity::delete_many()
        .filter(Column::Type.eq(r#type.to_string()))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get(r#type: PromptType) -> Result<Option<AIPrompt>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::Type.eq(r#type.to_string()))
        .one(client)
        .await?
        .map(AIPrompt::try_from)
        .transpose()?;

    Ok(record)
}

/// Returns the system prompt and the user prompt.
///
/// If the user prompt is not found, it returns None
pub async fn get_all() -> Result<(Option<AIPrompt>, Option<AIPrompt>), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        // This limit doesn't matter much, but still
        .limit(2)
        .order_by(Column::Type, Order::Asc);

    let records = res
        .all(client)
        .await?
        .into_iter()
        .map(AIPrompt::try_from)
        .collect::<Result<Vec<AIPrompt>, errors::Error>>()?;

    let user_prompt = records
        .iter()
        .find(|p| p.r#type == PromptType::User)
        .cloned();
    let system_prompt = records.into_iter().find(|p| p.r#type == PromptType::System);

    Ok((system_prompt, user_prompt))
}

pub async fn exists(r#type: PromptType) -> Result<bool, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let record = Entity::find()
        .filter(Column::Type.eq(r#type.to_string()))
        .one(client)
        .await?;

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
