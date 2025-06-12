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

use config::meta::stream::StreamType;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr};
use serde::{Deserialize, Serialize};

use super::{entity::re_pattern_stream_map::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Clone, Copy, Serialize, Deserialize)]
pub enum PatternPolicy {
    DropField,
    Redact,
}

impl TryFrom<String> for PatternPolicy {
    type Error = errors::Error;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "drop_field" => Ok(Self::DropField),
            "redact" => Ok(Self::Redact),
            _ => Err(errors::Error::Message(format!(
                "invalid pattern policy '{value}' in db"
            ))),
        }
    }
}

impl std::fmt::Display for PatternPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DropField => write!(f, "drop_field"),
            Self::Redact => write!(f, "redact"),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PatternStreamMap {
    pub id: i64,
    pub org: String,
    pub stream: String,
    pub stream_type: StreamType,
    pub field: String,
    pub pattern_id: String,
    pub policy: PatternPolicy,
}

impl TryInto<PatternStreamMap> for Model {
    type Error = errors::Error;
    fn try_into(self) -> Result<PatternStreamMap, Self::Error> {
        Ok(PatternStreamMap {
            id: self.id,
            org: self.org,
            stream: self.stream,
            stream_type: StreamType::from(self.stream_type),
            field: self.field,
            pattern_id: self.pattern_id,
            policy: PatternPolicy::try_from(self.policy)?,
        })
    }
}

pub async fn add(entry: PatternStreamMap) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(entry.org),
        stream: Set(entry.stream),
        stream_type: Set(entry.stream_type.to_string()),
        field: Set(entry.field),
        pattern_id: Set(entry.pattern_id),
        policy: Set(entry.policy.to_string()),
        ..Default::default()
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

pub async fn remove(
    org: &str,
    stream: &str,
    stype: StreamType,
    field: &str,
    pattern_id: &str,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StreamType.eq(stype.to_string()))
        .filter(Column::Field.eq(field))
        .filter(Column::PatternId.eq(pattern_id))
        .filter(Column::Id.eq(pattern_id))
        .exec(client)
        .await?;

    drop(_lock);

    Ok(())
}

pub async fn get_by_pattern_id(pattern_id: &str) -> Result<Vec<PatternStreamMap>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::PatternId.eq(pattern_id))
        .into_model::<Model>()
        .all(client)
        .await?;
    let ret = res
        .into_iter()
        .map(<Model as TryInto<PatternStreamMap>>::try_into)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ret)
}

pub async fn list_all() -> Result<Vec<PatternStreamMap>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find().into_model::<Model>().all(client).await?;

    let records = records
        .into_iter()
        .map(<Model as TryInto<PatternStreamMap>>::try_into)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}
