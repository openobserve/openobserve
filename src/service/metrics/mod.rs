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

pub mod prom;

use crate::common;
use crate::meta;
use crate::meta::prom::Metadata;
use crate::service::db;

pub async fn get_prom_metadata(org_id: &str, metric_name: &str) -> Option<Metadata> {
    let schema = db::schema::get(org_id, metric_name, Some(meta::StreamType::Metrics)).await;
    if schema.is_err() {
        return None;
    }
    let schema = schema.unwrap();
    let metadata = schema.metadata.get("metadata")?;
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

// REFACTORME: make this a method of `Metric`
pub fn signature(labels: &AHashMap<String, String>) -> Signature {
    signature_without_labels(labels, &[])
}

/// `signature_without_labels` is just as [`signature`], but only for labels not matching `names`.
// REFACTORME: make this a method of `Metric`
pub fn signature_without_labels(
    labels: &AHashMap<String, String>,
    exclude_names: &[&str],
) -> Signature {
    let mut hasher = blake3::Hasher::new();
    labels
        .iter()
        .filter(|(key, _value)| !exclude_names.contains(&key.as_str()))
        .for_each(|(key, value)| {
            hasher.update(key.as_bytes());
            hasher.update(value.as_bytes());
        });
    Signature(hasher.finalize().into())
}
