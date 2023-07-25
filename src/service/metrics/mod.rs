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
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;

use crate::common;
use crate::common::infra::{config::CONFIG, wal::get_or_create};
use crate::common::meta::{
    prom::{Metadata, METADATA_LABEL, SERIES_NAME},
    stream::PartitionTimeLevel,
    StreamType,
};

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

pub fn write_series_file(buf: AHashMap<String, Vec<String>>, thread_id: usize, org_id: &str) {
    let timestamp = Utc::now().timestamp_micros();
    let local_val: common::json::Map<String, common::json::Value> = common::json::Map::new();
    let hour_key = super::ingestion::get_wal_time_key(
        timestamp,
        PartitionTimeLevel::Daily,
        &vec![],
        &local_val,
        Some(SERIES_NAME),
    );
    let mut write_buf = BytesMut::new();
    let file = get_or_create(
        thread_id,
        org_id,
        SERIES_NAME,
        StreamType::Metrics,
        &hour_key,
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
        file.write(write_buf.as_ref());
    }
}

fn get_date_with_midnight_hour() -> i64 {
    let date = Utc::now().date_naive();
    let midnight = Utc.with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0);
    midnight.unwrap().timestamp_micros()
}
