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

use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader},
};

use actix_web::web;
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    get_config,
    meta::{
        stream::{Routing, StreamType},
        usage::UsageType,
    },
    metrics,
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
    BLOCKED_STREAMS,
};

use crate::{
    common::meta::{
        functions::{StreamTransform, VRLResultResolver},
        ingestion::{BulkResponse, BulkResponseError, BulkResponseItem, IngestionStatus},
        stream::StreamParams,
    },
    service::{
        db, format_stream_name, ingestion::check_ingestion_allowed, schema::get_upto_discard_error,
        usage::report_request_usage_stats,
    },
};

pub const TRANSFORM_FAILED: &str = "document_failed_transform";
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";

pub async fn ingest(
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

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_vrl_map: HashMap<String, VRLResultResolver> = HashMap::new();
    let mut stream_functions_map: HashMap<String, Vec<StreamTransform>> = HashMap::new();

    let mut action = String::from("");
    let mut stream_name = String::from("");
    let mut doc_id = None;

    let mut blocked_stream_warnings: HashMap<String, bool> = HashMap::new();
    let mut stream_routing_map: HashMap<String, Vec<Routing>> = HashMap::new();
    let mut user_defined_schema_map: HashMap<String, HashSet<String>> = HashMap::new();

    let mut json_data_by_stream = HashMap::new();
    let mut next_line_is_data = false;
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

        let value: json::Value = json::from_slice(line.as_bytes())?;

        if !next_line_is_data {
            // check bulk operate
            let ret = super::parse_bulk_index(&value);
            if ret.is_none() {
                continue; // skip
            }
            (action, stream_name, doc_id) = ret.unwrap();

            if !cfg.common.skip_formatting_bulk_stream_name {
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

            // Start get routing keys
            crate::service::ingestion::get_stream_routing(
                StreamParams {
                    org_id: org_id.to_owned().into(),
                    stream_type: StreamType::Logs,
                    stream_name: stream_name.to_owned().into(),
                },
                &mut stream_routing_map,
            )
            .await;

            let mut streams = vec![StreamParams {
                org_id: org_id.to_owned().into(),
                stream_type: StreamType::Logs,
                stream_name: stream_name.to_owned().into(),
            }];

            if let Some(routes) = stream_routing_map.get(&stream_name) {
                for route in routes {
                    streams.push(StreamParams {
                        org_id: org_id.to_owned().into(),
                        stream_type: StreamType::Logs,
                        stream_name: route.destination.clone().into(),
                    });
                }
            }
            // End get stream keys

            crate::service::ingestion::get_user_defined_schema(
                &streams,
                &mut user_defined_schema_map,
            )
            .await;

            next_line_is_data = true;

            // Start Register functions for stream
            crate::service::ingestion::get_stream_functions(
                &streams,
                &mut stream_functions_map,
                &mut stream_vrl_map,
            )
            .await;
            // End Register functions for index
        } else {
            next_line_is_data = false;

            // JSON Flattening
            let mut value = flatten::flatten_with_level(value, cfg.limit.ingest_flatten_level)?;

            if let Some(routing) = stream_routing_map.get(&stream_name) {
                if !routing.is_empty() {
                    for route in routing {
                        let mut is_routed = true;
                        let val = &route.routing;
                        for q_condition in val.iter() {
                            is_routed =
                                is_routed && q_condition.evaluate(value.as_object().unwrap()).await;
                        }
                        if is_routed && !val.is_empty() {
                            stream_name = route.destination.clone();
                            break;
                        }
                    }
                }
            }

            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);
            // Start row based transform
            if let Some(transforms) = stream_functions_map.get(&key) {
                if !transforms.is_empty() {
                    let mut ret_value = value.clone();
                    ret_value = crate::service::ingestion::apply_stream_functions(
                        transforms,
                        ret_value,
                        &stream_vrl_map,
                        org_id,
                        &stream_name,
                        &mut runtime,
                    )?;

                    if ret_value.is_null() || !ret_value.is_object() {
                        bulk_res.errors = true;
                        add_record_status(
                            stream_name.clone(),
                            &doc_id,
                            action.clone(),
                            Some(value),
                            &mut bulk_res,
                            Some(TRANSFORM_FAILED.to_owned()),
                            Some(TRANSFORM_FAILED.to_owned()),
                        );
                        continue;
                    } else {
                        value = ret_value;
                    }
                }
            }
            // End row based transform

            // get json object
            let mut local_val = match value.take() {
                json::Value::Object(v) => v,
                _ => unreachable!(),
            };

            // set _id
            if let Some(doc_id) = &doc_id {
                local_val.insert("_id".to_string(), json::Value::String(doc_id.to_owned()));
            }

            if let Some(fields) = user_defined_schema_map.get(&stream_name) {
                local_val = crate::service::logs::refactor_map(local_val, fields);
            }

            // handle timestamp
            let timestamp = match local_val.get(&cfg.common.column_timestamp) {
                Some(v) => match parse_timestamp_micro_from_value(v) {
                    Ok(t) => t,
                    Err(_e) => {
                        bulk_res.errors = true;
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
            if timestamp < min_ts {
                bulk_res.errors = true;
                let failure_reason = Some(get_upto_discard_error().to_string());
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
                cfg.common.column_timestamp.clone(),
                json::Value::Number(timestamp.into()),
            );

            json_data_by_stream
                .entry(stream_name.clone())
                .or_insert(Vec::new())
                .push((timestamp, local_val));
        }
    }

    // metric + data usage
    let took_time = start.elapsed().as_secs_f64();
    let mut status = IngestionStatus::Bulk(bulk_res);
    for (stream_name, json_data) in json_data_by_stream {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(org_id, StreamType::Logs, &stream_name, None)
        {
            log::warn!("stream [{stream_name}] is being deleted");
            continue; // skip
        }

        // write json data by stream
        let mut req_stats = super::write_logs(org_id, &stream_name, &mut status, json_data).await?;

        req_stats.response_time += took_time;
        req_stats.user_email = if user_email.is_empty() {
            None
        } else {
            Some(user_email.to_string())
        };

        let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);
        let fns_length = stream_functions_map
            .get(&key)
            .map(|v| v.len())
            .unwrap_or_default();
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Logs,
            UsageType::Bulk,
            fns_length as u16,
            started_at,
        )
        .await;
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(took_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();
    let mut bulk_res = match status {
        IngestionStatus::Bulk(bulk_res) => bulk_res,
        IngestionStatus::Record(_) => unreachable!(),
    };
    bulk_res.took = start.elapsed().as_millis();

    Ok(bulk_res)
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
                "0".to_owned(), // TODO check
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
