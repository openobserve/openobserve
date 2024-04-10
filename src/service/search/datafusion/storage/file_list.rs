// Copyright 2024 Zinc Labs Inc.
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
use config::meta::stream::FileKey;
use hashbrown::HashMap;
use object_store::ObjectMeta;
use once_cell::sync::Lazy;
use parking_lot::RwLock;

pub static FILES: Lazy<RwLock<HashMap<String, Vec<ObjectMeta>>>> = Lazy::new(Default::default);

pub fn get(trace_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.read().get(trace_id) {
        Some(data) => data.clone(),
        None => return Err(anyhow::anyhow!("trace_id not found")),
    };
    Ok(data)
}

pub async fn set(trace_id: &str, files: &[FileKey]) {
    let mut values = Vec::with_capacity(files.len());
    for file in files {
        let modified = Utc.timestamp_nanos(file.meta.max_ts * 1000);
        let file_name = format!("/{}/$$/{}", trace_id, file.key);
        values.push(ObjectMeta {
            location: file_name.into(),
            last_modified: modified,
            size: file.meta.compressed_size as usize,
            e_tag: None,
            version: None,
        });
    }
    FILES.write().insert(trace_id.to_string(), values);
}

pub fn clear(trace_id: &str) {
    let r = FILES.read();
    let keys = r
        .keys()
        .filter(|x| x.starts_with(trace_id))
        .cloned()
        .collect::<Vec<_>>();
    drop(r);
    let mut w = FILES.write();
    for key in keys {
        w.remove(&key);
    }
    w.shrink_to_fit();
}
