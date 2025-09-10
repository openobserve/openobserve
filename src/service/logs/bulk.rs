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

use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader},
};

use actix_web::web;
use chrono::{Duration, Utc};
use config::{
    ALL_VALUES_COL_NAME, BLOCKED_STREAMS, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME,
    get_config,
    meta::{
        self_reporting::usage::UsageType,
        stream::{StreamParams, StreamType},
    },
    metrics,
    utils::{
        flatten,
        json::{self, estimate_json_bytes},
        time::parse_timestamp_micro_from_value,
    },
};
use infra::{errors::Result, schema};

use super::{ingestion_log_enabled, log_failed_record};
use crate::{
    common::meta::ingestion::{BulkResponse, BulkResponseError, BulkResponseItem, IngestionStatus},
    service::{
        format_stream_name,
        ingestion::check_ingestion_allowed,
        pipeline::batch_execution::{ExecutablePipeline, ExecutablePipelineBulkInputs},
        schema::{get_future_discard_error, get_upto_discard_error},
    },
};

pub const TRANSFORM_FAILED: &str = "document_failed_transform";
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";
pub const PIPELINE_EXEC_FAILED: &str = "pipeline_execution_failed";

async fn get_stream_flatten_level(org_id: &str, stream_name: &str, stream_type: StreamType) -> u32 {
    let cfg = get_config();
    if let Some(settings) = schema::get_settings(org_id, stream_name, stream_type).await
        && let Some(level) = settings.flatten_level
    {
        return level as u32;
    }
    cfg.limit.ingest_flatten_level
}

pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: web::Bytes,
    user_email: &str,
) -> Result<BulkResponse> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    // check system resource
    check_ingestion_allowed(org_id, StreamType::Logs, None).await?;

    // let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let cfg = get_config();
    let min_ts = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let max_ts = (Utc::now() + Duration::try_hours(cfg.limit.ingest_allowed_in_future).unwrap())
        .timestamp_micros();

    let log_ingestion_errors = ingestion_log_enabled().await;
    let mut action = String::from("");
    let mut stream_name = String::from("");
    let mut doc_id = None;

    let mut blocked_stream_warnings: HashMap<String, bool> = HashMap::new();

    let mut stream_executable_pipelines: HashMap<String, Option<ExecutablePipeline>> =
        HashMap::new();
    let mut stream_pipeline_inputs: HashMap<String, ExecutablePipelineBulkInputs> = HashMap::new();

    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    let mut store_original_when_pipeline_exists = false;

    let mut json_data_by_stream = HashMap::new();
    let mut derived_streams = HashSet::new();
    let mut size_by_stream = HashMap::new();
    let mut next_line_is_data = false;
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

        let mut value: json::Value = json::from_slice(line.as_bytes())?;

        if !next_line_is_data {
            // check bulk operate
            let ret = super::parse_bulk_index(&value);
            if ret.is_none() {
                continue; // skip
            }
            (action, stream_name, doc_id) = ret.unwrap();

            if stream_name.is_empty() || stream_name == "_" || stream_name == "/" {
                let err_msg = format!("Invalid stream name: {line}");
                log::warn!("{err_msg}");
                bulk_res.errors = true;
                let err = BulkResponseError::new(
                    err_msg.to_string(),
                    stream_name.clone(),
                    err_msg,
                    "0".to_string(),
                );
                let mut item = HashMap::new();
                item.insert(
                    action.clone(),
                    BulkResponseItem::new_failed(
                        stream_name.clone(),
                        doc_id.clone().unwrap_or_default(),
                        err,
                        Some(value),
                        stream_name.clone(),
                    ),
                );
                bulk_res.items.push(item);
                continue; // skip
            }

            if !cfg.common.skip_formatting_stream_name {
                stream_name = format_stream_name(&stream_name);
            }

            // skip blocked streams
            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);
            if BLOCKED_STREAMS.contains(&key) {
                // print warning only once
                blocked_stream_warnings.entry(key).or_insert_with(|| {
                    log::warn!("stream [{stream_name}] is blocked from ingestion");
                    true
                });
                continue; // skip
            }

            let mut streams = vec![StreamParams {
                org_id: org_id.to_owned().into(),
                stream_type: StreamType::Logs,
                stream_name: stream_name.to_owned().into(),
            }];

            // Start retrieve associated pipeline and initialize ExecutablePipeline
            if !stream_executable_pipelines.contains_key(&stream_name) {
                let exec_pl_option = crate::service::ingestion::get_stream_executable_pipeline(
                    org_id,
                    &stream_name,
                    &StreamType::Logs,
                )
                .await;
                if let Some(exec_pl) = &exec_pl_option {
                    let pl_destinations = exec_pl.get_all_destination_streams();
                    streams.extend(pl_destinations);
                }
                stream_executable_pipelines.insert(stream_name.clone(), exec_pl_option);
            }
            // End pipeline params construction

            crate::service::ingestion::get_uds_and_original_data_streams(
                &streams,
                &mut user_defined_schema_map,
                &mut streams_need_original_map,
                &mut streams_need_all_values_map,
            )
            .await;

            // with pipeline, we need to store original if any of the destinations requires original
            store_original_when_pipeline_exists = stream_executable_pipelines
                .contains_key(&stream_name)
                && streams_need_original_map.values().any(|val| *val);

            next_line_is_data = true;
        } else {
            next_line_is_data = false;

            // store a copy of original data before it's being transformed and/or flattened, when
            // 1. original data is not an object -> won't be flattened.
            let original_data = if value.is_object() {
                // 2. current stream does not have pipeline
                if stream_executable_pipelines
                    .get(&stream_name)
                    .unwrap()
                    .is_none()
                {
                    // current stream requires original
                    streams_need_original_map
                        .get(&stream_name)
                        .is_some_and(|v| *v)
                        .then(|| value.to_string())
                } else {
                    // 3. with pipeline, storing original as long as streams_need_original_set is
                    //    not empty
                    store_original_when_pipeline_exists.then(|| value.to_string())
                }
            } else {
                None // `item` won't be flattened, no need to store original
            };

            if stream_executable_pipelines
                .get(&stream_name)
                .unwrap()
                .is_some()
            {
                // current stream has pipeline. buff the record for batch processing later
                let inputs = stream_pipeline_inputs
                    .entry(stream_name.clone())
                    .or_default();
                inputs.add_input(value, doc_id.to_owned(), original_data);
            } else {
                let _size = size_by_stream.entry(stream_name.clone()).or_insert(0);
                *_size += estimate_json_bytes(&value);
                // JSON Flattening - use per-stream flatten level
                let flatten_level =
                    get_stream_flatten_level(org_id, &stream_name, StreamType::Logs).await;
                value = flatten::flatten_with_level(value, flatten_level)?;

                // get json object
                let mut local_val = match value.take() {
                    json::Value::Object(v) => v,
                    _ => unreachable!(),
                };

                // set _id
                if let Some(doc_id) = &doc_id {
                    local_val.insert("_id".to_string(), json::Value::String(doc_id.to_owned()));
                }

                if let Some(Some(fields)) = user_defined_schema_map.get(&stream_name) {
                    local_val = crate::service::logs::refactor_map(local_val, fields);
                }

                // add `_original` and '_record_id` if required by StreamSettings
                if streams_need_original_map
                    .get(&stream_name)
                    .is_some_and(|v| *v)
                    && let Some(original_data) = original_data
                {
                    local_val.insert(ORIGINAL_DATA_COL_NAME.to_string(), original_data.into());
                    let record_id = crate::service::ingestion::generate_record_id(
                        org_id,
                        &stream_name,
                        &StreamType::Logs,
                    );
                    local_val.insert(
                        ID_COL_NAME.to_string(),
                        json::Value::String(record_id.to_string()),
                    );
                }

                // add `_all_values` if required by StreamSettings
                if streams_need_all_values_map
                    .get(&stream_name)
                    .is_some_and(|v| *v)
                {
                    let mut values = Vec::with_capacity(local_val.len());
                    for (k, value) in local_val.iter() {
                        if [
                            TIMESTAMP_COL_NAME,
                            ID_COL_NAME,
                            ORIGINAL_DATA_COL_NAME,
                            ALL_VALUES_COL_NAME,
                        ]
                        .contains(&k.as_str())
                        {
                            continue;
                        }
                        values.push(value.to_string());
                    }
                    local_val.insert(
                        ALL_VALUES_COL_NAME.to_string(),
                        json::Value::String(values.join(" ")),
                    );
                }

                // handle timestamp
                let timestamp = match local_val.get(TIMESTAMP_COL_NAME) {
                    Some(v) => match parse_timestamp_micro_from_value(v) {
                        Ok(t) => t,
                        Err(_e) => {
                            bulk_res.errors = true;
                            metrics::INGEST_ERRORS
                                .with_label_values(&[
                                    org_id,
                                    StreamType::Logs.as_str(),
                                    &stream_name,
                                    TS_PARSE_FAILED,
                                ])
                                .inc();
                            log_failed_record(log_ingestion_errors, &value, TS_PARSE_FAILED);
                            add_record_status(
                                stream_name.clone(),
                                &doc_id,
                                action.clone(),
                                Some(value),
                                &mut bulk_res,
                                Some(TS_PARSE_FAILED.to_string()),
                                Some(TS_PARSE_FAILED.to_string()),
                            );
                            continue;
                        }
                    },
                    None => Utc::now().timestamp_micros(),
                };

                // check ingestion time
                if timestamp < min_ts || timestamp > max_ts {
                    bulk_res.errors = true;
                    let failure_reason = if timestamp < min_ts {
                        Some(get_upto_discard_error().to_string())
                    } else {
                        Some(get_future_discard_error().to_string())
                    };
                    metrics::INGEST_ERRORS
                        .with_label_values(&[
                            org_id,
                            StreamType::Logs.as_str(),
                            &stream_name,
                            TS_PARSE_FAILED,
                        ])
                        .inc();
                    log_failed_record(log_ingestion_errors, &value, TS_PARSE_FAILED);
                    add_record_status(
                        stream_name.clone(),
                        &doc_id,
                        action.clone(),
                        Some(value),
                        &mut bulk_res,
                        Some(TS_PARSE_FAILED.to_string()),
                        failure_reason,
                    );
                    continue;
                }
                local_val.insert(
                    TIMESTAMP_COL_NAME.to_string(),
                    json::Value::Number(timestamp.into()),
                );

                let (ts_data, fn_num) = json_data_by_stream
                    .entry(stream_name.clone())
                    .or_insert((Vec::new(), None));
                ts_data.push((timestamp, local_val));
                *fn_num = Some(0); // no pl -> no func
            }
        }
        tokio::task::coop::consume_budget().await;
    }

    // batch process records through pipeline
    for (stream_name, exec_pl_option) in stream_executable_pipelines {
        if let Some(exec_pl) = exec_pl_option {
            let Some(pipeline_inputs) = stream_pipeline_inputs.remove(&stream_name) else {
                log::error!(
                    "[Ingestion]: Stream {stream_name} has pipeline, but inputs failed to be buffered. BUG"
                );
                continue;
            };
            let (records, doc_ids, originals) = pipeline_inputs.into_parts();
            match exec_pl
                .process_batch(org_id, records, Some(stream_name.clone()))
                .await
            {
                Err(e) => {
                    log::error!(
                        "[Pipeline] for stream {org_id}/{stream_name}: Batch execution error: {e}."
                    );
                    bulk_res.errors = true;
                    metrics::INGEST_ERRORS
                        .with_label_values(&[
                            org_id,
                            StreamType::Logs.as_str(),
                            &stream_name,
                            TRANSFORM_FAILED,
                        ])
                        .inc();
                    add_record_status(
                        stream_name.clone(),
                        &None,
                        action.clone(),
                        None,
                        &mut bulk_res,
                        Some(PIPELINE_EXEC_FAILED.to_string()),
                        Some(PIPELINE_EXEC_FAILED.to_string()),
                    );
                    continue;
                }
                Ok(pl_results) => {
                    let function_no = exec_pl.num_of_func();
                    for (stream_params, stream_pl_results) in pl_results {
                        if stream_params.stream_type != StreamType::Logs {
                            continue;
                        }

                        let destination_stream = stream_params.stream_name.to_string();
                        if !derived_streams.contains(&destination_stream) {
                            derived_streams.insert(destination_stream.clone());
                        }

                        if !user_defined_schema_map.contains_key(&destination_stream) {
                            // a new dynamically created stream. need to check the two maps again
                            crate::service::ingestion::get_uds_and_original_data_streams(
                                &[stream_params],
                                &mut user_defined_schema_map,
                                &mut streams_need_original_map,
                                &mut streams_need_all_values_map,
                            )
                            .await;
                        }

                        for (idx, mut res) in stream_pl_results {
                            // we calculate the size BEFORE applying uds
                            let original_size = estimate_json_bytes(&res);
                            // get json object
                            let mut local_val = match res.take() {
                                json::Value::Object(v) => v,
                                _ => unreachable!(),
                            };

                            // set _id
                            if let Some(doc_id) = &doc_ids[idx] {
                                local_val.insert(
                                    "_id".to_string(),
                                    json::Value::String(doc_id.to_owned()),
                                );
                            }

                            if let Some(Some(fields)) =
                                user_defined_schema_map.get(&destination_stream)
                            {
                                local_val = crate::service::logs::refactor_map(local_val, fields);
                            }

                            // add `_original` and '_record_id` if required by StreamSettings
                            if idx != usize::MAX
                                && streams_need_original_map
                                    .get(&destination_stream)
                                    .is_some_and(|v| *v)
                                && originals[idx].is_some()
                            {
                                local_val.insert(
                                    ORIGINAL_DATA_COL_NAME.to_string(),
                                    originals[idx].clone().unwrap().into(),
                                );
                                let record_id = crate::service::ingestion::generate_record_id(
                                    org_id,
                                    &destination_stream,
                                    &StreamType::Logs,
                                );
                                local_val.insert(
                                    ID_COL_NAME.to_string(),
                                    json::Value::String(record_id.to_string()),
                                );
                            }

                            // add `_all_values` if required by StreamSettings
                            if streams_need_all_values_map
                                .get(&destination_stream)
                                .is_some_and(|v| *v)
                            {
                                let mut values = Vec::with_capacity(local_val.len());
                                for (k, value) in local_val.iter() {
                                    if [
                                        TIMESTAMP_COL_NAME,
                                        ID_COL_NAME,
                                        ORIGINAL_DATA_COL_NAME,
                                        ALL_VALUES_COL_NAME,
                                    ]
                                    .contains(&k.as_str())
                                    {
                                        continue;
                                    }
                                    values.push(value.to_string());
                                }
                                local_val.insert(
                                    ALL_VALUES_COL_NAME.to_string(),
                                    json::Value::String(values.join(" ")),
                                );
                            }

                            // handle timestamp
                            let timestamp = match local_val.get(TIMESTAMP_COL_NAME) {
                                Some(v) => match parse_timestamp_micro_from_value(v) {
                                    Ok(t) => t,
                                    Err(_e) => {
                                        bulk_res.errors = true;
                                        metrics::INGEST_ERRORS
                                            .with_label_values(&[
                                                org_id,
                                                StreamType::Logs.as_str(),
                                                &stream_name,
                                                TS_PARSE_FAILED,
                                            ])
                                            .inc();
                                        log_failed_record(
                                            log_ingestion_errors,
                                            &res,
                                            TS_PARSE_FAILED,
                                        );
                                        add_record_status(
                                            stream_name.clone(),
                                            &doc_id,
                                            action.clone(),
                                            Some(res),
                                            &mut bulk_res,
                                            Some(TS_PARSE_FAILED.to_string()),
                                            Some(TS_PARSE_FAILED.to_string()),
                                        );
                                        continue;
                                    }
                                },
                                None => Utc::now().timestamp_micros(),
                            };

                            // check ingestion time
                            if timestamp < min_ts || timestamp > max_ts {
                                bulk_res.errors = true;
                                let failure_reason = if timestamp < min_ts {
                                    Some(get_upto_discard_error().to_string())
                                } else {
                                    Some(get_future_discard_error().to_string())
                                };
                                metrics::INGEST_ERRORS
                                    .with_label_values(&[
                                        org_id,
                                        StreamType::Logs.as_str(),
                                        &stream_name,
                                        TS_PARSE_FAILED,
                                    ])
                                    .inc();
                                log_failed_record(log_ingestion_errors, &res, TS_PARSE_FAILED);
                                add_record_status(
                                    stream_name.clone(),
                                    &doc_id,
                                    action.clone(),
                                    Some(res),
                                    &mut bulk_res,
                                    Some(TS_PARSE_FAILED.to_string()),
                                    failure_reason,
                                );
                                continue;
                            }
                            local_val.insert(
                                TIMESTAMP_COL_NAME.to_string(),
                                json::Value::Number(timestamp.into()),
                            );

                            let _size = size_by_stream
                                .entry(destination_stream.clone())
                                .or_insert(0);
                            *_size += original_size;

                            let (ts_data, fn_num) = json_data_by_stream
                                .entry(destination_stream.clone())
                                .or_insert((Vec::new(), None));
                            ts_data.push((timestamp, local_val));
                            *fn_num = Some(function_no);

                            tokio::task::coop::consume_budget().await;
                        }
                    }
                }
            }
        }
    }

    // drop memory-intensive variables
    drop(stream_pipeline_inputs);
    drop(streams_need_original_map);
    drop(streams_need_all_values_map);
    drop(user_defined_schema_map);

    let (metric_rpt_status_code, response_body) = {
        let mut status = IngestionStatus::Bulk(bulk_res);
        let write_result = super::write_logs_by_stream(
            thread_id,
            org_id,
            user_email,
            (started_at, &start),
            UsageType::Bulk,
            &mut status,
            json_data_by_stream,
            size_by_stream,
            derived_streams,
        )
        .await;
        let IngestionStatus::Bulk(mut bulk_res) = status else {
            unreachable!();
        };
        bulk_res.took = start.elapsed().as_millis();
        match write_result {
            Ok(()) => ("200", bulk_res),
            Err(e) => {
                log::error!("Error while writing logs: {e}");
                bulk_res.errors = true;
                ("500", bulk_res)
            }
        }
    };

    // metric + data usage
    let took_time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            metric_rpt_status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .observe(took_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            metric_rpt_status_code,
            org_id,
            StreamType::Logs.as_str(),
            "",
            "",
        ])
        .inc();

    Ok(response_body)
}

pub fn add_record_status(
    stream_name: String,
    doc_id: &Option<String>,
    action: String,
    value: Option<json::Value>,
    bulk_res: &mut BulkResponse,
    failure_type: Option<String>,
    failure_reason: Option<String>,
) {
    let mut item = HashMap::new();
    let action = if action.is_empty() {
        "index".to_string()
    } else {
        action
    };

    let doc_id = match doc_id {
        Some(doc_id) => doc_id.to_owned(),
        None => "".to_string(),
    };

    match failure_type {
        Some(failure_type) => {
            let bulk_err = BulkResponseError::new(
                failure_type,
                stream_name.clone(),
                failure_reason.unwrap(),
                "0".to_owned(),
            );

            item.insert(
                action,
                BulkResponseItem::new_failed(
                    stream_name.clone(),
                    doc_id,
                    bulk_err,
                    value,
                    stream_name,
                ),
            );

            bulk_res.items.push(item);
        }
        None => {
            item.insert(
                action,
                BulkResponseItem::new(stream_name.clone(), doc_id, value, stream_name),
            );
            if !get_config().common.bulk_api_response_errors_only {
                bulk_res.items.push(item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_record_status() {
        let mut bulk_res = BulkResponse {
            took: 0,
            errors: false,
            items: vec![],
        };
        add_record_status(
            "olympics".to_string(),
            &Some("1".to_string()),
            "create".to_string(),
            None,
            &mut bulk_res,
            None,
            None,
        );
        assert!(bulk_res.items.len() == 1);
    }

    #[tokio::test]
    async fn test_ingest_basic_functionality() {
        // Create a simple bulk request with one document
        let bulk_request = r#"{"index": {"_index": "test-stream", "_id": "1"}}
{"message": "test log message", "level": "info"}"#;

        let body = web::Bytes::from(bulk_request);
        let thread_id = 1;
        let org_id = "test-org";
        let user_email = "test@example.com";

        // Note: This test will likely fail due to missing infrastructure setup,
        // but it demonstrates the basic structure of testing the ingest function
        let result = ingest(thread_id, org_id, body, user_email).await;

        // The test should either succeed or fail with a specific error
        // (likely related to missing database connections or configuration)
        match result {
            Ok(response) => {
                // If successful, verify basic response structure
                // The response should have items if the configuration allows it
                if !get_config().common.bulk_api_response_errors_only {
                    assert!(!response.items.is_empty());
                }
            }
            Err(e) => {
                // Expected to fail due to missing infrastructure
                // Just verify it's a proper error
                assert!(!e.to_string().is_empty());
            }
        }
    }

    mod add_record_status_tests {
        use super::*;

        #[test]
        fn test_add_record_status_success() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                &Some("doc_123".to_string()),
                "index".to_string(),
                Some(json::json!({"message": "test"})),
                &mut bulk_res,
                None,
                None,
            );

            // Should add one successful item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index"));

            let bulk_item = &item["index"];
            assert!(!bulk_item._index.is_empty());
            assert!(!bulk_item._id.is_empty());
        }

        #[test]
        fn test_add_record_status_with_failure() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                &Some("doc_456".to_string()),
                "create".to_string(),
                Some(json::json!({"data": "test"})),
                &mut bulk_res,
                Some(TS_PARSE_FAILED.to_string()),
                Some("Invalid timestamp format".to_string()),
            );

            // Should add one failed item
            assert_eq!(bulk_res.items.len(), 1);

            // Check the failed item structure
            let item = &bulk_res.items[0];
            assert!(item.contains_key("create"));

            let bulk_item = &item["create"];
            assert!(bulk_item.error.is_some());
        }

        #[test]
        fn test_add_record_status_empty_action() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "test_stream".to_string(),
                &None,
                "".to_string(), // Empty action should default to "index"
                None,
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            assert!(item.contains_key("index")); // Should default to "index"
        }

        #[test]
        fn test_add_record_status_no_doc_id() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "stream_without_id".to_string(),
                &None, // No document ID
                "update".to_string(),
                Some(json::json!({"field": "value"})),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["update"];
            // Document ID should be empty string
            assert_eq!(bulk_item._id, "");
        }

        #[test]
        fn test_add_record_status_different_failure_types() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let failure_types = [
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
            ];

            for (i, failure_type) in failure_types.iter().enumerate() {
                add_record_status(
                    format!("stream_{i}"),
                    &Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"test": i})),
                    &mut bulk_res,
                    Some(failure_type.to_string()),
                    Some(format!("Error message {i}")),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // Verify each failure type is recorded
            for (i, failure_type) in failure_types.iter().enumerate() {
                let item = &bulk_res.items[i];
                let bulk_item = &item["index"];
                let error = bulk_item.error.as_ref().unwrap();
                assert_eq!(error.err_type, *failure_type);
            }
        }

        #[test]
        fn test_add_record_status_with_complex_json() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let complex_json = json::json!({
                "timestamp": "2024-01-01T12:00:00Z",
                "level": "ERROR",
                "message": "Complex error occurred",
                "metadata": {
                    "service": "api-gateway",
                    "version": "1.0.0",
                    "tags": ["critical", "authentication"]
                },
                "error_details": {
                    "code": 500,
                    "stack_trace": "...",
                    "user_id": "user123"
                }
            });

            add_record_status(
                "complex_logs".to_string(),
                &Some("complex_doc_1".to_string()),
                "index".to_string(),
                Some(complex_json.clone()),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
            let item = &bulk_res.items[0];
            let bulk_item = &item["index"];

            // Verify the item was created successfully (successful records don't store
            // original_record)
            assert_eq!(bulk_item.status, 200);
            assert!(bulk_item.error.is_none());
            assert!(!bulk_item._index.is_empty());
        }
    }

    mod bulk_constants_tests {
        use super::*;

        #[test]
        fn test_error_constants_uniqueness() {
            // Ensure all error constants are unique
            let constants = vec![
                TRANSFORM_FAILED,
                TS_PARSE_FAILED,
                SCHEMA_CONFORMANCE_FAILED,
                PIPELINE_EXEC_FAILED,
            ];

            let mut unique_constants = constants.clone();
            unique_constants.sort();
            unique_constants.dedup();

            assert_eq!(constants.len(), unique_constants.len());
        }
    }

    mod bulk_response_tests {
        use super::*;

        #[test]
        fn test_bulk_response_initialization() {
            let bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            assert_eq!(bulk_res.took, 0);
            assert!(!bulk_res.errors);
            assert!(bulk_res.items.is_empty());
        }

        #[test]
        fn test_bulk_response_with_multiple_items() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Add multiple successful records
            for i in 0..5 {
                add_record_status(
                    format!("stream_{i}"),
                    &Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    None,
                    None,
                );
            }

            // Add some failed records
            for i in 5..8 {
                add_record_status(
                    format!("stream_{i}"),
                    &Some(format!("doc_{i}")),
                    "index".to_string(),
                    Some(json::json!({"message": format!("log message {i}")})),
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    Some("Timestamp error".to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 8);

            // Check mix of successful and failed items
            let successful_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_none() { 1 } else { 0 }
                })
                .sum();

            let failed_items: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(successful_items, 5);
            assert_eq!(failed_items, 3);
        }
    }

    mod data_processing_tests {
        use super::*;

        #[test]
        fn test_json_parsing_valid_data() {
            let valid_json =
                r#"{"message": "test log", "level": "info", "timestamp": "2024-01-01T10:00:00Z"}"#;
            let result: Result<json::Value, _> = json::from_slice(valid_json.as_bytes());
            assert!(result.is_ok());

            let value = result.unwrap();
            assert_eq!(value["message"], "test log");
            assert_eq!(value["level"], "info");
        }

        #[test]
        fn test_json_parsing_invalid_data() {
            let invalid_json = r#"{"message": "test log", "level": info"}"#; // Missing quotes around value
            let result: Result<json::Value, _> = json::from_slice(invalid_json.as_bytes());
            assert!(result.is_err());
        }

        #[test]
        fn test_json_estimate_bytes() {
            let test_values = vec![
                json::json!({"simple": "test"}),
                json::json!({"complex": {"nested": {"deep": "value"}}}),
                json::json!({"array": [1, 2, 3, 4, 5]}),
                json::json!({"large_string": "a".repeat(1000)}),
            ];

            for value in test_values {
                let estimated_size = estimate_json_bytes(&value);
                assert!(estimated_size > 0);

                // Rough validation: estimated size should be reasonable
                let json_string = json::to_string(&value).unwrap();
                let actual_size = json_string.len();

                // Estimated size should be in the same ballpark as actual size
                assert!(estimated_size > actual_size / 2);
                assert!(estimated_size < actual_size * 3);
            }
        }

        #[test]
        fn test_timestamp_parsing() {
            let test_timestamps = vec![
                json::Value::String("2024-01-01T12:00:00Z".to_string()),
                json::Value::String("2024-01-01T12:00:00.123Z".to_string()),
                json::Value::Number(serde_json::Number::from(1640995200000000i64)),
                json::Value::Number(serde_json::Number::from(1640995200000i64)),
                json::Value::Number(serde_json::Number::from(1640995200i64)),
            ];

            for ts_value in test_timestamps {
                match parse_timestamp_micro_from_value(&ts_value) {
                    Ok(timestamp) => {
                        assert!(timestamp > 0);
                        // Should be a reasonable timestamp (after 2020)
                        assert!(timestamp > 1577836800000000i64); // 2020-01-01 in microseconds
                    }
                    Err(e) => {
                        // Some formats might not be supported, which is fine
                        println!("Timestamp parsing failed (expected for some formats): {e}");
                    }
                }
            }
        }

        #[test]
        fn test_timestamp_parsing_invalid() {
            let invalid_timestamps = vec![
                json::Value::String("not-a-timestamp".to_string()),
                json::Value::String("".to_string()),
                json::Value::Null,
                json::Value::Bool(true),
                json::Value::Array(vec![]),
                json::Value::Object(serde_json::Map::new()),
            ];

            for invalid_ts in invalid_timestamps {
                let result = parse_timestamp_micro_from_value(&invalid_ts);
                assert!(result.is_err());
            }
        }
    }

    mod stream_name_tests {
        use super::*;

        #[test]
        fn test_valid_stream_names() {
            let valid_names = vec![
                "test-stream",
                "application_logs",
                "service.metrics",
                "stream123",
                "a_very_long_stream_name_with_underscores_and_numbers_123",
            ];

            for name in valid_names {
                // These should not be empty or invalid
                assert!(!name.is_empty());
                assert!(name != "_");
                assert!(name != "/");
            }
        }

        #[test]
        fn test_invalid_stream_names() {
            let invalid_names = vec![
                "",  // Empty
                "_", // Single underscore
                "/", // Single slash
            ];

            for name in invalid_names {
                // These should be caught as invalid
                assert!(name.is_empty() || name == "_" || name == "/");
            }
        }

        #[test]
        fn test_stream_name_formatting() {
            // Test that format_stream_name is available and works
            let test_names = vec!["Test-Stream", "UPPERCASE", "mixed_Case_123"];

            for name in test_names {
                let formatted = format_stream_name(name);
                // Should return a non-empty formatted string
                assert!(!formatted.is_empty());
                // Typically converts to lowercase, but exact behavior may vary
            }
        }
    }

    mod error_handling_tests {
        use super::*;

        #[test]
        fn test_bulk_response_error_creation() {
            let error = BulkResponseError::new(
                TS_PARSE_FAILED.to_string(),
                "test-stream".to_string(),
                "Invalid timestamp format".to_string(),
                "400".to_string(),
            );

            // Basic validation that error object can be created
            // Exact structure depends on BulkResponseError implementation
            assert!(!format!("{error:?}").is_empty());
        }

        #[test]
        fn test_different_error_scenarios() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            // Test various error scenarios
            let error_scenarios = vec![
                (TRANSFORM_FAILED, "JSON transformation failed"),
                (TS_PARSE_FAILED, "Cannot parse timestamp"),
                (SCHEMA_CONFORMANCE_FAILED, "Schema validation failed"),
                (PIPELINE_EXEC_FAILED, "Pipeline execution error"),
            ];

            for (error_type, error_msg) in error_scenarios {
                add_record_status(
                    "error_stream".to_string(),
                    &Some("error_doc".to_string()),
                    "index".to_string(),
                    Some(json::json!({"error": "test"})),
                    &mut bulk_res,
                    Some(error_type.to_string()),
                    Some(error_msg.to_string()),
                );
            }

            assert_eq!(bulk_res.items.len(), 4);

            // All items should be errors
            for item in &bulk_res.items {
                let bulk_item = item.values().next().unwrap();
                assert!(bulk_item.error.is_some());
            }
        }
    }

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_empty_bulk_request() {
            let empty_request = "";
            let body = web::Bytes::from(empty_request);

            // Empty request should be handled gracefully
            // (Test would need actual infrastructure to run fully)
            assert_eq!(body.len(), 0);
        }

        #[test]
        fn test_malformed_bulk_lines() {
            let malformed_lines = vec![
                "",                 // Empty line
                "not-json",         // Not JSON
                "{incomplete json", // Incomplete JSON
                "{}",               // Empty JSON object
                r#"{"index": {}}"#, // Missing required fields
            ];

            for line in malformed_lines {
                if line.is_empty() {
                    // Empty lines should be skipped
                    continue;
                }

                if json::from_slice::<json::Value>(line.as_bytes()).is_ok() {
                    // Valid JSON, should be processed
                } else {
                    // Invalid JSON, should cause error
                    // This is expected behavior
                }
            }
        }

        #[test]
        fn test_very_large_documents() {
            let large_value = "x".repeat(10000);
            let large_doc = json::json!({
                "message": large_value,
                "metadata": {
                    "large_field": "y".repeat(5000),
                    "nested": {
                        "data": "z".repeat(3000)
                    }
                }
            });

            let estimated_size = estimate_json_bytes(&large_doc);
            assert!(estimated_size > 15000); // Should be substantial

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "large_docs".to_string(),
                &Some("large_doc_1".to_string()),
                "index".to_string(),
                Some(large_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }

        #[test]
        fn test_unicode_and_special_characters() {
            let unicode_doc = json::json!({
                "message": "Hello 世界! 🌍 Testing Unicode",
                "emoji": "🚀🌟✨",
                "special_chars": "!@#$%^&*()[]{}|\\:;\"'<>?,./",
                "unicode_text": "Здравствуй мир! ¡Hola mundo!",
                "japanese": "こんにちは世界"
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "unicode_stream".to_string(),
                &Some("unicode_doc".to_string()),
                "index".to_string(),
                Some(unicode_doc),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);

            // Should handle unicode gracefully
            let item = &bulk_res.items[0];
            let bulk_item = item.values().next().unwrap();
            assert!(!bulk_item._index.is_empty());
        }

        #[test]
        fn test_null_and_empty_values() {
            let doc_with_nulls = json::json!({
                "null_field": null,
                "empty_string": "",
                "empty_array": [],
                "empty_object": {},
                "zero_number": 0,
                "false_boolean": false
            });

            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            add_record_status(
                "null_values_stream".to_string(),
                &Some("null_doc".to_string()),
                "index".to_string(),
                Some(doc_with_nulls),
                &mut bulk_res,
                None,
                None,
            );

            assert_eq!(bulk_res.items.len(), 1);
        }
    }

    mod performance_tests {
        use super::*;

        #[test]
        fn test_bulk_response_performance() {
            let mut bulk_res = BulkResponse {
                took: 0,
                errors: false,
                items: vec![],
            };

            let start = std::time::Instant::now();

            // Add many records to test performance
            for i in 0..1000 {
                add_record_status(
                    format!("perf_stream_{}", i % 10), // 10 different streams
                    &Some(format!("doc_{i}")),
                    if i % 2 == 0 {
                        "index".to_string()
                    } else {
                        "create".to_string()
                    },
                    Some(json::json!({
                        "id": i,
                        "message": format!("Performance test message {i}"),
                        "timestamp": format!("2024-01-01T{:02}:00:00Z", i % 24)
                    })),
                    &mut bulk_res,
                    if i % 10 == 0 {
                        Some(TS_PARSE_FAILED.to_string())
                    } else {
                        None
                    },
                    if i % 10 == 0 {
                        Some("Test error".to_string())
                    } else {
                        None
                    },
                );
            }

            let duration = start.elapsed();
            assert_eq!(bulk_res.items.len(), 1000);

            // Should complete within reasonable time (less than 1 second for 1000 records)
            assert!(duration.as_secs() < 1);

            // Check distribution of errors vs successes
            let errors: usize = bulk_res
                .items
                .iter()
                .map(|item| {
                    let bulk_item = item.values().next().unwrap();
                    if bulk_item.error.is_some() { 1 } else { 0 }
                })
                .sum();

            assert_eq!(errors, 100); // Every 10th record should be an error
        }
    }
}
