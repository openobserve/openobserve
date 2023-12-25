// Copyright 2023 Zinc Labs Inc.
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

use chrono::{TimeZone, Utc};
use config::RwHashMap;
use object_store::ObjectMeta;
use once_cell::sync::Lazy;

use crate::common::meta::common::FileKey;

pub static FILES: Lazy<RwHashMap<String, Vec<ObjectMeta>>> = Lazy::new(Default::default);

pub fn get(session_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.get(session_id) {
        Some(data) => data,
        None => return Err(anyhow::anyhow!("session_id not found")),
    };
    Ok(data.value().clone())
}

pub async fn set(session_id: &str, files: &[FileKey]) {
    let mut values = Vec::with_capacity(files.len());
    for file in files {
        let modified = Utc.timestamp_nanos(file.meta.max_ts * 1000);
        let file_name = format!("/{}/$$/{}", session_id, file.key);
        values.push(ObjectMeta {
            location: file_name.into(),
            last_modified: modified,
            size: file.meta.compressed_size as usize,
            e_tag: None,
            version: None,
        });
    }
    FILES.insert(session_id.to_string(), values);
}

pub fn clear(session_id: &str) {
    let keys = FILES
        .iter()
        .filter(|x| x.key().starts_with(session_id))
        .map(|x| x.key().clone())
        .collect::<Vec<_>>();
    for key in keys {
        FILES.remove(&key);
    }
}
