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

use config::ider;
use sea_orm::{ActiveValue::Unchanged, ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr};
use serde::{Deserialize, Serialize};

use super::{entity::re_patterns::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PatternEntry {
    pub id: String,
    pub org: String,
    pub name: String,
    pub description: String,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pattern: String,
}

impl From<Model> for PatternEntry {
    fn from(val: Model) -> Self {
        PatternEntry {
            id: val.id,
            org: val.org,
            name: val.name,
            description: val.description,
            created_by: val.created_by,
            created_at: val.created_at,
            updated_at: val.updated_at,
            pattern: val.pattern,
        }
    }
}

impl PatternEntry {
    pub fn new(org: &str, name: &str, description: &str, pattern: &str, user: &str) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            id: ider::generate(),
            org: org.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            created_by: user.to_string(),
            created_at: now,
            updated_at: now,
            pattern: pattern.to_string(),
        }
    }
}

pub async fn add(entry: PatternEntry) -> Result<(), errors::Error> {
    let record = ActiveModel {
        id: Set(entry.id),
        org: Set(entry.org),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
        name: Set(entry.name),
        description: Set(entry.description),
        pattern: Set(entry.pattern),
    };

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => {
            drop(_lock);
            match e.sql_err() {
                Some(SqlErr::UniqueConstraintViolation(_)) => {
                    return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
                }
                _ => {
                    return Err(e.into());
                }
            }
        }
    }
    drop(_lock);

    Ok(())
}

pub async fn update_pattern(id: &str, new_pattern: &str) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let record = ActiveModel {
        id: Unchanged(id.to_string()),
        updated_at: Set(now),
        pattern: Set(new_pattern.to_string()),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record)
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;
    drop(_lock);

    Ok(())
}

pub async fn remove(id: &str) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many()
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;

    drop(_lock);

    Ok(())
}

pub async fn get(id: &str) -> Result<Option<PatternEntry>, errors::DbError> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::find()
        .filter(Column::Id.eq(id))
        .into_model::<Model>()
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))
        .map(|om| om.map(|m| m.into()))
}

pub async fn list_by_org(org: &str) -> Result<Vec<PatternEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let res = Entity::find()
        .filter(Column::Org.eq(org))
        .into_model::<Model>()
        .all(client)
        .await?;

    let ret = res
        .into_iter()
        .map(<Model as Into<PatternEntry>>::into)
        .collect::<Vec<_>>();
    Ok(ret)
}

pub async fn list_all() -> Result<Vec<PatternEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find().into_model::<Model>().all(client).await?;

    let records = records
        .into_iter()
        .map(<Model as Into<PatternEntry>>::into)
        .collect::<Vec<_>>();
    Ok(records)
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}
