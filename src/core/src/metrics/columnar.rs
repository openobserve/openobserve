// Copyright 2026 OpenObserve Inc.
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

use std::collections::{HashMap, HashSet};

use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        alerts::alert,
        promql::{HASH_LABEL, VALUE_LABEL},
        stream::{StreamPartition, StreamType},
    },
    utils::json::{JsonBytesExt, estimate_json_entry_bytes, is_size_excluded_column},
};
use datafusion::arrow::datatypes::{DataType, Schema};
use infra::{errors::Result, schema::SchemaCache};

use super::LabelPair;
use crate::{
    ingestion::columnar::{ColumnKind, ColumnarBuckets},
    pipeline::batch_execution::ExecutablePipeline,
};

/// Past this many labels the scan in `push_label` costs more than hashing every name.
pub(super) const LABEL_INDEX_THRESHOLD: usize = 64;

/// `value`, `_timestamp` and `__hash__`, the columns a record carries beyond its labels.
const IDENTITY_COLUMNS: usize = 3;

pub(super) struct ColumnarStream {
    buckets: ColumnarBuckets,
    /// Whether each schema column holds a label rather than an identity column.
    label_columns: Vec<bool>,
    value_col: usize,
    timestamp_col: usize,
    hash_col: usize,
    /// Probed once per label of every sample, so it takes foldhash rather than SipHash.
    col_index: hashbrown::HashMap<String, usize>,
    /// The widest record this stream's schema can hold, which bounds a series' label count.
    max_labels: usize,
    /// Scratch reused across the samples of a request, not state.
    label_cols: Vec<usize>,
    present: Vec<bool>,
}

impl ColumnarStream {
    /// `None` unless every field is exactly the type the JSON path would infer for it.
    pub(super) fn for_schema(schema: &Schema) -> Option<Self> {
        if schema.fields().is_empty() {
            return None;
        }
        let mut label_columns = Vec::with_capacity(schema.fields().len());
        let mut col_index = hashbrown::HashMap::with_capacity(schema.fields().len());
        let (mut value_col, mut timestamp_col, mut hash_col) = (None, None, None);
        for (idx, field) in schema.fields().iter().enumerate() {
            match (field.name().as_str(), field.data_type()) {
                (VALUE_LABEL, DataType::Float64) => value_col = Some(idx),
                (TIMESTAMP_COL_NAME, DataType::Int64) => timestamp_col = Some(idx),
                (HASH_LABEL, DataType::UInt64) => hash_col = Some(idx),
                (_, DataType::Utf8) => {}
                _ => return None,
            }
            label_columns.push(field.data_type() == &DataType::Utf8);
            col_index.insert(field.name().clone(), idx);
        }
        Some(Self {
            buckets: ColumnarBuckets::new(StreamType::Metrics, schema),
            present: vec![false; label_columns.len()],
            label_columns,
            value_col: value_col?,
            timestamp_col: timestamp_col?,
            hash_col: hash_col?,
            col_index,
            // a record adds `value`, `_timestamp` and `__hash__` to the series' labels
            max_labels: get_config()
                .limit
                .req_cols_per_record_limit
                .saturating_sub(IDENTITY_COLUMNS),
            label_cols: Vec::new(),
        })
    }

    /// `None` sends the series down the JSON path; `Some` is its share of the record's json size.
    pub(super) fn resolve_columns<L: LabelPair>(&mut self, labels: &[L]) -> Option<usize> {
        // over the column limit the JSON path has to reject it, so it cannot be taken here
        if labels.len() > self.max_labels {
            return None;
        }
        self.label_cols.clear();
        // two label names can format to one column, and a label can be named `value`
        self.present.fill(false);
        for label in labels {
            let &idx = self.col_index.get(label.name())?;
            if !self.label_columns[idx] || self.present[idx] {
                return None;
            }
            self.present[idx] = true;
            self.label_cols.push(idx);
        }
        Some(estimated_label_bytes(labels))
    }

    /// `resolve_columns` must have accepted these labels first, and returned `label_bytes`.
    pub(super) fn append<L: LabelPair>(
        &mut self,
        labels: &[L],
        label_bytes: usize,
        value: f64,
        timestamp: i64,
        hash: u64,
    ) {
        let bucket = self.buckets.bucket(timestamp);
        for (col, label) in self.label_cols.iter().zip(labels) {
            bucket
                .column(*col, ColumnKind::Utf8)
                .append_str(label.value());
        }
        bucket
            .column(self.value_col, ColumnKind::Float64)
            .append_f64(value);
        bucket
            .column(self.timestamp_col, ColumnKind::Int64)
            .append_i64(timestamp);
        bucket
            .column(self.hash_col, ColumnKind::UInt64)
            .append_u64(hash);
        bucket.finish_row(estimated_record_bytes(label_bytes, value, timestamp, hash));
    }

    pub(super) fn into_entries(
        self,
        org_id: &str,
        stream_name: &str,
    ) -> Result<Vec<ingester::Entry>> {
        self.buckets.into_entries(org_id, stream_name, None)
    }
}

/// Streams nothing downstream needs as JSON: no pipeline, UDS, alert, partition key or odd type.
pub(super) fn plan_columnar_streams(
    org_id: &str,
    unique_metrics: &HashSet<String>,
    metric_schema_map: &HashMap<String, SchemaCache>,
    stream_executable_pipelines: &HashMap<String, Vec<ExecutablePipeline>>,
    user_defined_schema_map: &HashMap<String, Option<HashSet<String>>>,
    stream_alerts_map: &HashMap<String, Vec<alert::Alert>>,
    stream_partitioning_map: &HashMap<String, Vec<StreamPartition>>,
) -> HashMap<String, ColumnarStream> {
    unique_metrics
        .iter()
        .filter_map(|name| {
            columnar_stream_for(
                org_id,
                name,
                metric_schema_map,
                stream_executable_pipelines,
                user_defined_schema_map,
                stream_alerts_map,
                stream_partitioning_map,
            )
            .map(|columnar| (name.clone(), columnar))
        })
        .collect()
}

/// A columnar builder for one stream, if nothing downstream needs its records as JSON.
pub(super) fn columnar_stream_for(
    org_id: &str,
    stream_name: &str,
    metric_schema_map: &HashMap<String, SchemaCache>,
    stream_executable_pipelines: &HashMap<String, Vec<ExecutablePipeline>>,
    user_defined_schema_map: &HashMap<String, Option<HashSet<String>>>,
    stream_alerts_map: &HashMap<String, Vec<alert::Alert>>,
    stream_partitioning_map: &HashMap<String, Vec<StreamPartition>>,
) -> Option<ColumnarStream> {
    let alert_key = format!("{org_id}/{}/{stream_name}", StreamType::Metrics);
    let plain = !stream_executable_pipelines
        .get(stream_name)
        .is_some_and(|v| !v.is_empty())
        && !matches!(user_defined_schema_map.get(stream_name), Some(Some(_)))
        && !stream_alerts_map.contains_key(&alert_key)
        && stream_partitioning_map
            .get(stream_name)
            .is_none_or(|keys| keys.iter().all(|key| key.disabled));
    if !plain {
        return None;
    }
    ColumnarStream::for_schema(metric_schema_map.get(stream_name)?.schema())
}

/// Replaces an earlier label of the same formatted name in place, returning its position.
pub(super) fn push_label<L: LabelPair>(
    label_pairs: &mut Vec<L>,
    index: &mut HashMap<String, usize>,
    label: L,
) -> Option<usize> {
    match find_label(label_pairs, index, label.name()) {
        Some(idx) => {
            label_pairs[idx] = label;
            Some(idx)
        }
        None => {
            if !index.is_empty() || label_pairs.len() >= LABEL_INDEX_THRESHOLD {
                index.insert(label.name().to_string(), label_pairs.len());
            }
            label_pairs.push(label);
            None
        }
    }
}

/// The position of `name` among `label_pairs`, scanning while they are few and hashing after.
pub(super) fn find_label<L: LabelPair>(
    label_pairs: &[L],
    index: &mut HashMap<String, usize>,
    name: &str,
) -> Option<usize> {
    if label_pairs.len() < LABEL_INDEX_THRESHOLD {
        return label_pairs.iter().position(|label| label.name() == name);
    }
    // a seeded index holds every label, so empty past the threshold means not seeded yet
    if index.is_empty() {
        index.extend(
            label_pairs
                .iter()
                .enumerate()
                .map(|(idx, label)| (label.name().to_string(), idx)),
        );
    }
    index.get(name).copied()
}

/// The label half of what `estimate_json_bytes` counts, shared by every sample of a series.
fn estimated_label_bytes<L: LabelPair>(labels: &[L]) -> usize {
    labels
        .iter()
        .filter(|label| !is_size_excluded_column(label.name()))
        .map(|label| estimate_json_entry_bytes(label.name(), label.value().json_bytes()))
        .sum()
}

/// What `estimate_json_bytes` would count for this record, without building it.
fn estimated_record_bytes(label_bytes: usize, value: f64, timestamp: i64, hash: u64) -> usize {
    let entries = label_bytes
        + estimate_json_entry_bytes(VALUE_LABEL, value.json_bytes())
        + estimate_json_entry_bytes(TIMESTAMP_COL_NAME, timestamp.json_bytes())
        + estimate_json_entry_bytes(HASH_LABEL, hash.json_bytes());
    // {?} extra 2, less the ',' the entry rule counts for the last entry
    2 + entries - 1
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use config::{meta::promql::NAME_LABEL, utils::json};
    use datafusion::arrow::datatypes::Field;
    use infra::schema::get_partition_time_level;

    use super::*;

    fn columnar_schema(labels: &[&str]) -> Arc<Schema> {
        let mut fields: Vec<Field> = labels
            .iter()
            .map(|name| Field::new(*name, DataType::Utf8, true))
            .collect();
        fields.push(Field::new(VALUE_LABEL, DataType::Float64, true));
        fields.push(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false));
        fields.push(Field::new(HASH_LABEL, DataType::UInt64, true));
        Arc::new(Schema::new(fields))
    }

    #[test]
    fn test_resolve_columns_accepts_a_plain_series() {
        let schema = columnar_schema(&[NAME_LABEL, "instance"]);
        let mut columnar = ColumnarStream::for_schema(&schema).unwrap();
        let labels = vec![
            (NAME_LABEL.to_string(), "http_requests".to_string()),
            ("instance".to_string(), "host-1".to_string()),
        ];

        let label_bytes = columnar.resolve_columns(&labels).unwrap();
        columnar.append(&labels, label_bytes, 1.5, 1_700_000_000_000_000, 42);
        let entries = columnar.into_entries("nexus", "http_requests").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].batch.as_ref().unwrap().num_rows(), 1);
    }

    #[test]
    fn test_resolve_columns_rejects_two_labels_on_one_column() {
        let schema = columnar_schema(&[NAME_LABEL, "foo_bar"]);
        let mut columnar = ColumnarStream::for_schema(&schema).unwrap();
        // `foo.bar` and `foo-bar` both format to `foo_bar`, which the JSON path collapses
        let labels = vec![
            (NAME_LABEL.to_string(), "http_requests".to_string()),
            ("foo_bar".to_string(), "a".to_string()),
            ("foo_bar".to_string(), "b".to_string()),
        ];

        assert!(columnar.resolve_columns(&labels).is_none());
    }

    #[test]
    fn test_resolve_columns_rejects_a_label_owning_no_column_of_its_own() {
        let schema = columnar_schema(&[NAME_LABEL]);
        let mut columnar = ColumnarStream::for_schema(&schema).unwrap();

        for taken in [VALUE_LABEL, TIMESTAMP_COL_NAME, HASH_LABEL] {
            let labels = vec![
                (NAME_LABEL.to_string(), "http_requests".to_string()),
                (taken.to_string(), "x".to_string()),
            ];
            assert!(columnar.resolve_columns(&labels).is_none(), "{taken}");
        }
    }

    #[test]
    fn test_estimated_record_bytes_matches_the_json_path_on_the_same_record() {
        let (value, timestamp, hash) = (1.5_f64, 1_700_000_000_000_000_i64, 42_u64);
        let labels = vec![
            (NAME_LABEL.to_string(), "http_requests".to_string()),
            ("instance".to_string(), "a\"b\\c".to_string()),
            // estimate_json_bytes leaves these out, so the columnar estimate has to leave them out
            (config::ORIGINAL_DATA_COL_NAME.to_string(), "x".repeat(4096)),
            (config::ALL_VALUES_COL_NAME.to_string(), "y".repeat(512)),
        ];

        let mut map = json::Map::new();
        for (name, label) in &labels {
            map.insert(name.clone(), json::Value::String(label.clone()));
        }
        map.insert(VALUE_LABEL.to_string(), json::json!(value));
        map.insert(TIMESTAMP_COL_NAME.to_string(), json::json!(timestamp));
        map.insert(HASH_LABEL.to_string(), json::json!(hash));
        let record = map;

        assert_eq!(
            estimated_record_bytes(estimated_label_bytes(&labels), value, timestamp, hash),
            json::estimate_json_bytes(&json::Value::Object(record))
        );
    }

    #[test]
    fn test_push_label_collapses_collisions_past_the_index_threshold() {
        let mut label_pairs: Vec<(String, String)> = Vec::new();
        let mut label_index = HashMap::new();
        let width = LABEL_INDEX_THRESHOLD + 8;
        for i in 0..width {
            push_label(
                &mut label_pairs,
                &mut label_index,
                (format!("label_{i}"), format!("v{i}")),
            );
        }
        let seeded_before = format!("label_{}", LABEL_INDEX_THRESHOLD - 4);
        let seeded_after = format!("label_{}", LABEL_INDEX_THRESHOLD + 4);
        for name in [&seeded_before, &seeded_after] {
            push_label(
                &mut label_pairs,
                &mut label_index,
                (name.clone(), "last".to_string()),
            );
        }

        // a repeat on either side of the threshold overwrites in place, as the scan alone would
        assert_eq!(label_pairs.len(), width);
        assert_eq!(
            label_pairs[LABEL_INDEX_THRESHOLD - 4],
            (seeded_before, "last".to_string())
        );
        assert_eq!(
            label_pairs[LABEL_INDEX_THRESHOLD + 4],
            (seeded_after, "last".to_string())
        );
    }

    #[test]
    fn test_columnar_path_declines_a_series_wider_than_the_column_limit() {
        let limit = get_config().limit.req_cols_per_record_limit;
        let names: Vec<String> = (0..limit).map(|i| format!("label_{i}")).collect();
        let schema = columnar_schema(&names.iter().map(String::as_str).collect::<Vec<_>>());
        let mut columnar = ColumnarStream::for_schema(&schema).unwrap();
        let series = |count: usize| -> Vec<(String, String)> {
            names[..count]
                .iter()
                .map(|name| (name.clone(), "v".to_string()))
                .collect()
        };

        // the widest record the limit allows still carries the three identity columns
        assert!(
            columnar
                .resolve_columns(&series(limit - IDENTITY_COLUMNS))
                .is_some()
        );
        // one label more and the JSON path would reject the record, so the fast path declines it
        assert!(
            columnar
                .resolve_columns(&series(limit - IDENTITY_COLUMNS + 1))
                .is_none()
        );
    }

    #[test]
    fn test_columnar_buckets_follow_the_partition_key_across_the_epoch() {
        let schema = columnar_schema(&[NAME_LABEL]);
        let mut columnar = ColumnarStream::for_schema(&schema).unwrap();
        let schema_key = columnar.buckets.schema_key().to_string();
        let labels = vec![(NAME_LABEL.to_string(), "http_requests".to_string())];
        let timestamps = [-3_601_000_000_i64, -1_000_000, 1_000_000];
        let label_bytes = columnar.resolve_columns(&labels).unwrap();
        for ts in timestamps {
            columnar.append(&labels, label_bytes, 1.0, ts, 42);
        }

        let entries = columnar.into_entries("nexus", "http_requests").unwrap();
        let keys: HashSet<String> = entries
            .iter()
            .map(|entry| entry.partition_key.to_string())
            .collect();
        assert_eq!(keys.len(), timestamps.len());
        for ts in timestamps {
            let expected = crate::ingestion::get_write_partition_key(
                ts,
                &Vec::new(),
                get_partition_time_level(StreamType::Metrics),
                &json::Map::new(),
                Some(&schema_key),
            );
            assert!(keys.contains(&expected), "{ts}");
        }
    }
}
