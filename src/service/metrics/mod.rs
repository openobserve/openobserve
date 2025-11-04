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

use config::{
    meta::promql::{EXEMPLARS_LABEL, HASH_LABEL, METADATA_LABEL, Metadata, VALUE_LABEL},
    utils::hash::{Sum64, gxhash},
};
use datafusion::arrow::datatypes::Schema;

pub mod json;
pub mod otlp;
pub mod prom;

const EXCLUDE_LABELS: [&str; 7] = [
    VALUE_LABEL,
    HASH_LABEL,
    EXEMPLARS_LABEL,
    "is_monotonic",
    "trace_id",
    "span_id",
    "_timestamp",
];

pub fn get_prom_metadata_from_schema(schema: &Schema) -> Option<Metadata> {
    let metadata = schema.metadata.get(METADATA_LABEL)?;
    let metadata: Metadata = config::utils::json::from_str(metadata).unwrap();
    Some(metadata)
}

/// `signature_without_labels` is just as [`signature`], but only for labels not
/// matching `names`.
// REFACTORME: make this a method of `Metric`
pub fn signature_without_labels(
    labels: &config::utils::json::Map<String, config::utils::json::Value>,
    exclude_names: &[&str],
) -> u64 {
    let mut labels: Vec<(&str, &str)> = labels
        .iter()
        .filter(|(key, _value)| !exclude_names.contains(&key.as_str()))
        .map(|(key, value)| (key.as_str(), value.as_str().unwrap_or("")))
        .collect();
    labels.sort_by(|a, b| a.0.cmp(b.0));

    let key = labels
        .iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<String>>()
        .join("|");
    gxhash::new().sum64(&key)
}

fn get_exclude_labels() -> Vec<&'static str> {
    let vec: Vec<&str> = EXCLUDE_LABELS.to_vec();
    // TODO: fixed _timestamp
    // let column_timestamp = config::TIMESTAMP_COL_NAME.as_str();
    // vec.push(column_timestamp);
    vec
}

/// Refactor metrics map to separate indexed and non-indexed labels based on UDS configuration.
/// Similar to logs refactor_map, but preserves metric-specific fields.
///
/// # Arguments
/// * `original_map` - The original metric data map with all labels
/// * `defined_schema_labels` - Set of label names that should be indexed
///
/// # Returns
/// A new map with indexed labels as columns and non-indexed labels in _labels column
pub fn refactor_metrics_map(
    original_map: config::utils::json::Map<String, config::utils::json::Value>,
    defined_schema_labels: &hashbrown::HashSet<String>,
) -> config::utils::json::Map<String, config::utils::json::Value> {
    use std::io::Write;

    use config::utils::json;

    log::debug!(
        "[METRICS REFACTOR] Starting refactor with {} original fields and {} defined schema labels",
        original_map.len(),
        defined_schema_labels.len()
    );

    let mut indexed_map = json::Map::with_capacity(defined_schema_labels.len() + 10);
    let mut non_indexed_labels = Vec::with_capacity(1024); // 1KB initial capacity

    // Core metric fields that should always be preserved as separate columns
    const CORE_METRIC_FIELDS: &[&str] = &[
        config::TIMESTAMP_COL_NAME, // _timestamp
        "__name__",                 // Metric name (Prometheus)
        VALUE_LABEL,                // __value__
        HASH_LABEL,                 // __hash__
        EXEMPLARS_LABEL,            // __exemplars__
        "metric_type",
        "is_monotonic",
        "unit",
        "buckets",   // For histograms
        "quantiles", // For summaries
        "sum",
        "count",
        "min",
        "max",
        "job",                             // Prometheus job label (critical for PromQL)
        "instance",                        // Prometheus instance label (critical for PromQL)
        "flag",                            // Flag field
        "host_name",                       // Host name
        "instrumentation_library_name",    // Instrumentation library name
        "instrumentation_library_version", // Instrumentation library version
        "memory_type",                     // Memory type
        "region",                          // Region
        "service_name",                    // Service name (OTLP resource attribute)
        "service_version",                 // Service version (OTLP resource attribute)
        "start_time",                      // Start time for cumulative metrics
        "_labels",                         /* The synthetic column itself must never go into
                                            * _labels! */
    ];

    let mut has_non_indexed = false;
    let mut non_indexed_count = 0;
    non_indexed_labels.write_all(b"{").unwrap();

    for (key, value) in original_map {
        // Always keep core metric fields and explicitly defined fields indexed
        if CORE_METRIC_FIELDS.contains(&key.as_str()) {
            log::debug!("[METRICS REFACTOR] Keeping core field '{}' indexed", key);
            indexed_map.insert(key, value);
        } else if defined_schema_labels.contains(&key) {
            log::debug!("[METRICS REFACTOR] Keeping defined field '{}' indexed", key);
            indexed_map.insert(key, value);
        } else if EXCLUDE_LABELS.contains(&key.as_str()) {
            log::debug!(
                "[METRICS REFACTOR] Keeping excluded field '{}' indexed",
                key
            );
            indexed_map.insert(key, value);
        } else {
            // Add to non-indexed labels
            non_indexed_count += 1;
            if has_non_indexed {
                non_indexed_labels.write_all(b",").unwrap();
            } else {
                has_non_indexed = true;
            }

            non_indexed_labels.write_all(b"\"").unwrap();
            non_indexed_labels.write_all(key.as_bytes()).unwrap();
            non_indexed_labels.write_all(b"\":\"").unwrap();
            non_indexed_labels
                .write_all(config::utils::json::pickup_string_value(value).as_bytes())
                .unwrap();
            non_indexed_labels.write_all(b"\"").unwrap();
        }
    }
    non_indexed_labels.write_all(b"}").unwrap();

    // Store non-indexed labels in _labels column (similar to _all for logs, _attributes for traces)
    if has_non_indexed {
        let labels_json = String::from_utf8(non_indexed_labels).unwrap();
        log::debug!(
            "[METRICS REFACTOR] Adding _labels column with {} non-indexed fields ({} bytes)",
            non_indexed_count,
            labels_json.len()
        );
        indexed_map.insert("_labels".to_string(), json::Value::String(labels_json));
    } else {
        log::debug!("[METRICS REFACTOR] No non-indexed labels found, _labels column not added");
    }

    log::debug!(
        "[METRICS REFACTOR] Final map has {} fields, _labels present: {}",
        indexed_map.len(),
        indexed_map.contains_key("_labels")
    );

    indexed_map
}
