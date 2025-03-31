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

use config::meta::stream::FileMeta;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set, SqlErr};
use serde::{Deserialize, Serialize};

use super::{entity::file_list_dump::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

// TODO(YJDoc2) : also add count of entries in a file as col in table?

// DBKey to set file_list_dump keys
pub const FILE_LIST_DUMP_PREFIX: &str = "/file_list_dump/";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileListDump {
    pub id: i32,
    pub org: String,
    pub stream: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub file: String,
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
}

impl FileListDump {
    pub fn file_meta(&self) -> FileMeta {
        FileMeta {
            min_ts: self.start_ts,
            max_ts: self.end_ts,
            records: self.records,
            original_size: self.original_size,
            compressed_size: self.compressed_size,
            index_size: 0,
            flattened: false,
        }
    }
}

impl Into<FileListDump> for Model {
    fn into(self) -> FileListDump {
        FileListDump {
            id: self.id,
            org: self.org,
            stream: self.stream,
            start_ts: self.start_ts,
            end_ts: self.end_ts,
            file: self.file,
            records: self.records,
            original_size: self.original_size,
            compressed_size: self.compressed_size,
        }
    }
}

pub async fn add_dump_file(entry: FileListDump) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(entry.org),
        stream: Set(entry.stream),
        start_ts: Set(entry.start_ts),
        end_ts: Set(entry.end_ts),
        file: Set(entry.file),
        records: Set(entry.records),
        original_size: Set(entry.original_size),
        compressed_size: Set(entry.compressed_size),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

pub async fn remove(org: &str, stream: &str, file: &str) -> Result<(), errors::Error> {
    let record = ActiveModel {
        org: Set(org.to_string()),
        stream: Set(stream.to_string()),
        file: Set(file.to_string()),
        ..Default::default()
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete(record).exec(client).await?;

    drop(_lock);

    Ok(())
}

pub async fn get(
    org: &str,
    stream: &str,
    file: &str,
) -> Result<Option<FileListDump>, errors::DbError> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let entity = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::File.eq(file))
        .into_model::<Model>()
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;
    Ok(entity.map(|s| s.into()))
}

pub async fn get_all_in_range(
    org: &str,
    stream: &str,
    min_ts: i64,
    max_ts: i64,
) -> Result<Vec<FileListDump>, errors::DbError> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let entities = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StartTs.lte(max_ts))
        .filter(Column::EndTs.gte(min_ts))
        .into_model::<Model>()
        .all(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;

    Ok(entities.into_iter().map(|e| e.into()).collect())
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}
