use datafusion::arrow::datatypes::Schema;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};
use std::collections::HashMap;
use utoipa::ToSchema;

use super::StreamType;
use crate::common::json;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Stream {
    pub name: String,
    pub storage_type: String,
    pub stream_type: StreamType,
    pub stats: StreamStats,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub schema: Vec<StreamProperty>,
    pub settings: StreamSettings,
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

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StreamStats {
    pub doc_time_min: i64,
    pub doc_time_max: i64,
    pub doc_num: u64,
    pub file_num: u64,
    pub storage_size: f64,
    pub compressed_size: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamSchema {
    pub stream_name: String,
    pub stream_type: StreamType,
    pub schema: Schema,
}

#[derive(Clone, Debug, Deserialize, ToSchema)]
pub struct StreamSettings {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub partition_keys: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(default)]
    pub full_text_search_keys: Vec<String>,
}

impl Serialize for StreamSettings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("StreamSettings", 2)?;
        let mut part_keys = HashMap::new();
        for (index, key) in self.partition_keys.iter().enumerate() {
            part_keys.insert(format!("L{}", index), key.to_string());
        }
        state.serialize_field("partition_keys", &part_keys)?;
        state.serialize_field("full_text_search_keys", &self.full_text_search_keys)?;
        state.end()
    }
}

impl Default for StreamStats {
    fn default() -> Self {
        Self {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0.0,
            compressed_size: 0.0,
        }
    }
}

impl From<&str> for StreamStats {
    fn from(data: &str) -> Self {
        json::from_str::<StreamStats>(data).unwrap()
    }
}

impl From<StreamStats> for Vec<u8> {
    fn from(value: StreamStats) -> Vec<u8> {
        serde_json::to_vec(&value).unwrap()
    }
}

impl From<StreamStats> for String {
    fn from(data: StreamStats) -> Self {
        json::to_string(&data).unwrap()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ListStream {
    pub list: Vec<Stream>,
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_stats() {
        let stats = StreamStats::default();
        let stats_str: String = stats.try_into().unwrap();
        let stats_frm_str = StreamStats::from(stats_str.as_str());
        assert_eq!(stats, stats_frm_str);
    }
}
