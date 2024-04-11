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

use std::sync::Arc;

use arrow_schema::Field;
use config::{
    meta::stream::{PartitionTimeLevel, StreamStats, StreamType},
    utils::{
        hash::{gxhash, Sum64},
        json,
    },
    CONFIG,
};
use datafusion::arrow::datatypes::Schema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::prom::Metadata;
use crate::common::meta::alerts::Condition;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Stream {
    pub name: String,
    pub storage_type: String,
    pub stream_type: StreamType,
    pub stats: StreamStats,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub schema: Vec<StreamProperty>,
    pub settings: StreamSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_meta: Option<Metadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct StreamProperty {
    pub name: String,
    #[serde(rename = "type")]
    pub prop_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamQueryParams {
    #[serde(rename = "type")]
    pub stream_type: Option<StreamType>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamSchema {
    pub stream_name: String,
    pub stream_type: StreamType,
    pub schema: Schema,
}

#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct StreamSettings {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub partition_keys: Vec<StreamPartition>,
    #[serde(skip_serializing_if = "Option::None")]
    pub partition_time_level: Option<PartitionTimeLevel>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub full_text_search_keys: Vec<String>,
    #[serde(default)]
    pub bloom_filter_fields: Vec<String>,
    #[serde(default)]
    pub data_retention: i64,
    #[serde(skip_serializing_if = "Hashmap::is_empty")]
    #[serde(default)]
    pub routing: HashMap<String, Vec<Condition>>,
    #[serde(default)]
    pub disable_schema_evolution: bool,
    #[serde(default = "default_flatten_level")]
    pub flatten_level: i32,
}

fn default_flatten_level() -> i32 {
    CONFIG.limit.ingest_flatten_level
}

impl Serialize for StreamSettings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("stream_settings", 4)?;
        let mut part_keys = HashMap::new();
        for (index, key) in self.partition_keys.iter().enumerate() {
            part_keys.insert(format!("L{index}"), key);
        }
        state.serialize_field("partition_keys", &part_keys)?;
        state.serialize_field(
            "partition_time_level",
            &self.partition_time_level.unwrap_or_default(),
        )?;
        state.serialize_field("full_text_search_keys", &self.full_text_search_keys)?;
        state.serialize_field("bloom_filter_fields", &self.bloom_filter_fields)?;
        state.serialize_field("data_retention", &self.data_retention)?;
        state.serialize_field("log_routing", &self.routing)?;
        state.end()
    }
}

impl From<&str> for StreamSettings {
    fn from(data: &str) -> Self {
        let settings: json::Value = json::from_slice(data.as_bytes()).unwrap();

        let mut partition_keys = Vec::new();
        if let Some(value) = settings.get("partition_keys") {
            let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
            v.sort_by(|a, b| a.0.cmp(b.0));
            for (_, value) in v.iter() {
                match value {
                    json::Value::String(v) => {
                        partition_keys.push(StreamPartition::new(v));
                    }
                    json::Value::Object(v) => {
                        let val: StreamPartition =
                            json::from_value(json::Value::Object(v.to_owned())).unwrap();
                        partition_keys.push(val);
                    }
                    _ => {}
                }
            }
        }

        let mut partition_time_level = None;
        if let Some(value) = settings.get("partition_time_level") {
            partition_time_level = Some(PartitionTimeLevel::from(value.as_str().unwrap()));
        }

        let mut full_text_search_keys = Vec::new();
        let fts = settings.get("full_text_search_keys");
        if let Some(value) = fts {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                full_text_search_keys.push(item.as_str().unwrap().to_string())
            }
        }

        let mut bloom_filter_fields = Vec::new();
        let fts = settings.get("bloom_filter_fields");
        if let Some(value) = fts {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                bloom_filter_fields.push(item.as_str().unwrap().to_string())
            }
        }

        let mut log_routing: HashMap<String, Vec<Condition>> = HashMap::new();
        let routing = settings.get("log_routing");
        if let Some(value) = routing {
            let v: Vec<_> = value.as_object().unwrap().iter().collect();
            for item in v {
                log_routing.insert(
                    item.0.to_string(),
                    json::from_value(item.1.clone()).unwrap(),
                );
            }
        }

        let mut data_retention = 0;
        if let Some(v) = settings.get("data_retention") {
            data_retention = v.as_i64().unwrap();
        };

        Self {
            partition_keys,
            partition_time_level,
            full_text_search_keys,
            bloom_filter_fields,
            data_retention,
            routing: log_routing,
            disable_schema_evolution: true,
            flatten_level: CONFIG.limit.ingest_flatten_level,
        }
    }
}

#[derive(Clone, Debug, Default, Hash, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StreamPartition {
    pub field: String,
    #[serde(default)]
    pub types: StreamPartitionType,
    #[serde(default)]
    pub disabled: bool,
}

impl StreamPartition {
    pub fn new(field: &str) -> Self {
        Self {
            field: field.to_string(),
            types: StreamPartitionType::Value,
            disabled: false,
        }
    }

    pub fn new_hash(field: &str, buckets: u64) -> Self {
        Self {
            field: field.to_string(),
            types: StreamPartitionType::Hash(std::cmp::max(16, buckets)),
            disabled: false,
        }
    }

    pub fn get_partition_key(&self, value: &str) -> String {
        format!("{}={}", self.field, self.get_partition_value(value))
    }

    pub fn get_partition_value(&self, value: &str) -> String {
        match &self.types {
            StreamPartitionType::Value => value.to_string(),
            StreamPartitionType::Hash(n) => {
                let h = gxhash::new().sum64(value);
                let bucket = h % n;
                bucket.to_string()
            }
        }
    }
}

#[derive(Clone, Debug, Default, Hash, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StreamPartitionType {
    #[default]
    Value, // each value is a partition
    Hash(u64), // partition with fixed bucket size by hash
}

impl Display for StreamPartitionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamPartitionType::Value => write!(f, "value"),
            StreamPartitionType::Hash(_) => write!(f, "hash"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ListStream {
    pub list: Vec<Stream>,
}

#[derive(Clone, Debug)]
pub struct StreamParams {
    pub org_id: faststr::FastStr,
    pub stream_name: faststr::FastStr,
    pub stream_type: StreamType,
}

impl StreamParams {
    pub fn new(org_id: &str, stream_name: &str, stream_type: StreamType) -> Self {
        Self {
            org_id: org_id.to_string().into(),
            stream_name: stream_name.to_string().into(),
            stream_type,
        }
    }
}

pub struct SchemaEvolution {
    pub schema_compatible: bool,
    pub is_schema_changed: bool,
    pub types_delta: Option<Vec<Field>>,
}

pub struct SchemaRecords {
    pub schema_key: String,
    pub schema: Arc<Schema>,
    pub records: Vec<Arc<json::Value>>,
    pub records_size: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StreamDeleteFields {
    pub fields: Vec<String>,
}

pub struct Routing {
    pub destination: String,
    pub routing: Vec<Condition>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stats() {
        let stats = StreamStats::default();
        let stats_str: String = stats.into();
        let stats_frm_str = StreamStats::from(stats_str.as_str());
        assert_eq!(stats, stats_frm_str);
    }

    #[test]
    fn test_stream_params() {
        let params = StreamParams::new("org_id", "stream_name", StreamType::Logs);
        assert_eq!(params.org_id, "org_id");
        assert_eq!(params.stream_name, "stream_name");
        assert_eq!(params.stream_type, StreamType::Logs);
    }
}
