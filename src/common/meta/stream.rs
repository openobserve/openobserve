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

use std::sync::Arc;

use arrow_schema::Field;
use config::{
    meta::{
        promql::Metadata,
        stream::{PatternAssociation, StreamField, StreamSettings, StreamStats, StreamType},
    },
    utils::json,
};
use datafusion::arrow::datatypes::Schema;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Stream {
    pub name: String,
    pub storage_type: String,
    pub stream_type: StreamType,
    pub stats: StreamStats,
    pub schema: Vec<StreamField>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub uds_schema: Vec<StreamField>,
    pub settings: StreamSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_meta: Option<Metadata>,
    pub total_fields: usize,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub pattern_associations: Vec<PatternAssociation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_derived: Option<bool>,
}

#[cfg(feature = "enterprise")]
impl From<Stream> for enterprise::recommendations::meta::Stream {
    fn from(value: Stream) -> Self {
        Self {
            name: value.name,
            stream_type: value.stream_type,
            stats: value.stats,
            settings: value.settings,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct StreamCreate {
    pub fields: Vec<StreamField>,
    pub settings: StreamSettings,
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
    pub total: usize,
}

pub struct SchemaEvolution {
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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct FieldUpdate {
    /// Field name to update
    pub name: String,
    /// Target data type (e.g., Utf8, LargeUtf8, Int64, Float64)
    pub data_type: String,
    /// Optionally set nullability; defaults to existing field nullability if not provided
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct StreamUpdateFields {
    /// List of field updates, each with name, target data_type, and optional nullability
    pub fields: Vec<FieldUpdate>,
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{StreamSettings, StreamType};

    use super::*;

    #[test]
    fn test_stats() {
        let stats = StreamStats::default();
        let stats_str: String = stats.clone().into();
        let stats_frm_str = StreamStats::from(stats_str.as_str());
        assert_eq!(stats, stats_frm_str);
    }

    #[test]
    fn test_stream_field() {
        let field = StreamField {
            name: "test_field".to_string(),
            r#type: "string".to_string(),
        };

        assert_eq!(field.name, "test_field");
        assert_eq!(field.r#type, "string");
    }

    #[test]
    fn test_stream_query_params() {
        let params = StreamQueryParams {
            stream_type: Some(StreamType::Logs),
        };

        assert_eq!(params.stream_type, Some(StreamType::Logs));
    }

    #[test]
    fn test_stream_schema() {
        let schema = Schema::new(vec![
            Field::new("field1", arrow_schema::DataType::Utf8, false),
            Field::new("field2", arrow_schema::DataType::Int64, true),
        ]);

        let stream_schema = StreamSchema {
            stream_name: "test_stream".to_string(),
            stream_type: StreamType::Logs,
            schema,
        };

        assert_eq!(stream_schema.stream_name, "test_stream");
        assert_eq!(stream_schema.stream_type, StreamType::Logs);
        assert_eq!(stream_schema.schema.fields().len(), 2);
    }

    #[test]
    fn test_list_stream() {
        let stream = Stream {
            name: "test_stream".to_string(),
            storage_type: "local".to_string(),
            stream_type: StreamType::Logs,
            stats: StreamStats::default(),
            schema: vec![StreamField {
                name: "field1".to_string(),
                r#type: "string".to_string(),
            }],
            uds_schema: vec![],
            settings: StreamSettings::default(),
            metrics_meta: None,
            total_fields: 1,
            pattern_associations: vec![],
            is_derived: None,
        };

        let list_stream = ListStream {
            list: vec![stream],
            total: 1,
        };

        assert_eq!(list_stream.total, 1);
        assert_eq!(list_stream.list.len(), 1);
        assert_eq!(list_stream.list[0].name, "test_stream");
    }

    #[test]
    fn test_schema_evolution() {
        let evolution = SchemaEvolution {
            is_schema_changed: true,
            types_delta: Some(vec![Field::new(
                "new_field",
                arrow_schema::DataType::Utf8,
                false,
            )]),
        };

        assert!(evolution.is_schema_changed);
        assert!(evolution.types_delta.is_some());
        assert_eq!(evolution.types_delta.unwrap().len(), 1);
    }

    #[test]
    fn test_schema_records() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "field1",
            arrow_schema::DataType::Utf8,
            false,
        )]));

        let records = vec![Arc::new(json::json!({
            "field1": "value1"
        }))];

        let schema_records = SchemaRecords {
            schema_key: "test_key".to_string(),
            schema: schema.clone(),
            records: records.clone(),
            records_size: 1,
        };

        assert_eq!(schema_records.schema_key, "test_key");
        assert!(Arc::ptr_eq(&schema_records.schema, &schema));
        assert_eq!(schema_records.records.len(), 1);
        assert_eq!(schema_records.records_size, 1);
    }

    #[test]
    fn test_stream_delete_fields() {
        let delete_fields = StreamDeleteFields {
            fields: vec!["field1".to_string(), "field2".to_string()],
        };

        assert_eq!(delete_fields.fields.len(), 2);
        assert_eq!(delete_fields.fields[0], "field1");
        assert_eq!(delete_fields.fields[1], "field2");
    }

    #[test]
    fn test_stream_with_uds_schema() {
        let stream = Stream {
            name: "test_stream".to_string(),
            storage_type: "local".to_string(),
            stream_type: StreamType::Logs,
            stats: StreamStats::default(),
            schema: vec![],
            uds_schema: vec![StreamField {
                name: "uds_field".to_string(),
                r#type: "string".to_string(),
            }],
            settings: StreamSettings::default(),
            metrics_meta: None,
            total_fields: 1,
            pattern_associations: vec![],
            is_derived: None,
        };

        assert!(stream.uds_schema.len() == 1);
    }

    #[test]
    fn test_empty_stream_delete_fields_default() {
        let delete_fields = StreamDeleteFields::default();
        assert!(delete_fields.fields.is_empty());
    }
}
