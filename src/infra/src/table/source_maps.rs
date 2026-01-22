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

use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr, TransactionTrait};
use serde::{Deserialize, Serialize};

use super::{entity::source_maps::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Clone, Serialize, Deserialize)]
pub enum FileType {
    SourceMap,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SourceMap {
    pub id: i32,
    pub org: String,
    pub service: Option<String>,
    pub env: Option<String>,
    pub version: Option<String>,
    pub source_file_name: String,
    pub source_map_file_name: String,
    pub file_store_id: String,
    pub file_type: FileType,
    pub created_at: i64,
    pub is_local: bool,
}

impl From<Model> for SourceMap {
    fn from(value: Model) -> Self {
        Self {
            id: value.id,
            org: value.org,
            service: value.service,
            env: value.env,
            version: value.version,
            source_file_name: value.source_file_name,
            source_map_file_name: value.source_map_file_name,
            file_store_id: value.file_store_id,
            file_type: value.file_type.into(),
            is_local: value.is_local,
            created_at: value.created_at,
        }
    }
}

impl Into<i32> for FileType {
    fn into(self) -> i32 {
        match self {
            Self::SourceMap => 0,
        }
    }
}

impl From<i32> for FileType {
    fn from(value: i32) -> Self {
        match value {
            0 => Self::SourceMap,
            _ => Self::SourceMap,
        }
    }
}

pub async fn add_many(entries: Vec<SourceMap>) -> Result<(), errors::Error> {
    let models = entries
        .into_iter()
        .map(|entry| ActiveModel {
            org: Set(entry.org),
            service: Set(entry.service),
            env: Set(entry.env),
            version: Set(entry.version),
            source_file_name: Set(entry.source_file_name),
            source_map_file_name: Set(entry.source_map_file_name),
            file_store_id: Set(entry.file_store_id),
            file_type: Set(entry.file_type.into()),
            is_local: Set(entry.is_local),
            created_at: Set(entry.created_at),
            ..Default::default()
        })
        .collect::<Vec<_>>();

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let txn = client.begin().await?;

    for model in models {
        match Entity::insert(model).exec(&txn).await {
            Ok(_) => {}
            Err(e) => {
                txn.rollback().await?;
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
    }
    txn.commit().await?;

    Ok(())
}

pub async fn delete_group(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let mut stmt = Entity::delete_many().filter(Column::Org.eq(org));

    if let Some(s) = service {
        stmt = stmt.filter(Column::Service.eq(s));
    } else {
        stmt = stmt.filter(Column::Service.is_null());
    }

    if let Some(e) = env {
        stmt = stmt.filter(Column::Env.eq(e));
    } else {
        stmt = stmt.filter(Column::Env.is_null());
    }

    if let Some(v) = version {
        stmt = stmt.filter(Column::Version.eq(v));
    } else {
        stmt = stmt.filter(Column::Version.is_null());
    }

    stmt.exec(client).await?;
    Ok(())
}

pub async fn get_sourcemap_file_name(
    org: &str,
    source_file: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Option<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let mut stmt = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::SourceFileName.eq(source_file));

    if let Some(s) = service {
        stmt = stmt.filter(Column::Service.eq(s));
    }

    if let Some(e) = env {
        stmt = stmt.filter(Column::Env.eq(e));
    }

    if let Some(v) = version {
        stmt = stmt.filter(Column::Version.eq(v));
    }

    let res = stmt.one(client).await?.map(|model| model.file_store_id);
    Ok(res)
}

pub async fn list_files(
    org: &str,
    service: Option<String>,
    env: Option<String>,
    version: Option<String>,
) -> Result<Vec<SourceMap>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let _lock = get_lock().await;

    let mut stmt = Entity::find().filter(Column::Org.eq(org));

    if let Some(s) = service {
        stmt = stmt.filter(Column::Service.eq(s));
    }

    if let Some(e) = env {
        stmt = stmt.filter(Column::Env.eq(e));
    }

    if let Some(v) = version {
        stmt = stmt.filter(Column::Version.eq(v));
    }

    let res = stmt
        .all(client)
        .await?
        .into_iter()
        .map(|model| model.into())
        .collect();
    Ok(res)
}
