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
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    ALL_VALUES_COL_NAME, BLOCKED_STREAMS, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME,
    get_config,
    meta::{
        self_reporting::usage::UsageType,
        stream::{StreamParams, StreamType},
    },
    metrics,
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
};

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

pub async fn ingest(
    thread_id: usize,
    org_id: &str,
    body: web::Bytes,
    user_email: &str,
) -> Result<BulkResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    // check system resource
    check_ingestion_allowed(org_id, None)?;

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
                let err_msg = format!("Invalid stream name: {}", line);
                log::warn!("{}", err_msg);
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
                        .then_some(value.to_string())
                } else {
                    // 3. with pipeline, storing original as long as streams_need_original_set is
                    //    not empty
                    store_original_when_pipeline_exists.then_some(value.to_string())
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
                // JSON Flattening
                value = flatten::flatten_with_level(value, cfg.limit.ingest_flatten_level)?;

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
                    && original_data.is_some()
                {
                    local_val.insert(
                        ORIGINAL_DATA_COL_NAME.to_string(),
                        original_data.unwrap().into(),
                    );
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
                    "[Ingestion]: Stream {} has pipeline, but inputs failed to be buffered. BUG",
                    stream_name
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
                        "[Pipeline] for stream {}/{}: Batch execution error: {}.",
                        org_id,
                        stream_name,
                        e
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
                            if streams_need_original_map
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
        )
        .await;
        let IngestionStatus::Bulk(mut bulk_res) = status else {
            unreachable!();
        };
        bulk_res.took = start.elapsed().as_millis();
        match write_result {
            Ok(()) => ("200", bulk_res),
            Err(e) => {
                log::error!("Error while writing logs: {}", e);
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
}
