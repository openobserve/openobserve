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

use chrono::Duration;
use datafusion::arrow::datatypes::Schema;
use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer};
use std::collections::HashMap;
use utoipa::ToSchema;

use crate::{common::json, infra::config::CONFIG, meta::StreamType};

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

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct StreamStats {
    pub doc_time_min: i64,
    pub doc_time_max: i64,
    pub doc_num: u64,
    pub file_num: u64,
    pub storage_size: f64,
    pub compressed_size: f64,
}

impl StreamStats {
    /// Returns true iff [start, end] time range intersects with the stream's time range.
    pub(crate) fn time_range_intersects(&self, start: i64, end: i64) -> bool {
        assert!(start <= end);
        let (min, max) = self.time_range();
        // [min, max] does *not* intersect with [start, end] if either
        //
        // max < start
        // |--------------------|         |--------------------|
        // min                  max       start                end
        //
        // or min >= end
        // |--------------------|         |--------------------|
        // start                end       min                  max
        //
        // The time ranges intersect iff !(max < start || min >= end)
        max >= start && min < end
    }

    fn time_range(&self) -> (i64, i64) {
        assert!(self.doc_time_min <= self.doc_time_max);
        let file_push_interval = Duration::seconds(CONFIG.limit.file_push_interval as _)
            .num_microseconds()
            .unwrap();
        (self.doc_time_min, self.doc_time_max + file_push_interval)
    }
}

impl From<&str> for StreamStats {
    fn from(data: &str) -> Self {
        json::from_str::<StreamStats>(data).unwrap()
    }
}

impl From<StreamStats> for Vec<u8> {
    fn from(value: StreamStats) -> Vec<u8> {
        json::to_vec(&value).unwrap()
    }
}

impl From<StreamStats> for String {
    fn from(data: StreamStats) -> Self {
        json::to_string(&data).unwrap()
    }
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
    #[serde(default)]
    pub schema_validation: bool,
}

impl Serialize for StreamSettings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("StreamSettings", 2)?;
        let mut part_keys = HashMap::new();
        for (index, key) in self.partition_keys.iter().enumerate() {
            part_keys.insert(format!("L{index}"), key.to_string());
        }
        state.serialize_field("partition_keys", &part_keys)?;
        state.serialize_field("full_text_search_keys", &self.full_text_search_keys)?;
        state.serialize_field("schema_validation", &self.schema_validation)?;
        state.end()
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
