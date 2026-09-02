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
    meta::{
        alerts::{alert, level::PAYLOAD_SAMPLE_ROWS},
        promql::{METRICS_HASH_EXCLUDED_LABELS, Metadata},
    },
    utils::{
        hash::{Sum64, gxhash},
        json::get_string_value,
    },
};
use datafusion::arrow::datatypes::Schema;

use crate::ingestion::TriggerAlertData;

pub mod json;
mod native_histogram;
pub mod otlp;
mod otlp_json_compat;
pub mod prom;

/// Distinct label sets one realtime notification carries, matching the scheduled path's sample.
const TRIGGER_LABEL_LIMIT: usize = PAYLOAD_SAMPLE_ROWS as usize;

/// OTLP writes a per-sample `start_time`, which the shared hash-excluded set does not cover.
const TRIGGER_DEDUP_EXTRA_EXCLUDED_LABELS: &[&str] = &["start_time"];

/// An alert's pending notification for the request being ingested.
struct TriggerSlot {
    idx: usize,
    /// Label sets already represented, so a series repeating across samples adds one row.
    labels: HashSet<u64>,
}

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
    config::meta::promql::get_metadata_from_schema(schema)
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

fn get_exclude_labels() -> &'static [&'static str] {
    METRICS_HASH_EXCLUDED_LABELS
}

/// Series identity for alert dedup, rendering every value so a numeric label still separates two
/// series.
fn series_signature(labels: &config::utils::json::Map<String, config::utils::json::Value>) -> u64 {
    let mut labels: Vec<(&str, String)> = labels
        .iter()
        .filter(|(key, _value)| {
            !METRICS_HASH_EXCLUDED_LABELS.contains(&key.as_str())
                && !TRIGGER_DEDUP_EXTRA_EXCLUDED_LABELS.contains(&key.as_str())
        })
        .map(|(key, value)| (key.as_str(), get_string_value(value)))
        .collect();
    labels.sort_by(|a, b| a.0.cmp(b.0));

    let key = labels
        .iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<String>>()
        .join("|");
    gxhash::new().sum64(&key)
}

/// Whether this label set would add anything to `key`'s pending notification.
fn trigger_wants_labels(
    trigger_slots: &HashMap<String, TriggerSlot>,
    key: &str,
    labels: u64,
) -> bool {
    match trigger_slots.get(key) {
        Some(slot) => slot.labels.len() < TRIGGER_LABEL_LIMIT && !slot.labels.contains(&labels),
        None => true,
    }
}

/// Record an evaluation against `key`, one row per distinct label set.
fn merge_trigger_rows(
    triggers: &mut TriggerAlertData,
    trigger_slots: &mut HashMap<String, TriggerSlot>,
    key: &str,
    labels: u64,
    alert: &alert::Alert,
    rows: Vec<config::utils::json::Map<String, config::utils::json::Value>>,
) {
    match trigger_slots.get_mut(key) {
        Some(slot) => {
            if slot.labels.len() < TRIGGER_LABEL_LIMIT && slot.labels.insert(labels) {
                triggers[slot.idx].1.extend(rows);
            }
        }
        None => {
            trigger_slots.insert(
                key.to_string(),
                TriggerSlot {
                    idx: triggers.len(),
                    labels: HashSet::from([labels]),
                },
            );
            triggers.push((alert.clone(), rows));
        }
    }
}

#[cfg(test)]
mod tests {
    use config::{
        TIMESTAMP_COL_NAME,
        meta::promql::{HASH_LABEL, METADATA_LABEL, VALUE_LABEL},
        utils::json,
    };

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
        assert!(labels.contains(&"trace_id"));
        assert!(labels.contains(&"span_id"));
        assert!(!labels.contains(&"job"));
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
    fn labelled_row(label: &str) -> json::Map<String, json::Value> {
        let mut row = json::Map::new();
        row.insert("label".to_string(), json::Value::String(label.to_string()));
        row
    }

    #[test]
    fn merge_trigger_rows_creates_a_slot_on_first_match() {
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        merge_trigger_rows(
            &mut triggers,
            &mut slots,
            "k",
            1,
            &alert::Alert::default(),
            vec![labelled_row("east")],
        );
        assert_eq!(triggers.len(), 1);
        assert_eq!(triggers[0].1.len(), 1);
        assert_eq!(slots["k"].idx, 0);
    }

    #[test]
    fn merge_trigger_rows_adds_a_row_per_distinct_label_set() {
        // Every label set is its own series, and the reported bug loses all but the first.
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        let alert = alert::Alert::default();
        for (labels, name) in [(1u64, "east"), (2, "west"), (3, "north")] {
            merge_trigger_rows(
                &mut triggers,
                &mut slots,
                "k",
                labels,
                &alert,
                vec![labelled_row(name)],
            );
        }
        assert_eq!(triggers.len(), 1, "still one notification per alert");
        let seen: Vec<_> = triggers[0]
            .1
            .iter()
            .map(|r| r["label"].as_str().unwrap())
            .collect();
        assert_eq!(seen, ["east", "west", "north"]);
    }

    #[test]
    fn merge_trigger_rows_ignores_a_repeated_label_set() {
        // One series repeats its labels per sample, which must not add a row each time.
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        let alert = alert::Alert::default();
        for value in ["t1", "t2", "t3"] {
            merge_trigger_rows(
                &mut triggers,
                &mut slots,
                "k",
                7,
                &alert,
                vec![labelled_row(value)],
            );
        }
        assert_eq!(triggers[0].1.len(), 1);
        assert_eq!(triggers[0].1[0]["label"].as_str().unwrap(), "t1");
    }

    #[test]
    fn merge_trigger_rows_keeps_separate_alerts_apart() {
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        merge_trigger_rows(
            &mut triggers,
            &mut slots,
            "a",
            1,
            &alert::Alert::default(),
            vec![labelled_row("x")],
        );
        merge_trigger_rows(
            &mut triggers,
            &mut slots,
            "b",
            1,
            &alert::Alert::default(),
            vec![labelled_row("y")],
        );
        assert_eq!(triggers.len(), 2);
        assert_eq!(triggers[0].1.len(), 1);
        assert_eq!(triggers[1].1.len(), 1);
    }

    #[test]
    fn merge_trigger_rows_stops_at_the_label_limit() {
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        let alert = alert::Alert::default();
        for i in 0..(TRIGGER_LABEL_LIMIT + 25) {
            merge_trigger_rows(
                &mut triggers,
                &mut slots,
                "k",
                i as u64,
                &alert,
                vec![labelled_row(&i.to_string())],
            );
        }
        assert_eq!(triggers[0].1.len(), TRIGGER_LABEL_LIMIT);
    }

    #[test]
    fn trigger_wants_labels_gates_on_seen_and_capacity() {
        let mut triggers: TriggerAlertData = Vec::new();
        let mut slots = HashMap::new();
        let alert = alert::Alert::default();
        assert!(
            trigger_wants_labels(&slots, "k", 1),
            "an alert with nothing yet takes any label set"
        );
        merge_trigger_rows(
            &mut triggers,
            &mut slots,
            "k",
            1,
            &alert,
            vec![labelled_row("east")],
        );
        assert!(
            !trigger_wants_labels(&slots, "k", 1),
            "a label set already represented adds nothing"
        );
        assert!(trigger_wants_labels(&slots, "k", 2), "a new one still does");
        for i in 2..=(TRIGGER_LABEL_LIMIT as u64) {
            merge_trigger_rows(
                &mut triggers,
                &mut slots,
                "k",
                i,
                &alert,
                vec![labelled_row("x")],
            );
        }
        assert!(
            !trigger_wants_labels(&slots, "k", 9_999),
            "a full notification takes nothing new"
        );
    }
    fn labels(pairs: &[(&str, json::Value)]) -> json::Map<String, json::Value> {
        let mut m = json::Map::new();
        for (k, v) in pairs {
            m.insert((*k).to_string(), v.clone());
        }
        m
    }

    #[test]
    fn series_signature_separates_numeric_labels() {
        // `signature_without_labels` renders every non-string as "", so these two collide there.
        let a = labels(&[("code", json::json!(200))]);
        let b = labels(&[("code", json::json!(500))]);
        assert_ne!(series_signature(&a), series_signature(&b));
        assert_eq!(
            signature_without_labels(&a, &[]),
            signature_without_labels(&b, &[])
        );
    }

    #[test]
    fn series_signature_separates_boolean_labels() {
        let a = labels(&[("ok", json::json!(true))]);
        let b = labels(&[("ok", json::json!(false))]);
        assert_ne!(series_signature(&a), series_signature(&b));
    }

    #[test]
    fn series_signature_ignores_per_sample_columns() {
        let base = [("host", json::json!("a"))];
        let one = labels(&[
            base[0].clone(),
            (TIMESTAMP_COL_NAME, json::json!(1_000_i64)),
            ("start_time", json::json!("111")),
            (HASH_LABEL, json::json!(7_u64)),
            (VALUE_LABEL, json::json!(1.5)),
        ]);
        let two = labels(&[
            base[0].clone(),
            (TIMESTAMP_COL_NAME, json::json!(2_000_i64)),
            ("start_time", json::json!("222")),
            (HASH_LABEL, json::json!(9_u64)),
            (VALUE_LABEL, json::json!(9.9)),
        ]);
        assert_eq!(series_signature(&one), series_signature(&two));
    }

    #[test]
    fn series_signature_separates_distinct_series() {
        let a = labels(&[("host", json::json!("a")), ("region", json::json!("eu"))]);
        let b = labels(&[("host", json::json!("b")), ("region", json::json!("eu"))]);
        assert_ne!(series_signature(&a), series_signature(&b));
    }
}
