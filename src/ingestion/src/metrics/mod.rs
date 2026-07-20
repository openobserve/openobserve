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

use arrow_schema::Schema;
use config::{
    meta::promql::{EXEMPLARS_LABEL, HASH_LABEL, METADATA_LABEL, Metadata, VALUE_LABEL},
    utils::hash::{Sum64, gxhash},
};

pub mod json;
pub mod otlp;
mod otlp_json_compat;
pub mod prom;

const EXCLUDE_LABELS: [&str; 8] = [
    VALUE_LABEL,
    HASH_LABEL,
    EXEMPLARS_LABEL,
    "is_monotonic",
    "trace_id",
    "span_id",
    "_timestamp",
    "_all",
];

/// The value policy for every metric we ingest, on every path.
///
/// NaN means "no observation": the sample is not recorded. An absent series is how Prometheus
/// itself represents no data, and a NaN written through serde_json becomes `Value::Null` --
/// an all-null column is never inferred into the Arrow schema, so the stream it lands in can
/// never be read by PromQL while still costing full ingest, storage and replication.
/// Infinities clamp to the f64 bounds.
///
/// All three ingestion paths go through here: OTLP (`otlp.rs`), remote-write (`prom.rs`) and
/// JSON (`json.rs`). JSON has no NaN or infinity *literal*, but `1e400` is a valid JSON number
/// whose value is an infinity, so it is not exempt.
pub fn sanitize_metric_value(v: f64) -> Option<f64> {
    if v.is_nan() {
        return None;
    }
    if v == f64::INFINITY {
        Some(f64::MAX)
    } else if v == f64::NEG_INFINITY {
        Some(f64::MIN)
    } else {
        Some(v)
    }
}

/// [`sanitize_metric_value`], as the JSON a record carries. `None` means the record must not
/// be written at all.
pub fn metric_value(v: f64) -> Option<config::utils::json::Value> {
    sanitize_metric_value(v).map(|v| config::utils::json::json!(v))
}

pub fn get_prom_metadata_from_schema(schema: &Schema) -> Option<Metadata> {
    let metadata = schema.metadata.get(METADATA_LABEL)?;
    let mut metadata: Metadata = match config::utils::json::from_str(metadata) {
        Ok(metadata) => metadata,
        Err(e) => {
            // this used to panic the process on a single corrupt schema entry
            log::warn!("failed to parse {METADATA_LABEL} from schema: {e}, input: {metadata}");
            return None;
        }
    };

    // Historical schemas carry a JSON-quoted family name: the OTLP writer used to build it with
    // `Value::to_string()`, which yields the serialised JSON (`"name"`, quotes included) rather
    // than the string content. Reversing that is exactly a JSON-string parse -- a clean name is
    // not valid JSON, so it is left alone. The stored bytes are not rewritten; we simply decline
    // to serve the quotes, which is what makes the family join work on data already written.
    let family_name = metadata.metric_family_name.trim();
    metadata.metric_family_name = config::utils::json::from_str::<String>(family_name)
        .unwrap_or_else(|_| family_name.to_string());

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

#[cfg(test)]
mod tests {
    use config::utils::json;

    use super::*;

    #[test]
    fn test_signature_without_labels_same_labels_same_hash() {
        let mut m1 = json::Map::new();
        m1.insert("env".to_string(), json::Value::String("prod".to_string()));
        let mut m2 = json::Map::new();
        m2.insert("env".to_string(), json::Value::String("prod".to_string()));
        assert_eq!(
            signature_without_labels(&m1, &[]),
            signature_without_labels(&m2, &[])
        );
    }

    #[test]
    fn test_signature_without_labels_excludes_key() {
        let mut with_extra = json::Map::new();
        with_extra.insert("env".to_string(), json::Value::String("prod".to_string()));
        with_extra.insert("noise".to_string(), json::Value::String("x".to_string()));
        let mut without_extra = json::Map::new();
        without_extra.insert("env".to_string(), json::Value::String("prod".to_string()));
        assert_eq!(
            signature_without_labels(&with_extra, &["noise"]),
            signature_without_labels(&without_extra, &[])
        );
    }

    #[test]
    fn test_signature_without_labels_different_values_differ() {
        let mut m1 = json::Map::new();
        m1.insert("env".to_string(), json::Value::String("prod".to_string()));
        let mut m2 = json::Map::new();
        m2.insert(
            "env".to_string(),
            json::Value::String("staging".to_string()),
        );
        assert_ne!(
            signature_without_labels(&m1, &[]),
            signature_without_labels(&m2, &[])
        );
    }

    #[test]
    fn test_get_exclude_labels_contains_known_labels() {
        let labels = get_exclude_labels();
        assert!(labels.contains(&"_timestamp"));
        assert!(labels.contains(&"_all"));
    }

    /// The policy itself. The remote-write path calls this one directly (it needs the f64
    /// back), so it is asserted on its own and not only through `metric_value`.
    #[test]
    fn test_sanitize_metric_value() {
        assert!(sanitize_metric_value(f64::NAN).is_none());
        assert_eq!(sanitize_metric_value(f64::INFINITY), Some(f64::MAX));
        assert_eq!(sanitize_metric_value(f64::NEG_INFINITY), Some(f64::MIN));
        assert_eq!(sanitize_metric_value(0.0), Some(0.0));
        assert_eq!(sanitize_metric_value(-1.5), Some(-1.5));
        assert_eq!(sanitize_metric_value(f64::MAX), Some(f64::MAX));
        assert_eq!(sanitize_metric_value(f64::MIN), Some(f64::MIN));
        assert_eq!(
            sanitize_metric_value(f64::MIN_POSITIVE),
            Some(f64::MIN_POSITIVE)
        );
    }

    #[test]
    fn test_metric_value_drops_nan() {
        assert!(metric_value(f64::NAN).is_none());
    }

    #[test]
    fn test_metric_value_clamps_infinities() {
        assert_eq!(
            metric_value(f64::INFINITY).unwrap().as_f64().unwrap(),
            f64::MAX
        );
        assert_eq!(
            metric_value(f64::NEG_INFINITY).unwrap().as_f64().unwrap(),
            f64::MIN
        );
    }

    #[test]
    fn test_metric_value_passes_finite_values_through() {
        assert_eq!(metric_value(0.0).unwrap(), json::json!(0.0));
        assert_eq!(metric_value(-1.5).unwrap(), json::json!(-1.5));
        assert_eq!(metric_value(f64::MAX).unwrap().as_f64().unwrap(), f64::MAX);
    }

    fn schema_with_metadata(blob: &str) -> Schema {
        Schema::empty().with_metadata(
            [(METADATA_LABEL.to_string(), blob.to_string())]
                .into_iter()
                .collect(),
        )
    }

    /// The historical shape: the OTLP writer built the family name with `Value::to_string()`,
    /// so 2,694 of 3,349 streams on a real cluster carry it JSON-quoted. The stored bytes are
    /// left alone; the read path declines to serve the quotes.
    #[test]
    fn test_get_prom_metadata_from_schema_unquotes_stored_family_name() {
        let schema = schema_with_metadata(
            r#"{"metric_type":"Histogram","metric_family_name":"\"foo\"","help":"h","unit":"s"}"#,
        );
        let metadata = get_prom_metadata_from_schema(&schema).unwrap();

        assert_eq!(metadata.metric_family_name, "foo");
        assert_eq!(metadata.help, "h");
    }

    #[test]
    fn test_get_prom_metadata_from_schema_leaves_clean_family_name_alone() {
        let schema = schema_with_metadata(
            r#"{"metric_type":"Histogram","metric_family_name":"foo","help":"h","unit":"s"}"#,
        );

        assert_eq!(
            get_prom_metadata_from_schema(&schema)
                .unwrap()
                .metric_family_name,
            "foo"
        );
    }

    #[test]
    fn test_get_prom_metadata_from_schema_malformed_blob_is_none_not_panic() {
        assert!(get_prom_metadata_from_schema(&schema_with_metadata("not json")).is_none());
    }

    #[test]
    fn test_get_prom_metadata_from_schema_absent_metadata_is_none() {
        assert!(get_prom_metadata_from_schema(&Schema::empty()).is_none());
    }
}
