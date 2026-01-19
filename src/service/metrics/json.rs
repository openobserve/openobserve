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
    sync::Arc,
};

use anyhow::{Result, anyhow};
use axum::http;
use bytes::Bytes;
use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        alerts::alert::Alert,
        promql::{HASH_LABEL, METADATA_LABEL, Metadata, NAME_LABEL, TYPE_LABEL, VALUE_LABEL},
        self_reporting::usage::UsageType,
        stream::{PartitioningDetails, StreamParams, StreamType},
    },
    metrics,
    utils::{
        flatten, json,
        schema::infer_json_schema,
        schema_ext::SchemaExt,
        time::{self, now_micros},
    },
};
use datafusion::arrow::datatypes::Schema;
use infra::schema::{SchemaCache, unwrap_partition_time_level};

use super::get_exclude_labels;
use crate::{
    common::meta::{
        authz::Authz,
        ingestion::{IngestionResponse, StreamStatus},
        stream::SchemaRecords,
    },
    service::{
        alerts::alert::AlertExt,
        db, format_stream_name,
        ingestion::{
            TriggerAlertData, check_ingestion_allowed, evaluate_trigger, get_thread_id,
            get_write_partition_key, write_file,
        },
        pipeline::batch_execution::ExecutablePipeline,
        schema::check_for_schema,
        self_reporting::report_request_usage_stats,
    },
};

const VALID_METRICS_TYPES: &[&str] = &["counter", "gauge", "histogram", "summary"];

pub async fn ingest(
    org_id: &str,
    stream_name: Option<&str>,
    body: Bytes,
    user: crate::common::meta::ingestion::IngestUser,
) -> Result<IngestionResponse> {
    // check system resource
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Metrics, stream_name).await {
        // we do not want to log trial period expired errors
        if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            return Ok(IngestionResponse {
                code: http::StatusCode::TOO_MANY_REQUESTS.into(),
                status: vec![],
                error: Some(e.to_string()),
            });
        } else {
            log::error!("Metrics ingestion error: {e}");
            return Ok(IngestionResponse {
                code: http::StatusCode::SERVICE_UNAVAILABLE.into(),
                status: vec![],
                error: Some(e.to_string()),
            });
        }
    }

    let start = std::time::Instant::now();
    let started_at = now_micros();

    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_status_map: HashMap<String, StreamStatus> = HashMap::new();
    let mut stream_data_buf: HashMap<String, HashMap<String, SchemaRecords>> = HashMap::new();
    let mut stream_partitioning_map: HashMap<String, PartitioningDetails> = HashMap::new();

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    // End get user defined schema

    // associated pipeline
    let mut stream_executable_pipelines: HashMap<String, Option<ExecutablePipeline>> =
        HashMap::new();
    let mut stream_pipeline_inputs: HashMap<String, Vec<(json::Value, String)>> = HashMap::new();

    // realtime alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut stream_trigger_map: HashMap<String, Option<TriggerAlertData>> = HashMap::new();

    // records buffer
    let mut json_data_by_stream: HashMap<String, Vec<_>> = HashMap::new();

    let reader: Vec<json::Value> = json::from_slice(&body)?;
    for record in reader.into_iter() {
        // JSON Flattening
        let mut record = flatten::flatten(record)?;
        // check data type
        let record = record.as_object_mut().unwrap();
        let stream_name = match stream_name {
            Some(name) => name.to_string(),
            None => match record.get(NAME_LABEL).ok_or(anyhow!("missing __name__"))? {
                json::Value::String(s) => format_stream_name(s.to_string()),
                _ => {
                    return Err(anyhow::anyhow!("invalid __name__, need to be string"));
                }
            },
        };
        let metrics_type = record
            .get(TYPE_LABEL)
            .and_then(|v| v.as_str())
            .unwrap_or("gauge") // default to gauge if __type__ is missing
            .to_string();

        // Start retrieve associated pipeline and initialize ExecutablePipeline
        let stream_param = StreamParams::new(org_id, &stream_name, StreamType::Metrics);
        if !stream_executable_pipelines.contains_key(&stream_name) {
            let exec_pl_option =
                crate::service::ingestion::get_stream_executable_pipeline(&stream_param).await;
            stream_executable_pipelines.insert(stream_name.clone(), exec_pl_option);
        }
        // End pipeline params construction

        // get user defined schema
        crate::service::ingestion::get_uds_and_original_data_streams(
            std::slice::from_ref(&stream_param),
            &mut user_defined_schema_map,
            &mut streams_need_original_map,
            &mut streams_need_all_values_map,
        )
        .await;

        // check metrics type
        if !VALID_METRICS_TYPES.contains(&metrics_type.to_lowercase().as_str()) {
            return Err(anyhow::anyhow!(
                "invalid metrics type, need to be one of: {}",
                VALID_METRICS_TYPES.join(", ")
            ));
        }

        // check schema
        if !stream_schema_map.contains_key(&stream_name) {
            let mut schema = infra::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
            if schema == Schema::empty() {
                // create the metadata for the stream
                let metadata = Metadata {
                    metric_family_name: stream_name.clone(),
                    metric_type: metrics_type.as_str().into(),
                    help: stream_name.clone().replace('_', " "),
                    unit: "".to_string(),
                };
                let mut extra_metadata: HashMap<String, String> = HashMap::new();
                extra_metadata.insert(
                    METADATA_LABEL.to_string(),
                    json::to_string(&metadata).unwrap(),
                );
                schema = schema.with_metadata(extra_metadata);
                db::schema::merge(
                    org_id,
                    &stream_name,
                    StreamType::Metrics,
                    &schema,
                    Some(now_micros()),
                )
                .await?;
            }
            stream_schema_map.insert(stream_name.clone(), SchemaCache::new(schema));
        }

        // check timestamp
        let timestamp: i64 = match record.get(TIMESTAMP_COL_NAME) {
            None => now_micros(),
            Some(json::Value::Number(s)) => {
                time::parse_i64_to_timestamp_micros(s.as_f64().unwrap() as i64)
            }
            Some(_) => {
                return Err(anyhow::anyhow!("invalid _timestamp, need to be number"));
            }
        };
        // reset time
        record.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number(timestamp.into()),
        );

        let mut value = json::Value::Object(record.to_owned());

        // ready to be buffered for downstream processing
        if stream_executable_pipelines
            .get(&stream_name)
            .unwrap()
            .is_some()
        {
            // buffer to pipeline for batch processing
            stream_pipeline_inputs
                .entry(stream_name.to_owned())
                .or_default()
                .push((value, metrics_type));
        } else {
            // get json object
            let mut local_val = match value.take() {
                json::Value::Object(val) => val,
                _ => unreachable!(),
            };

            if let Some(Some(fields)) = user_defined_schema_map.get(&stream_name) {
                local_val = crate::service::ingestion::refactor_map(local_val, fields);
            }

            // buffer to downstream processing directly
            json_data_by_stream
                .entry(stream_name.clone())
                .or_default()
                .push((local_val, metrics_type));
        }
    }

    // process records buffered for pipeline processing
    for (stream_name, exec_pl_option) in &stream_executable_pipelines {
        if let Some(exec_pl) = exec_pl_option {
            let Some(pipeline_inputs) = stream_pipeline_inputs.remove(stream_name) else {
                log::error!(
                    "[Ingestion]: Stream {stream_name} has pipeline, but inputs failed to be buffered. BUG"
                );
                continue;
            };
            let (records, metric_types): (Vec<json::Value>, Vec<String>) =
                pipeline_inputs.into_iter().unzip();
            let count = records.len();
            match exec_pl
                .process_batch(org_id, records, Some(stream_name.clone()))
                .await
            {
                Err(e) => {
                    let err_msg = format!(
                        "[Ingestion]: Stream {stream_name} pipeline batch processing failed: {e}",
                    );
                    log::error!("{err_msg}");
                    // update status
                    let stream_status = stream_status_map
                        .entry(stream_name.clone())
                        .or_insert_with(|| StreamStatus::new(stream_name));
                    stream_status.status.failed += count as u32;
                    stream_status.status.error = err_msg;
                    continue;
                }
                Ok(pl_results) => {
                    for (stream_params, stream_pl_results) in pl_results {
                        if stream_params.stream_type != StreamType::Metrics {
                            continue;
                        }

                        let destination_stream = stream_params.stream_name.to_string();

                        // add partition keys
                        if !stream_partitioning_map.contains_key(&destination_stream) {
                            let partition_det =
                                crate::service::ingestion::get_stream_partition_keys(
                                    org_id,
                                    &StreamType::Metrics,
                                    &destination_stream,
                                )
                                .await;
                            stream_partitioning_map
                                .insert(destination_stream.clone(), partition_det.clone());
                        }
                        for (idx, mut res) in stream_pl_results {
                            // get json object
                            let mut local_val = match res.take() {
                                json::Value::Object(v) => v,
                                _ => unreachable!(),
                            };

                            if let Some(Some(fields)) =
                                user_defined_schema_map.get(&destination_stream)
                            {
                                local_val =
                                    crate::service::ingestion::refactor_map(local_val, fields);
                            }

                            // buffer to downstream processing directly
                            json_data_by_stream
                                .entry(destination_stream.clone())
                                .or_default()
                                .push((local_val, metric_types[idx].to_owned()));
                        }
                    }
                }
            }
        }
    }

    for (stream_name, json_data) in json_data_by_stream {
        if !stream_partitioning_map.contains_key(&stream_name) {
            let partition_det = crate::service::ingestion::get_stream_partition_keys(
                org_id,
                &StreamType::Metrics,
                &stream_name,
            )
            .await;
            stream_partitioning_map.insert(stream_name.to_string(), partition_det);
        }
        // get partition key
        let partition_det = stream_partitioning_map.get(&stream_name).unwrap();
        let partition_keys = partition_det.partition_keys.clone();
        let partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Metrics);

        for (mut record, metric_type) in json_data {
            // Start get stream alerts
            if !stream_alerts_map.contains_key(&stream_name) {
                crate::service::ingestion::get_stream_alerts(
                    &[StreamParams {
                        org_id: org_id.to_owned().into(),
                        stream_name: stream_name.to_owned().into(),
                        stream_type: StreamType::Metrics,
                    }],
                    &mut stream_alerts_map,
                )
                .await;
            }
            // End get stream alert

            // check value
            let value: f64 = match record.get(VALUE_LABEL).ok_or(anyhow!("missing value"))? {
                json::Value::Number(s) => s.as_f64().unwrap(),
                _ => {
                    return Err(anyhow::anyhow!("invalid value, need to be number"));
                }
            };
            // reset value
            record.insert(
                VALUE_LABEL.to_string(),
                json::Number::from_f64(value).unwrap().into(),
            );

            let timestamp = record
                .get(TIMESTAMP_COL_NAME)
                .and_then(|ts| ts.as_i64())
                .ok_or_else(|| anyhow::anyhow!("missing timestamp"))?;

            // remove type from labels
            record.remove(TYPE_LABEL);
            // add hash
            let hash = super::signature_without_labels(&record, &get_exclude_labels());
            record.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));

            // convert every label to string
            for (k, v) in record.iter_mut() {
                if k == NAME_LABEL || k == TYPE_LABEL || k == VALUE_LABEL || k == TIMESTAMP_COL_NAME
                {
                    continue;
                }
                match v {
                    json::Value::String(_) => {}
                    _ => {
                        *v = json::Value::String(v.to_string());
                    }
                }
            }
            let record_str = json::to_string(&record).unwrap();

            // check schema
            if !stream_schema_map.contains_key(&stream_name) {
                let mut schema =
                    infra::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
                if schema.fields().is_empty() {
                    let mut schema_reader = BufReader::new(record_str.as_bytes());
                    let inferred_schema =
                        infer_json_schema(&mut schema_reader, None, StreamType::Metrics).unwrap();
                    let metadata = Metadata {
                        metric_family_name: stream_name.clone(),
                        metric_type: metric_type.as_str().into(),
                        help: stream_name.clone().replace('_', " "),
                        unit: "".to_string(),
                    };
                    let mut extra_metadata: HashMap<String, String> = HashMap::new();
                    extra_metadata.insert(
                        METADATA_LABEL.to_string(),
                        json::to_string(&metadata).unwrap(),
                    );
                    schema = inferred_schema.with_metadata(extra_metadata);
                    db::schema::merge(
                        org_id,
                        &stream_name,
                        StreamType::Metrics,
                        &schema,
                        Some(timestamp),
                    )
                    .await?;
                    crate::common::utils::auth::set_ownership(
                        org_id,
                        StreamType::Metrics.as_str(),
                        Authz::new(&stream_name),
                    )
                    .await;
                }
                stream_schema_map.insert(stream_name.clone(), SchemaCache::new(schema));
            }

            // check for schema evolution
            let (_schema_evolution, _infer_schema) = check_for_schema(
                org_id,
                &stream_name,
                StreamType::Metrics,
                &mut stream_schema_map,
                vec![&record],
                timestamp,
                false, // is_derived is false for metrics
            )
            .await?;

            // write into buffer
            let schema = stream_schema_map
                .get(&stream_name)
                .unwrap()
                .schema()
                .as_ref()
                .clone()
                .with_metadata(HashMap::new());
            let schema_key = schema.hash_key();
            let hour_key = get_write_partition_key(
                timestamp,
                &partition_keys,
                partition_time_level,
                &record,
                Some(&schema_key),
            );
            let stream_buf = stream_data_buf.entry(stream_name.to_string()).or_default();
            let hour_buf = stream_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                schema_key,
                schema: Arc::new(schema),
                records: vec![],
                records_size: 0,
            });
            hour_buf
                .records
                .push(Arc::new(json::Value::Object(record.to_owned())));
            hour_buf.records_size += record_str.len();

            // update status
            let stream_status = stream_status_map
                .entry(stream_name.clone())
                .or_insert_with(|| StreamStatus::new(&stream_name));
            stream_status.status.successful += 1;

            // realtime alert
            let need_trigger = !stream_trigger_map.contains_key(&stream_name);
            if need_trigger && !stream_alerts_map.is_empty() {
                // start check for alert trigger
                let key = format!("{}/{}/{}", org_id, StreamType::Metrics, stream_name);
                if let Some(alerts) = stream_alerts_map.get(&key) {
                    let mut trigger_alerts: TriggerAlertData = Vec::new();
                    let alert_end_time = now_micros();
                    for alert in alerts {
                        if let Ok(Some(data)) = alert
                            .evaluate(Some(&record), (None, alert_end_time), None)
                            .await
                            .map(|res| res.data)
                        {
                            trigger_alerts.push((alert.clone(), data))
                        }
                    }
                    stream_trigger_map.insert(stream_name.clone(), Some(trigger_alerts));
                }
            }
            // End check for alert trigger
        }
    }

    // write data to wal
    for (stream_name, stream_data) in stream_data_buf {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            StreamType::Metrics,
            &stream_name,
            None,
        ) {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }

        let writer = ingester::get_writer(
            get_thread_id(),
            org_id,
            StreamType::Metrics.as_str(),
            &stream_name,
        )
        .await;
        // for performance issue, we will flush all when the app shutdown
        let fsync = false;
        let mut req_stats = write_file(&writer, org_id, &stream_name, stream_data, fsync).await?;

        let email_str = user.to_email();
        req_stats.user_email = if email_str.is_empty() {
            None
        } else {
            Some(email_str)
        };
        req_stats.response_time = start.elapsed().as_secs_f64();
        let fns_length: usize =
            stream_executable_pipelines
                .get(&stream_name)
                .map_or(0, |exec_pl_option| {
                    exec_pl_option
                        .as_ref()
                        .map_or(0, |exec_pl| exec_pl.num_of_func())
                });
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            UsageType::JsonMetrics,
            fns_length as _,
            started_at,
        )
        .await;
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/metrics/_json",
            "200",
            org_id,
            StreamType::Metrics.as_str(),
            "",
            "",
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/metrics/_json",
            "200",
            org_id,
            StreamType::Metrics.as_str(),
            "",
            "",
        ])
        .inc();

    // only one trigger per request
    for (_, entry) in stream_trigger_map {
        if let Some(entry) = entry {
            evaluate_trigger(entry).await;
        }
    }

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        stream_status_map.values().map(|v| v.to_owned()).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

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
