// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap;
use bytes::{BufMut, BytesMut};
use datafusion::arrow::datatypes::Schema;

use crate::common;
use crate::common::infra::config::CONFIG;
use crate::common::infra::wal::get_or_create;
use crate::common::meta::prom::{Metadata, METADATA_LABEL};
use crate::common::meta::StreamType;

pub mod json;
pub mod prom;

pub fn get_prom_metadata_from_schema(schema: &Schema) -> Option<Metadata> {
    let metadata = schema.metadata.get(METADATA_LABEL)?;
    let metadata: Metadata = common::json::from_str(metadata).unwrap();
    Some(metadata)
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Hash)]
pub struct Signature([u8; 32]);

impl From<Signature> for String {
    fn from(sig: Signature) -> Self {
        hex::encode(sig.0)
    }
}

/// `signature_without_labels` is just as [`signature`], but only for labels not matching `names`.
// REFACTORME: make this a method of `Metric`
pub fn signature_without_labels(
    labels: &common::json::Map<String, common::json::Value>,
    exclude_names: &[&str],
) -> Signature {
    let mut labels: Vec<(&str, &str)> = labels
        .iter()
        .filter(|(key, _value)| !exclude_names.contains(&key.as_str()))
        .map(|(key, value)| (key.as_str(), value.as_str().unwrap()))
        .collect();
    labels.sort_by(|a, b| a.0.cmp(b.0));

    let mut hasher = blake3::Hasher::new();
    labels.iter().for_each(|(key, value)| {
        hasher.update(key.as_bytes());
        hasher.update(value.as_bytes());
    });
    Signature(hasher.finalize().into())
}
pub fn write_series_file(
    buf: AHashMap<String, Vec<String>>,
    thread_id: usize,
    org_id: &str,
    stream_name: &str,
    stream_file_name: &mut String,
    stream_type: StreamType,
) {
    let mut write_buf = BytesMut::new();
    let file = get_or_create(
        thread_id,
        org_id,
        stream_name,
        stream_type,
        "series",
        CONFIG.common.wal_memory_mode_enabled,
    );
    for (_, entry) in buf {
        if entry.is_empty() {
            continue;
        }
        write_buf.clear();
        for row in &entry {
            write_buf.put(row.as_bytes());
            write_buf.put("\n".as_bytes());
        }

        if stream_file_name.is_empty() {
            *stream_file_name = file.full_name();
        }
        file.write(write_buf.as_ref());
    }
}
