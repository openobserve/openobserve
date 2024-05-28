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
    meta::stream::{StreamSettings, StreamStats, StreamType},
    utils::json,
};
use datafusion::arrow::datatypes::Schema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::prom::Metadata;

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
#[derive(Debug, Clone)]
pub struct SchemaRecords {
    pub record_id: usize,
    pub schema_key: String,
    pub schema: Arc<Schema>,
    pub records: Vec<Arc<json::Value>>,
    pub records_size: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StreamDeleteFields {
    pub fields: Vec<String>,
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
