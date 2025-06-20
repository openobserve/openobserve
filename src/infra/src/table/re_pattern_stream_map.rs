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
use sea_orm::{ColumnTrait, DbErr, EntityTrait, QueryFilter, Set, SqlErr, TransactionTrait};
use serde::{Deserialize, Serialize};

use super::{entity::re_pattern_stream_map::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PatternPolicy {
    DropField,
    Redact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatternAssociationEntry {
    pub id: i64,
    pub org: String,
    pub stream: String,
    pub stream_type: StreamType,
    pub field: String,
    pub pattern_id: String,
    pub policy: PatternPolicy,
    pub apply_at_search: bool,
}

// TODO @YJDoc2 : check if we can user AsRef<&str> or something here

impl From<String> for PatternPolicy {
    fn from(value: String) -> Self {
        match value.as_str() {
            "DropField" => Self::DropField,
            "Redact" => Self::Redact,
            _ => Self::Redact,
        }
    }
}

impl From<&String> for PatternPolicy {
    fn from(value: &String) -> Self {
        match value.as_str() {
            "DropField" => Self::DropField,
            "Redact" => Self::Redact,
            _ => Self::Redact,
        }
    }
}

impl std::fmt::Display for PatternPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DropField => write!(f, "DropField"),
            Self::Redact => write!(f, "Redact"),
        }
    }
}

impl From<Model> for PatternAssociationEntry {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            org: value.org,
            stream: value.stream,
            stream_type: StreamType::from(value.stream_type),
            field: value.field,
            pattern_id: value.pattern_id,
            policy: PatternPolicy::from(value.policy),
            apply_at_search: value.apply_at_search,
        }
    }
}

pub async fn add(entry: PatternAssociationEntry) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(entry.org),
        stream: Set(entry.stream),
        stream_type: Set(entry.stream_type.to_string()),
        field: Set(entry.field),
        pattern_id: Set(entry.pattern_id),
        policy: Set(entry.policy.to_string()),
        apply_at_search: Set(entry.apply_at_search),
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

pub async fn batch_process(
    added: Vec<PatternAssociationEntry>,
    removed: Vec<PatternAssociationEntry>,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;
    let txn = client.begin().await?;

    // we MUST first remove the entries and then add. This is because
    // the way associations are currently impl in stream settings,
    // for updated to policy etc, we get the old item in removed
    // and same item with the updated fields in added array. For this to work
    // properly, we similarly need to remove the old items first, then add new ones
    for r in removed {
        match Entity::delete_many()
            .filter(Column::Org.eq(r.org))
            .filter(Column::Stream.eq(r.stream))
            .filter(Column::StreamType.eq(r.stream_type.to_string()))
            .filter(Column::Field.eq(r.field))
            .filter(Column::PatternId.eq(r.pattern_id))
            .exec(&txn)
            .await
        {
            Ok(_) | Err(DbErr::RecordNotFound(_)) => {}
            Err(e) => {
                txn.rollback().await?;
                return Err(e.into());
            }
        }
    }

    if !added.is_empty() {
        let models = added.into_iter().map(|a| ActiveModel {
            org: Set(a.org),
            stream: Set(a.stream),
            stream_type: Set(a.stream_type.to_string()),
            field: Set(a.field),
            pattern_id: Set(a.pattern_id),
            policy: Set(a.policy.to_string()),
            apply_at_search: Set(a.apply_at_search),
            ..Default::default()
        });

        match Entity::insert_many(models).exec(&txn).await {
            Ok(_) => {}
            Err(e) => {
                txn.rollback().await?;
                return Err(e.into());
            }
        }
    }
    txn.commit().await?;
    Ok(())
}

pub async fn get_by_pattern_id(
    pattern_id: &str,
) -> Result<Vec<PatternAssociationEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let res = Entity::find()
        .filter(Column::PatternId.eq(pattern_id))
        .into_model::<Model>()
        .all(client)
        .await?;
    let ret = res
        .into_iter()
        .map(<Model as Into<PatternAssociationEntry>>::into)
        .collect::<Vec<_>>();
    Ok(ret)
}

pub async fn list_all() -> Result<Vec<PatternAssociationEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find().into_model::<Model>().all(client).await?;

    let records = records
        .into_iter()
        .map(<Model as Into<PatternAssociationEntry>>::into)
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
