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

use std::{
    collections::{HashMap, HashSet},
    io::BufReader,
    time::Instant,
};

use anyhow::{Result, anyhow};
use axum::http;
use bytes::Bytes;
use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        alerts::alert::Alert,
        promql::{
            HASH_LABEL, METADATA_LABEL, METRICS_HASH_EXCLUDED_LABELS, Metadata, NAME_LABEL,
            TYPE_LABEL, VALUE_LABEL,
        },
        self_reporting::usage::UsageType,
        stream::{StreamParams, StreamPartition, StreamType},
    },
    utils::{
        flatten, json,
        schema::{format_stream_name, infer_json_schema},
        time::{self, now_micros},
    },
};
use datafusion::arrow::datatypes::Schema;
use db::{self, alerts::alert::cache_stream_key};
use infra::schema::SchemaCache;
use ingestion_common::{IngestionResponse, StreamStatus};

use super::ingest::{self, PipelineFailure, PipelineInputs, RecordsByStream};
use crate::{
    common::meta::{authz::Authz, stream::SchemaRecords},
    ingestion::{TriggerAlertData, check_ingestion_allowed},
    pipeline::batch_execution::ExecutablePipeline,
};

const VALID_METRICS_TYPES: &[&str] = &["counter", "gauge", "histogram", "summary"];

const ENDPOINT: &str = "/api/org/ingest/metrics/_json";

/// A finished row and its timestamp.
type Row = (json::Map<String, json::Value>, i64);

/// Per-request lookups, each filled the first time a stream is seen.
#[derive(Default)]
struct StreamLookups {
    schemas: HashMap<String, SchemaCache>,
    pipelines: HashMap<String, Vec<ExecutablePipeline>>,
    user_defined_schemas: HashMap<String, Option<HashSet<String>>>,
    need_original: HashMap<String, bool>,
    need_all_values: HashMap<String, bool>,
    partitions: HashMap<String, Vec<StreamPartition>>,
    alerts: HashMap<String, Vec<Alert>>,
    deleting: HashMap<String, bool>,
}

/// The value a JSON metric record carries, put through the same policy as every other
/// ingestion path (`super::metric_value`).
///
/// JSON has no NaN or infinity *literal*, but it can still carry a non-finite *value*: `1e400`
/// is a syntactically valid JSON number, and with serde_json's `arbitrary_precision` the literal
/// is kept verbatim, `is_number()` is true, and `as_f64()` returns `None`. Unwrapping that --
/// which is what this code used to do -- panics the ingestion handler on a request body anyone
/// can send. An out-of-range magnitude clamps to the f64 bound, like an OTLP or remote-write
/// infinity does; anything that is not a number at all is rejected.
fn parse_metric_value(value: &json::Value) -> Result<json::Value, anyhow::Error> {
    let json::Value::Number(n) = value else {
        return Err(anyhow!("invalid value, need to be number"));
    };

    // `as_f64` is `None` only when the literal is out of f64 range, where parsing it yields an
    // infinity -- which the policy clamps.
    let raw = match n.as_f64() {
        Some(v) => v,
        None => n
            .to_string()
            .parse::<f64>()
            .map_err(|_| anyhow!("invalid value, need to be number"))?,
    };

    super::metric_value(raw).ok_or_else(|| anyhow!("invalid value, not a number"))
}

/// Queues a validated record for its pipelines or its write; `false` if its stream is deleting.
async fn buffer_record(
    org_id: &str,
    stream_name: Option<&str>,
    record: json::Value,
    lookups: &mut StreamLookups,
    pipeline_inputs: &mut PipelineInputs<&'static str>,
    records_by_stream: &mut RecordsByStream<&'static str>,
) -> Result<bool> {
    let json::Value::Object(mut record) = flatten::flatten(record)? else {
        unreachable!("flatten only returns an object")
    };
    let stream_name = match stream_name {
        Some(name) => name.to_string(),
        None => match record.get(NAME_LABEL).ok_or(anyhow!("missing __name__"))? {
            json::Value::String(s) => format_stream_name(s.to_string()),
            _ => {
                return Err(anyhow::anyhow!("invalid __name__, need to be string"));
            }
        },
    };
    // keep the `__name__` column equal to the stream the record is written to;
    // otherwise `{__name__="..."}` selectors can never match the rows (same
    // policy as the OTLP writer)
    if let Some(v) = record.get_mut(NAME_LABEL) {
        *v = json::Value::String(stream_name.clone());
    }

    // check stream if it is deleting
    let is_deleting = match lookups.deleting.get(&stream_name) {
        Some(v) => *v,
        None => {
            let flag = db::compact::retention::is_deleting_stream(
                org_id,
                StreamType::Metrics,
                &stream_name,
                None,
            );
            lookups.deleting.insert(stream_name.clone(), flag);
            flag
        }
    };
    if is_deleting {
        return Ok(false);
    }

    // default to gauge if __type__ is missing
    let raw_type = record
        .get(TYPE_LABEL)
        .and_then(|v| v.as_str())
        .unwrap_or("gauge");

    if !lookups.pipelines.contains_key(&stream_name) {
        let stream_param = StreamParams::new(org_id, &stream_name, StreamType::Metrics);
        let pipelines = crate::ingestion::get_stream_executable_pipelines(&stream_param).await;
        lookups.pipelines.insert(stream_name.clone(), pipelines);
    }
    if !lookups.user_defined_schemas.contains_key(&stream_name) {
        crate::ingestion::get_uds_and_original_data_streams(
            &[StreamParams::new(org_id, &stream_name, StreamType::Metrics)],
            &mut lookups.user_defined_schemas,
            &mut lookups.need_original,
            &mut lookups.need_all_values,
        )
        .await;
    }

    // `MetricType` parses case-insensitively, so the canonical spelling stands in for the input's
    let Some(metric_type) = VALID_METRICS_TYPES
        .iter()
        .copied()
        .find(|valid| valid.eq_ignore_ascii_case(raw_type))
    else {
        return Err(anyhow::anyhow!(
            "invalid metrics type, need to be one of: {}",
            VALID_METRICS_TYPES.join(", ")
        ));
    };

    if !lookups.schemas.contains_key(&stream_name) {
        let mut schema = infra::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
        if schema == Schema::empty() {
            let metadata = family_metadata(&stream_name, metric_type);
            schema = schema.with_metadata(metadata);
            db::schema::merge(
                org_id,
                &stream_name,
                StreamType::Metrics,
                &schema,
                Some(now_micros()),
            )
            .await?;
        }
        lookups
            .schemas
            .insert(stream_name.clone(), SchemaCache::new(schema));
    }

    let timestamp: i64 = match record.get(TIMESTAMP_COL_NAME) {
        None => now_micros(),
        // `as_f64` is `None` for a literal out of f64 range (`1e400`), which unwrapping
        // turned into a panic on a request body anyone can send
        Some(json::Value::Number(s)) => time::parse_i64_to_timestamp_micros(
            s.as_f64()
                .ok_or_else(|| anyhow::anyhow!("invalid _timestamp, out of range"))?
                as i64,
        ),
        Some(_) => {
            return Err(anyhow::anyhow!("invalid _timestamp, need to be number"));
        }
    };
    record.insert(
        TIMESTAMP_COL_NAME.to_string(),
        json::Value::Number(timestamp.into()),
    );

    if lookups
        .pipelines
        .get(&stream_name)
        .is_some_and(|v| !v.is_empty())
    {
        pipeline_inputs
            .entry(stream_name)
            .or_default()
            .push((json::Value::Object(record), metric_type));
    } else {
        let defined_fields = ingest::defined_schema(&lookups.user_defined_schemas, &stream_name);
        record = ingest::trim_to_defined_schema(record, defined_fields);
        records_by_stream
            .entry(stream_name)
            .or_default()
            .push((record, metric_type));
    }
    Ok(true)
}

/// One stream's rows, each with a checked value, `__hash__` and string labels, and its first type.
fn finish_rows(
    records: Vec<(json::Map<String, json::Value>, &'static str)>,
) -> Result<(Vec<Row>, Option<&'static str>)> {
    let first_type = records.first().map(|(_, metric_type)| *metric_type);
    let mut rows = Vec::with_capacity(records.len());
    for (mut record, _) in records {
        let value = parse_metric_value(record.get(VALUE_LABEL).ok_or(anyhow!("missing value"))?)?;
        if let Some(existing) = record.get_mut(VALUE_LABEL) {
            *existing = value;
        }

        let timestamp = record
            .get(TIMESTAMP_COL_NAME)
            .and_then(|ts| ts.as_i64())
            .ok_or_else(|| anyhow::anyhow!("missing timestamp"))?;

        record.remove(TYPE_LABEL);
        // hashed before the labels are stringified, so a numeric label hashes as an empty value
        let hash = super::signature_without_labels(&record, METRICS_HASH_EXCLUDED_LABELS);
        record.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));

        for (k, v) in record.iter_mut() {
            if k == NAME_LABEL
                || k == TYPE_LABEL
                || k == VALUE_LABEL
                || k == TIMESTAMP_COL_NAME
                || k == HASH_LABEL
            {
                continue;
            }
            if !v.is_string() {
                *v = json::Value::String(v.to_string());
            }
        }
        rows.push((record, timestamp));
    }
    Ok((rows, first_type))
}

/// Resolves a stream's schema for its rows and buffers them into write partitions.
async fn buffer_stream_rows(
    org_id: &str,
    stream_name: &str,
    (rows, first_type): (Vec<Row>, Option<&'static str>),
    lookups: &mut StreamLookups,
    partitions: &mut HashMap<String, SchemaRecords>,
) -> Result<Option<TriggerAlertData>> {
    if !lookups.partitions.contains_key(stream_name) {
        let keys =
            crate::ingestion::get_stream_partition_keys(org_id, &StreamType::Metrics, stream_name)
                .await;
        lookups.partitions.insert(stream_name.to_string(), keys);
    }
    crate::ingestion::get_stream_alerts(
        &[StreamParams::new(org_id, stream_name, StreamType::Metrics)],
        &mut lookups.alerts,
    )
    .await;

    // only a pipeline's destination stream can still be unknown here
    if !lookups.schemas.contains_key(stream_name)
        && let (Some((first, timestamp)), Some(metric_type)) = (rows.first(), first_type)
    {
        let schema =
            create_stream_schema(org_id, stream_name, first, *timestamp, metric_type).await?;
        lookups
            .schemas
            .insert(stream_name.to_string(), SchemaCache::new(schema));
    }

    let has_uds = matches!(lookups.user_defined_schemas.get(stream_name), Some(Some(_)));
    let min_timestamp = rows.iter().map(|(_, ts)| *ts).min().unwrap_or(0);
    let record_refs: Vec<&json::Map<String, json::Value>> =
        rows.iter().map(|(record, ..)| record).collect();
    let (schema, schema_key) = ingest::resolve_batch_schema(
        org_id,
        stream_name,
        &mut lookups.schemas,
        &record_refs,
        min_timestamp,
        has_uds,
    )
    .await?;
    drop(record_refs);

    let alerts = lookups
        .alerts
        .get(&cache_stream_key(org_id, StreamType::Metrics, stream_name));
    let partition_keys = lookups.partitions.get(stream_name);
    Ok(ingest::buffer_stream_records(
        org_id,
        rows,
        &schema,
        &schema_key,
        partition_keys,
        alerts,
        partitions,
    )
    .await)
}

/// The schema a new stream starts with, inferred from its first row and carrying family metadata.
async fn create_stream_schema(
    org_id: &str,
    stream_name: &str,
    first_row: &json::Map<String, json::Value>,
    timestamp: i64,
    metric_type: &str,
) -> Result<Schema> {
    let mut schema = infra::schema::get(org_id, stream_name, StreamType::Metrics).await?;
    if !schema.fields().is_empty() {
        return Ok(schema);
    }
    let record_str = json::to_string(first_row).unwrap();
    let mut schema_reader = BufReader::new(record_str.as_bytes());
    let inferred_schema = infer_json_schema(&mut schema_reader, None, StreamType::Metrics).unwrap();
    schema = inferred_schema.with_metadata(family_metadata(stream_name, metric_type));
    db::schema::merge(
        org_id,
        stream_name,
        StreamType::Metrics,
        &schema,
        Some(timestamp),
    )
    .await?;
    db::authz::set_ownership(
        org_id,
        StreamType::Metrics.as_str(),
        Authz::new(stream_name),
    )
    .await;
    Ok(schema)
}

fn family_metadata(stream_name: &str, metric_type: &str) -> HashMap<String, String> {
    let metadata = Metadata {
        metric_family_name: stream_name.to_string(),
        metric_type: metric_type.into(),
        help: stream_name.replace('_', " "),
        unit: "".to_string(),
    };
    HashMap::from([(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    )])
}

pub async fn ingest(
    org_id: &str,
    stream_name: Option<&str>,
    body: Bytes,
    user: ingestion_common::IngestUser,
) -> Result<IngestionResponse> {
    // check system resource
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Metrics, None).await {
        // we do not want to log trial period expired errors
        if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            return Ok(IngestionResponse {
                code: http::StatusCode::TOO_MANY_REQUESTS.into(),
                status: vec![],
                error: Some(e.to_string()),
                write_failed: false,
                stream_skipped: false,
            });
        } else {
            log::error!("Metrics ingestion error: {e}");
            return Ok(IngestionResponse {
                code: http::StatusCode::SERVICE_UNAVAILABLE.into(),
                status: vec![],
                error: Some(e.to_string()),
                write_failed: false,
                stream_skipped: false,
            });
        }
    }

    let start = Instant::now();
    let started_at = now_micros();

    let mut lookups = StreamLookups::default();
    let mut stream_status_map: HashMap<String, StreamStatus> = HashMap::new();
    let mut pipeline_inputs: PipelineInputs<&'static str> = HashMap::new();
    let mut records_by_stream: RecordsByStream<&'static str> = HashMap::new();
    let mut skipped_records: u32 = 0;

    let reader: Vec<json::Value> = json::from_slice(&body)?;
    for record in reader {
        let buffered = buffer_record(
            org_id,
            stream_name,
            record,
            &mut lookups,
            &mut pipeline_inputs,
            &mut records_by_stream,
        )
        .await?;
        if !buffered {
            skipped_records += 1;
        }
    }

    // warn if any records were skipped due to streams being deleted
    if skipped_records > 0 {
        log::warn!("[METRICS:JSON] Skipped {skipped_records} records due to streams being deleted");
    }

    let (pipeline_outputs, failures) = ingest::run_pipelines(
        org_id,
        &lookups.pipelines,
        pipeline_inputs,
        &lookups.user_defined_schemas,
        &mut lookups.partitions,
    )
    .await;
    for failure in failures {
        if let PipelineFailure::Batch {
            stream_name,
            records,
            message,
        } = failure
        {
            let stream_status = stream_status_map
                .entry(stream_name.clone())
                .or_insert_with(|| StreamStatus::new(&stream_name));
            stream_status.status.failed += records as u32;
            stream_status.status.error = message;
        }
    }
    for (stream_name, records) in pipeline_outputs {
        records_by_stream
            .entry(stream_name)
            .or_default()
            .extend(records);
    }

    let mut stream_data_buf: HashMap<String, HashMap<String, SchemaRecords>> = HashMap::new();
    let mut stream_trigger_map: HashMap<String, Option<TriggerAlertData>> = HashMap::new();
    for (stream_name, records) in records_by_stream {
        let rows = finish_rows(records)?;
        let row_count = rows.0.len();
        let triggers = buffer_stream_rows(
            org_id,
            &stream_name,
            rows,
            &mut lookups,
            stream_data_buf.entry(stream_name.clone()).or_default(),
        )
        .await?;
        if triggers.is_some() {
            stream_trigger_map.insert(stream_name.clone(), triggers);
        }
        stream_status_map
            .entry(stream_name.clone())
            .or_insert_with(|| StreamStatus::new(&stream_name))
            .status
            .successful += row_count as u32;
    }

    let entries_by_stream = ingest::entries_by_stream(org_id, stream_data_buf, std::iter::empty())?;
    ingest::write_streams(
        org_id,
        entries_by_stream,
        &lookups.pipelines,
        &user,
        UsageType::JsonMetrics,
        &start,
        started_at,
    )
    .await?;

    ingest::observe_request(ENDPOINT, org_id, &start);
    ingest::spawn_triggers(stream_trigger_map);

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        stream_status_map.into_values().collect(),
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// `1e400` is a valid JSON number whose value is an infinity. `as_f64()` returns `None` for
    /// it, and unwrapping that panicked the ingestion handler -- on a body anyone can POST.
    #[test]
    fn test_parse_metric_value_clamps_an_out_of_range_number() {
        let value: json::Value = json::from_str("1e400").unwrap();
        assert!(value.is_number());
        assert!(
            value.as_f64().is_none(),
            "precondition: as_f64 is None here"
        );

        let parsed = parse_metric_value(&value).unwrap();
        assert_eq!(parsed.as_f64().unwrap(), f64::MAX);

        let negative: json::Value = json::from_str("-1e400").unwrap();
        assert_eq!(
            parse_metric_value(&negative).unwrap().as_f64().unwrap(),
            f64::MIN
        );
    }

    #[test]
    fn test_parse_metric_value_passes_a_finite_number_through() {
        assert_eq!(
            parse_metric_value(&json!(42.5)).unwrap().as_f64().unwrap(),
            42.5
        );
    }

    #[test]
    fn test_parse_metric_value_rejects_a_non_number() {
        assert!(parse_metric_value(&json!("42.5")).is_err());
        assert!(parse_metric_value(&json!(null)).is_err());
    }

    fn create_test_metric_record(
        name: &str,
        metric_type: &str,
        value: f64,
        labels: Vec<(&str, &str)>,
    ) -> json::Value {
        let mut record = json!({
            "__name__": name,
            "__type__": metric_type,
            "value": value,
            "_timestamp": 1640995200000000i64, // 2022-01-01 00:00:00 UTC in microseconds
        });

        // Add custom labels
        if let Some(obj) = record.as_object_mut() {
            for (k, v) in labels {
                obj.insert(k.to_string(), json!(v));
            }
        }

        record
    }

    #[test]
    fn test_create_test_metric_record() {
        let record = create_test_metric_record(
            "test_metric",
            "counter",
            42.0,
            vec![("instance", "localhost"), ("job", "test")],
        );

        assert_eq!(record["__name__"], "test_metric");
        assert_eq!(record["__type__"], "counter");
        assert_eq!(record["value"], 42.0);
        assert_eq!(record["instance"], "localhost");
        assert_eq!(record["job"], "test");
    }

    #[test]
    fn test_metric_record_validation() {
        // Test valid record
        let valid_record = create_test_metric_record("valid_metric", "gauge", 100.0, vec![]);
        assert!(valid_record.is_object());
        assert!(valid_record.get("__name__").is_some());
        assert!(valid_record.get("__type__").is_some());
        assert!(valid_record.get("value").is_some());

        // Test record with custom labels
        let labeled_record = create_test_metric_record(
            "labeled_metric",
            "histogram",
            50.0,
            vec![("env", "prod"), ("region", "us-west")],
        );
        assert_eq!(labeled_record["env"], "prod");
        assert_eq!(labeled_record["region"], "us-west");
    }

    #[test]
    fn test_metric_type_handling() {
        // Test different metric types
        let counter_record = create_test_metric_record("counter_metric", "counter", 1.0, vec![]);
        let gauge_record = create_test_metric_record("gauge_metric", "gauge", 2.0, vec![]);
        let histogram_record =
            create_test_metric_record("histogram_metric", "histogram", 3.0, vec![]);
        let summary_record = create_test_metric_record("summary_metric", "summary", 4.0, vec![]);

        assert_eq!(counter_record["__type__"], "counter");
        assert_eq!(gauge_record["__type__"], "gauge");
        assert_eq!(histogram_record["__type__"], "histogram");
        assert_eq!(summary_record["__type__"], "summary");
    }

    #[test]
    fn test_timestamp_handling() {
        let record = create_test_metric_record("timestamp_test", "gauge", 10.0, vec![]);

        // Check that timestamp is present and is a number
        assert!(record.get("_timestamp").is_some());
        assert!(record["_timestamp"].is_number());

        let timestamp = record["_timestamp"].as_i64().unwrap();
        assert!(timestamp > 0);
    }

    #[test]
    fn test_value_handling() {
        let record = create_test_metric_record("value_test", "gauge", 99.99, vec![]);

        // Check that value is present and is a number
        assert!(record.get("value").is_some());
        assert!(record["value"].is_number());

        let value = record["value"].as_f64().unwrap();
        assert_eq!(value, 99.99);
    }

    #[test]
    fn test_label_handling() {
        let labels = vec![
            ("instance", "web-01"),
            ("job", "webserver"),
            ("env", "production"),
        ];

        let record = create_test_metric_record("labeled_test", "gauge", 5.0, labels.clone());

        // Check that all labels are present
        for (key, value) in labels {
            assert_eq!(record[key], value);
        }
    }

    #[test]
    fn test_metric_name_formatting() {
        // Test that metric names are properly formatted
        let record = create_test_metric_record("http_requests_total", "counter", 1000.0, vec![]);
        assert_eq!(record["__name__"], "http_requests_total");

        let record = create_test_metric_record("cpu_usage_percent", "gauge", 75.5, vec![]);
        assert_eq!(record["__name__"], "cpu_usage_percent");
    }

    #[test]
    fn test_numeric_value_types() {
        // Test different numeric value types
        let integer_record = create_test_metric_record("int_metric", "gauge", 42.0, vec![]);
        let float_record = create_test_metric_record("float_metric", "gauge", 1.234, vec![]);
        let zero_record = create_test_metric_record("zero_metric", "gauge", 0.0, vec![]);
        let negative_record = create_test_metric_record("negative_metric", "gauge", -10.5, vec![]);

        assert_eq!(integer_record["value"], 42.0);
        assert_eq!(float_record["value"], 1.234);
        assert_eq!(zero_record["value"], 0.0);
        assert_eq!(negative_record["value"], -10.5);
    }

    #[test]
    fn test_metric_record_structure() {
        let record = create_test_metric_record(
            "test_structure",
            "counter",
            123.0,
            vec![("label1", "value1"), ("label2", "value2")],
        );

        // Verify required fields
        let required_fields = ["__name__", "__type__", "value", "_timestamp"];
        for field in required_fields {
            assert!(
                record.get(field).is_some(),
                "Missing required field: {field}"
            );
        }

        // Verify custom labels
        assert_eq!(record["label1"], "value1");
        assert_eq!(record["label2"], "value2");

        // Verify it's a valid JSON object
        assert!(record.is_object());
    }

    mod validation_tests {
        use config::{
            TIMESTAMP_COL_NAME,
            meta::promql::{NAME_LABEL, TYPE_LABEL, VALUE_LABEL},
        };

        use super::*;

        #[test]
        fn test_required_field_validation() {
            // Test record with missing __name__
            let mut invalid_record = json!({
                "__type__": "counter",
                "value": 10.0,
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record.get(NAME_LABEL).is_none());

            // Test record with missing __type__
            invalid_record = json!({
                "__name__": "test_metric",
                "value": 10.0,
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record.get(TYPE_LABEL).is_none());

            // Test record with missing value
            invalid_record = json!({
                "__name__": "test_metric",
                "__type__": "counter",
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record.get(VALUE_LABEL).is_none());
        }

        #[test]
        fn test_field_type_validation() {
            // Test invalid __name__ type (should be string)
            let invalid_record = json!({
                "__name__": 123,
                "__type__": "counter",
                "value": 10.0,
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record[NAME_LABEL].is_number());
            assert!(!invalid_record[NAME_LABEL].is_string());

            // Test invalid __type__ type (should be string)
            let invalid_record = json!({
                "__name__": "test_metric",
                "__type__": 123,
                "value": 10.0,
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record[TYPE_LABEL].is_number());
            assert!(!invalid_record[TYPE_LABEL].is_string());

            // Test invalid value type (should be number)
            let invalid_record = json!({
                "__name__": "test_metric",
                "__type__": "counter",
                "value": "not_a_number",
                "_timestamp": 1640995200000000i64
            });
            assert!(invalid_record[VALUE_LABEL].is_string());
            assert!(!invalid_record[VALUE_LABEL].is_number());

            // Test invalid timestamp type (should be number)
            let invalid_record = json!({
                "__name__": "test_metric",
                "__type__": "counter",
                "value": 10.0,
                "_timestamp": "not_a_timestamp"
            });
            assert!(invalid_record[TIMESTAMP_COL_NAME].is_string());
            assert!(!invalid_record[TIMESTAMP_COL_NAME].is_number());
        }

        #[test]
        fn test_valid_metric_record_validation() {
            let valid_record = create_test_metric_record(
                "valid_metric",
                "gauge",
                42.5,
                vec![("instance", "server1"), ("job", "api")],
            );

            // Verify all required fields are present and correct type
            assert!(valid_record[NAME_LABEL].is_string());
            assert_eq!(valid_record[NAME_LABEL], "valid_metric");

            assert!(valid_record[TYPE_LABEL].is_string());
            assert_eq!(valid_record[TYPE_LABEL], "gauge");

            assert!(valid_record[VALUE_LABEL].is_number());
            assert_eq!(valid_record[VALUE_LABEL], 42.5);

            assert!(valid_record[TIMESTAMP_COL_NAME].is_number());
            assert!(valid_record[TIMESTAMP_COL_NAME].as_i64().unwrap() > 0);
        }
    }

    mod metric_type_tests {
        use super::*;

        #[test]
        fn test_counter_metrics() {
            let counter_record = create_test_metric_record(
                "http_requests_total",
                "counter",
                1500.0,
                vec![("method", "GET"), ("status", "200")],
            );

            assert_eq!(counter_record["__type__"], "counter");
            assert_eq!(counter_record["__name__"], "http_requests_total");
            assert_eq!(counter_record["value"], 1500.0);
            assert_eq!(counter_record["method"], "GET");
            assert_eq!(counter_record["status"], "200");
        }

        #[test]
        fn test_gauge_metrics() {
            let gauge_record = create_test_metric_record(
                "memory_usage_bytes",
                "gauge",
                1024.0 * 1024.0 * 512.0, // 512MB
                vec![("instance", "web-01")],
            );

            assert_eq!(gauge_record["__type__"], "gauge");
            assert_eq!(gauge_record["__name__"], "memory_usage_bytes");
            assert_eq!(gauge_record["value"], 1024.0 * 1024.0 * 512.0);
            assert_eq!(gauge_record["instance"], "web-01");
        }

        #[test]
        fn test_histogram_metrics() {
            let histogram_record = create_test_metric_record(
                "response_time_histogram",
                "histogram",
                0.95,
                vec![("le", "1.0"), ("job", "api-server")],
            );

            assert_eq!(histogram_record["__type__"], "histogram");
            assert_eq!(histogram_record["__name__"], "response_time_histogram");
            assert_eq!(histogram_record["value"], 0.95);
            assert_eq!(histogram_record["le"], "1.0");
            assert_eq!(histogram_record["job"], "api-server");
        }

        #[test]
        fn test_summary_metrics() {
            let summary_record = create_test_metric_record(
                "request_duration_summary",
                "summary",
                0.99,
                vec![("quantile", "0.95"), ("service", "auth")],
            );

            assert_eq!(summary_record["__type__"], "summary");
            assert_eq!(summary_record["__name__"], "request_duration_summary");
            assert_eq!(summary_record["value"], 0.99);
            assert_eq!(summary_record["quantile"], "0.95");
            assert_eq!(summary_record["service"], "auth");
        }

        #[test]
        fn test_case_insensitive_metric_types() {
            let test_cases = vec![
                ("HISTOGRAM", "HISTOGRAM"),
                ("histogram", "histogram"),
                ("Histogram", "Histogram"),
                ("SUMMARY", "SUMMARY"),
                ("summary", "summary"),
                ("Summary", "Summary"),
            ];

            for (input_type, expected_type) in test_cases {
                let record = create_test_metric_record("test_metric", input_type, 1.0, vec![]);
                assert_eq!(record["__type__"], expected_type);
            }
        }
    }

    mod timestamp_tests {
        use config::utils::time;

        use super::*;

        #[test]
        fn test_timestamp_formats() {
            // Test different timestamp formats that should be valid
            let test_cases = vec![
                1640995200000000i64, // Microseconds
                1640995200000i64,    // Milliseconds
                1640995200i64,       // Seconds
            ];

            for timestamp in test_cases {
                let mut record = create_test_metric_record("test", "counter", 1.0, vec![]);
                if let Some(obj) = record.as_object_mut() {
                    obj.insert("_timestamp".to_string(), json!(timestamp));
                }

                assert!(record["_timestamp"].is_number());
                assert_eq!(record["_timestamp"].as_i64().unwrap(), timestamp);
            }
        }

        #[test]
        fn test_timestamp_parsing() {
            let timestamp_micros = 1640995200000000i64;
            let parsed = time::parse_i64_to_timestamp_micros(timestamp_micros);
            assert!(parsed > 0);

            // Test millisecond conversion
            let timestamp_millis = 1640995200000i64;
            let parsed_from_millis = time::parse_i64_to_timestamp_micros(timestamp_millis);
            assert!(parsed_from_millis > timestamp_millis);
        }

        #[test]
        fn test_current_timestamp() {
            let record = create_test_metric_record("current_time_test", "gauge", 1.0, vec![]);
            let timestamp = record["_timestamp"].as_i64().unwrap();

            // Should be a reasonable timestamp (after 2020 and before 2030)
            let year_2020_micros = 1577836800000000i64; // 2020-01-01 in microseconds
            let year_2030_micros = 1893456000000000i64; // 2030-01-01 in microseconds

            assert!(timestamp > year_2020_micros);
            assert!(timestamp < year_2030_micros);
        }
    }

    mod value_tests {
        use super::*;

        #[test]
        fn test_value_number_formats() {
            let test_cases = vec![
                (0.0, "zero value"),
                (42.0, "integer as float"),
                (std::f64::consts::PI, "decimal value"),
                (-10.5, "negative value"),
                (1e6, "scientific notation"),
                (f64::MAX, "maximum float64"),
                (f64::MIN, "minimum float64"),
            ];

            for (value, description) in test_cases {
                let record = create_test_metric_record("test_metric", "gauge", value, vec![]);
                assert_eq!(
                    record["value"].as_f64().unwrap(),
                    value,
                    "Failed for: {description}"
                );
            }
        }

        #[test]
        fn test_value_edge_cases() {
            // Test very small positive value
            let tiny_record = create_test_metric_record("tiny", "gauge", f64::MIN_POSITIVE, vec![]);
            assert_eq!(tiny_record["value"].as_f64().unwrap(), f64::MIN_POSITIVE);

            // Test infinity (JSON might convert to null or string)
            let inf_record = create_test_metric_record("inf", "gauge", f64::INFINITY, vec![]);
            let inf_value = &inf_record["value"];
            if let Some(f_val) = inf_value.as_f64() {
                assert!(f_val.is_infinite());
            } else {
                // JSON might serialize infinity as null or string
                assert!(inf_value.is_null() || inf_value.as_str().is_some());
            }

            // Test negative infinity
            let neg_inf_record =
                create_test_metric_record("neg_inf", "gauge", f64::NEG_INFINITY, vec![]);
            let neg_inf_value = &neg_inf_record["value"];
            if let Some(f_val) = neg_inf_value.as_f64() {
                assert!(f_val.is_infinite() && f_val < 0.0);
            } else {
                // JSON might serialize negative infinity as null or string
                assert!(neg_inf_value.is_null() || neg_inf_value.as_str().is_some());
            }
        }

        #[test]
        fn test_value_precision() {
            // Test precision of floating point values
            let precise_value = 123.456_789_123_456_79;
            let record = create_test_metric_record("precise", "gauge", precise_value, vec![]);

            let stored_value = record["value"].as_f64().unwrap();
            // Allow for floating point precision differences
            assert!((stored_value - precise_value).abs() < f64::EPSILON);
        }
    }

    mod label_tests {
        use super::*;

        #[test]
        fn test_empty_labels() {
            let record = create_test_metric_record("no_labels", "counter", 1.0, vec![]);

            // Should only have the required fields
            let required_fields = ["__name__", "__type__", "value", "_timestamp"];
            let record_obj = record.as_object().unwrap();

            for key in record_obj.keys() {
                assert!(
                    required_fields.contains(&key.as_str()),
                    "Unexpected field: {key}"
                );
            }
        }

        #[test]
        fn test_single_label() {
            let record = create_test_metric_record(
                "single_label",
                "gauge",
                5.0,
                vec![("environment", "production")],
            );

            assert_eq!(record["environment"], "production");
            assert_eq!(record.as_object().unwrap().len(), 5); // 4 required + 1 label
        }

        #[test]
        fn test_multiple_labels() {
            let labels = vec![
                ("service", "web-server"),
                ("version", "1.2.3"),
                ("datacenter", "us-east-1"),
                ("tier", "production"),
            ];

            let record =
                create_test_metric_record("multi_labels", "histogram", 0.5, labels.clone());

            for (key, value) in labels {
                assert_eq!(record[key], value);
            }

            // 4 required fields + 4 labels
            assert_eq!(record.as_object().unwrap().len(), 8);
        }

        #[test]
        fn test_label_name_formats() {
            let special_labels = vec![
                ("label_with_underscores", "value1"),
                ("label-with-dashes", "value2"),
                ("labelWithCamelCase", "value3"),
                ("label.with.dots", "value4"),
                ("123numeric_start", "value5"),
            ];

            let record = create_test_metric_record(
                "special_labels",
                "counter",
                10.0,
                special_labels.clone(),
            );

            for (key, value) in special_labels {
                assert_eq!(record[key], value);
            }
        }

        #[test]
        fn test_label_value_formats() {
            let varied_values = vec![
                ("string_label", "simple_string"),
                ("empty_label", ""),
                ("numeric_string", "12345"),
                ("special_chars", "!@#$%^&*()"),
                ("unicode_label", "测试🚀"),
                ("json_like", "{\"key\":\"value\"}"),
            ];

            let record =
                create_test_metric_record("varied_values", "gauge", 1.0, varied_values.clone());

            for (key, value) in varied_values {
                assert_eq!(record[key], value);
            }
        }
    }

    mod error_handling_tests {
        use super::*;

        #[test]
        fn test_missing_required_fields() {
            // Test what happens when we try to access missing required fields
            let incomplete_records = vec![
                json!({"__type__": "counter", "value": 1.0}), // Missing __name__
                json!({"__name__": "test", "value": 1.0}),    // Missing __type__
                json!({"__name__": "test", "__type__": "counter"}), // Missing value
            ];

            for record in incomplete_records {
                // Verify the missing fields are indeed missing
                let has_name = record.get("__name__").is_some();
                let has_type = record.get("__type__").is_some();
                let has_value = record.get("value").is_some();

                // At least one required field should be missing
                assert!(!(has_name && has_type && has_value));
            }
        }

        #[test]
        fn test_invalid_field_types() {
            let invalid_records = vec![
                json!({
                    "__name__": null,
                    "__type__": "counter",
                    "value": 1.0
                }),
                json!({
                    "__name__": "test",
                    "__type__": null,
                    "value": 1.0
                }),
                json!({
                    "__name__": "test",
                    "__type__": "counter",
                    "value": null
                }),
            ];

            for record in invalid_records {
                // Check that the fields exist but have wrong types
                assert!(record.get("__name__").is_some());
                assert!(record.get("__type__").is_some());
                assert!(record.get("value").is_some());

                // But at least one should be null
                let name_is_null = record["__name__"].is_null();
                let type_is_null = record["__type__"].is_null();
                let value_is_null = record["value"].is_null();

                assert!(name_is_null || type_is_null || value_is_null);
            }
        }

        #[test]
        fn test_empty_json_object() {
            let empty_record = json!({});

            assert!(empty_record.is_object());
            assert_eq!(empty_record.as_object().unwrap().len(), 0);

            // All required fields should be missing
            assert!(empty_record.get("__name__").is_none());
            assert!(empty_record.get("__type__").is_none());
            assert!(empty_record.get("value").is_none());
            assert!(empty_record.get("_timestamp").is_none());
        }
    }

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_extremely_long_metric_names() {
            let long_name = "a".repeat(1000);
            let record = create_test_metric_record(&long_name, "counter", 1.0, vec![]);

            assert_eq!(record["__name__"].as_str().unwrap().len(), 1000);
            assert_eq!(record["__name__"], long_name);
        }

        #[test]
        fn test_extremely_long_label_values() {
            let long_value = "x".repeat(10000);
            let record = create_test_metric_record(
                "long_labels",
                "gauge",
                1.0,
                vec![("long_label", &long_value)],
            );

            assert_eq!(record["long_label"].as_str().unwrap().len(), 10000);
            assert_eq!(record["long_label"], long_value);
        }

        #[test]
        fn test_many_labels() {
            let mut labels = vec![];
            for i in 0..100 {
                labels.push((format!("label_{i}"), format!("value_{i}")));
            }

            let labels_ref: Vec<(&str, &str)> = labels
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();

            let record = create_test_metric_record("many_labels", "histogram", 1.0, labels_ref);

            // Should have 4 required fields + 100 labels
            assert_eq!(record.as_object().unwrap().len(), 104);

            // Verify all labels are present
            for i in 0..100 {
                let label_key = format!("label_{i}");
                let expected_value = format!("value_{i}");
                assert_eq!(record[&label_key], expected_value);
            }
        }

        #[test]
        fn test_duplicate_label_handling() {
            // Test what happens when we try to create a record with duplicate keys
            // This tests our helper function's behavior with duplicates
            let labels_with_duplicates = vec![
                ("service", "web"),
                ("service", "api"), // duplicate key
                ("env", "prod"),
            ];

            let record =
                create_test_metric_record("duplicate_test", "counter", 1.0, labels_with_duplicates);

            // The last value should win (HashMap behavior)
            assert_eq!(record["service"], "api");
            assert_eq!(record["env"], "prod");
        }

        #[test]
        fn test_reserved_field_name_conflicts() {
            // Test what happens when labels have same names as reserved fields
            let conflicting_labels = vec![
                ("__name__", "conflicting_name"), // This should overwrite
                ("__type__", "conflicting_type"),
                ("value", "conflicting_value"),
                ("_timestamp", "conflicting_timestamp"),
            ];

            let record = create_test_metric_record(
                "original_name",
                "original_type",
                42.0,
                conflicting_labels,
            );

            // Our helper function should overwrite with the original values
            // The behavior depends on the order of insertion in our helper
            assert!(record.get("__name__").is_some());
            assert!(record.get("__type__").is_some());
            assert!(record.get("value").is_some());
            assert!(record.get("_timestamp").is_some());
        }
    }

    mod performance_tests {
        use super::*;

        #[test]
        fn test_large_record_creation() {
            // Test creating a record with many labels efficiently
            let mut large_labels = vec![];
            for i in 0..1000 {
                large_labels.push((
                    format!("metric_label_with_long_name_{i:04}"),
                    format!("metric_value_with_long_content_{i:04}"),
                ));
            }

            let labels_ref: Vec<(&str, &str)> = large_labels
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();

            let start = std::time::Instant::now();
            let record =
                create_test_metric_record("performance_test", "gauge", 123.456, labels_ref);
            let duration = start.elapsed();

            // Should complete within reasonable time (less than 100ms)
            assert!(duration.as_millis() < 100);

            // Verify the record was created correctly
            assert_eq!(record["__name__"], "performance_test");
            assert_eq!(record.as_object().unwrap().len(), 1004); // 4 required + 1000 labels
        }

        #[test]
        fn test_json_serialization_performance() {
            let record = create_test_metric_record(
                "serialization_test",
                "counter",
                999.999,
                vec![
                    ("high_cardinality_label_1", "value_1"),
                    ("high_cardinality_label_2", "value_2"),
                    ("high_cardinality_label_3", "value_3"),
                ],
            );

            let start = std::time::Instant::now();
            let serialized = serde_json::to_string(&record);
            let duration = start.elapsed();

            assert!(serialized.is_ok());
            assert!(duration.as_micros() < 1000); // Should be very fast

            let json_string = serialized.unwrap();
            assert!(json_string.contains("serialization_test"));
            assert!(json_string.contains("999.999"));
        }
    }
}
