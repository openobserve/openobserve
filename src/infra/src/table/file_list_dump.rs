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
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};

use super::{entity::file_list_dump::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

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

pub async fn delete_all_for_stream(org: &str, stream: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .exec(client)
        .await?;
    Ok(())
}

pub async fn delete_in_time_range(
    org: &str,
    stream: &str,
    range: (i64, i64),
) -> Result<(), errors::Error> {
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Stream.eq(stream))
        .filter(Column::StartTs.gte(range.0))
        .filter(Column::EndTs.lte(range.1))
        .exec(client)
        .await?;
    Ok(())
}
