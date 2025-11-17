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

use chrono::{TimeZone, Utc};
use config::meta::{bitvec::BitVec, stream::FileKey};
use object_store::ObjectMeta;
use once_cell::sync::Lazy;
use scc::HashMap;

use super::{ACCOUNT_SEPARATOR, TRACE_ID_SEPARATOR};

type SegmentData = hashbrown::HashMap<String, BitVec>;

static FILES: Lazy<HashMap<String, Vec<ObjectMeta>>> = Lazy::new(Default::default);
static SEGMENTS: Lazy<HashMap<String, SegmentData>> = Lazy::new(Default::default);

pub fn get(trace_id: &str) -> Result<Vec<ObjectMeta>, anyhow::Error> {
    let data = match FILES.read_sync(trace_id, |_, v| v.clone()) {
        Some(data) => data.clone(),
        None => return Err(anyhow::anyhow!("trace_id not found: {}", trace_id)),
    };
    Ok(data)
}

pub async fn set(trace_id: &str, schema_key: &str, files: &[FileKey]) {
    let key = format!("{trace_id}/schema={schema_key}");
    let mut values = Vec::with_capacity(files.len());
    let mut segment_data = hashbrown::HashMap::new();
    for file in files {
        let modified = Utc.timestamp_nanos(file.meta.max_ts * 1000);
        let file_name = if file.account.is_empty() {
            format!("/{}/{}/{}", key, TRACE_ID_SEPARATOR, file.key)
        } else {
            format!(
                "/{}/{}/{}/{}/{}",
                key, TRACE_ID_SEPARATOR, file.account, ACCOUNT_SEPARATOR, file.key
            )
        };
        values.push(ObjectMeta {
            location: file_name.into(),
            last_modified: modified,
            size: file.meta.compressed_size as u64,
            e_tag: None,
            version: None,
        });
        if let Some(bin_data) = file.segment_ids.as_ref() {
            segment_data.insert(file.key.clone(), bin_data.clone());
        }
    }
    let _ = FILES.insert_async(key.clone(), values).await;
    let _ = SEGMENTS.insert_async(key, segment_data).await;
}

pub fn clear(trace_id: &str) {
    // Remove all files for the given trace_id
    FILES.retain_sync(|k, _| {
        if k.starts_with(trace_id) {
            SEGMENTS.remove_sync(k);
            false
        } else {
            true
        }
    });
}

pub fn get_segment_ids(file_key: &str) -> Option<BitVec> {
    let (trace_id, filename) = file_key.split_once("/$$/")?;
    SEGMENTS
        .get_sync(trace_id)
        .and_then(|entry| entry.get().get(filename).cloned())
}
