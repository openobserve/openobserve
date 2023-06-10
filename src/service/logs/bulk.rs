// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use std::io::{BufRead, BufReader, Error};
use std::time::Instant;

use super::StreamMeta;
use crate::common::json;
use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::infra::metrics;
use crate::meta::alert::Alert;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::StreamTransform;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::VRLRuntimeConfig;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::ingestion::{
    BulkResponse, BulkResponseError, BulkResponseItem, BulkStreamData, RecordStatus,
    StreamSchemaChk,
};
use crate::meta::StreamType;
use crate::service::db;
use crate::service::ingestion::write_file;
use crate::service::schema::stream_schema_exists;
use crate::{common::time::parse_timestamp_micro_from_value, meta::alert::Trigger};

pub const TRANSFORM_FAILED: &str = "document_failed_transform";
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";

pub async fn ingest(
    org_id: &str,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let start = Instant::now();
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }
    //let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    #[cfg(feature = "zo_functions")]
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    #[cfg(feature = "zo_functions")]
    let mut stream_vrl_map: AHashMap<String, VRLRuntimeConfig> = AHashMap::new();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_data_map = AHashMap::new();
    #[cfg(feature = "zo_functions")]
    let mut stream_tansform_map: AHashMap<String, Vec<StreamTransform>> = AHashMap::new();
    let mut stream_partition_keys_map: AHashMap<String, (StreamSchemaChk, Vec<String>)> =
        AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();

    let mut action = String::from("");
    let mut stream_name = String::from("");
    let mut doc_id = String::from("");
    let mut stream_trigger_map: AHashMap<String, Trigger> = AHashMap::new();

    let mut next_line_is_data = false;
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        #[cfg(feature = "zo_functions")]
        let value: json::Value = json::from_slice(line.as_bytes())?;
        #[cfg(not(feature = "zo_functions"))]
        let value: json::Value = json::from_slice(line.as_bytes())?;
        if !next_line_is_data {
            // check bulk operate
            let ret = super::parse_bulk_index(&value);
            if ret.is_none() {
                continue; // skip
            }
            (action, stream_name, doc_id) = ret.unwrap();
            next_line_is_data = true;

            // Start Register Transfoms for stream
            #[cfg(feature = "zo_functions")]
            crate::service::ingestion::get_stream_transforms(
                org_id,
                StreamType::Logs,
                &stream_name,
                &mut stream_tansform_map,
                &mut stream_vrl_map,
            )
            .await;
            // End Register Transfoms for index

            // Start get stream alerts
            let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
            crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
            // End get stream alert

            if !stream_partition_keys_map.contains_key(&stream_name.clone()) {
                let stream_schema = stream_schema_exists(
                    org_id,
                    &stream_name,
                    StreamType::Logs,
                    &mut stream_schema_map,
                )
                .await;
                let mut partition_keys: Vec<String> = vec![];
                if stream_schema.has_partition_keys {
                    partition_keys = crate::service::ingestion::get_stream_partition_keys(
                        &stream_name,
                        &stream_schema_map,
                    )
                    .await;
                }
                stream_partition_keys_map
                    .insert(stream_name.clone(), (stream_schema, partition_keys.clone()));
            }

            stream_data_map
                .entry(stream_name.clone())
                .or_insert(BulkStreamData {
                    data: AHashMap::new(),
                });
        } else {
            next_line_is_data = false;

            let stream_data = stream_data_map.get_mut(&stream_name).unwrap();
            let buf = &mut stream_data.data;

            //Start row based transform
            #[cfg(feature = "zo_functions")]
            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);

            //JSON Flattening
            let mut value = json::flatten_json_and_format_field(&value);

            #[cfg(feature = "zo_functions")]
            if let Some(transforms) = stream_tansform_map.get(&key) {
                let mut ret_value = value.clone();
                ret_value = crate::service::ingestion::apply_stream_transform(
                    transforms,
                    &ret_value,
                    &stream_vrl_map,
                    &stream_name,
                    &mut runtime,
                );

                if ret_value.is_null() || !ret_value.is_object() {
                    bulk_res.errors = true;
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        value,
                        &mut bulk_res,
                        Some(TRANSFORM_FAILED.to_owned()),
                        Some(TRANSFORM_FAILED.to_owned()),
                    );
                    continue;
                } else {
                    value = ret_value;
                }
            }
            //End row based transform

            // get json object
            let local_val = value.as_object_mut().unwrap();
            // set _id
            if !doc_id.is_empty() {
                local_val.insert("_id".to_string(), json::Value::String(doc_id.clone()));
            }

            // handle timestamp
            let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
                Some(v) => match parse_timestamp_micro_from_value(v) {
                    Ok(t) => t,
                    Err(_e) => {
                        bulk_res.errors = true;
                        add_record_status(
                            stream_name.clone(),
                            doc_id.clone(),
                            action.clone(),
                            value,
                            &mut bulk_res,
                            Some(TS_PARSE_FAILED.to_owned()),
                            Some(TS_PARSE_FAILED.to_owned()),
                        );
                        continue;
                    }
                },
                None => Utc::now().timestamp_micros(),
            };
            // check ingestion time
            let earliest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
            if timestamp < earliest_time.timestamp_micros() {
                bulk_res.errors = true;
                let failure_reason = Some(super::get_upto_discard_error());
                add_record_status(
                    stream_name.clone(),
                    doc_id.clone(),
                    action.clone(),
                    value,
                    &mut bulk_res,
                    failure_reason.to_owned(),
                    failure_reason,
                );
                continue;
            }
            if timestamp < min_ts {
                min_ts = timestamp;
            }
            local_val.insert(
                CONFIG.common.column_timestamp.clone(),
                json::Value::Number(timestamp.into()),
            );
            let partition_keys: Vec<String> = match stream_partition_keys_map.get(&stream_name) {
                Some((_, partition_keys)) => partition_keys.to_vec(),
                None => vec![],
            };

            // only for bulk insert
            let mut status = RecordStatus::default();
            let local_trigger = super::add_valid_record(
                StreamMeta {
                    org_id: org_id.to_string(),
                    stream_name: stream_name.clone(),
                    partition_keys,
                    stream_alerts_map: stream_alerts_map.clone(),
                },
                &mut stream_schema_map,
                &mut status,
                buf,
                local_val,
            )
            .await;
            if local_trigger.is_some() {
                stream_trigger_map.insert(stream_name.clone(), local_trigger.unwrap());
            }
            if status.failed > 0 {
                bulk_res.errors = true;
                add_record_status(
                    stream_name.clone(),
                    doc_id.clone(),
                    action.clone(),
                    value,
                    &mut bulk_res,
                    Some(SCHEMA_CONFORMANCE_FAILED.to_owned()),
                    Some(status.error),
                );
            } else {
                add_record_status(
                    stream_name.clone(),
                    doc_id.clone(),
                    action.clone(),
                    value,
                    &mut bulk_res,
                    None,
                    None,
                );
            }
        }
    }

    for (stream_name, stream_data) in stream_data_map {
        // check if we are allowed to ingest
        if db::compact::delete::is_deleting_stream(org_id, &stream_name, StreamType::Logs, None) {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    format!("stream [{stream_name}] is being deleted"),
                )),
            );
        }
        // write to file
        write_file(
            stream_data.data,
            **thread_id,
            org_id,
            &stream_name,
            StreamType::Logs,
        );
    }

    // only one trigger per request, as it updates etcd
    for (_, entry) in &stream_trigger_map {
        super::evaluate_trigger(Some(entry.clone()), stream_alerts_map.clone()).await;
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();
    bulk_res.took = start.elapsed().as_millis();

    Ok(HttpResponse::Ok().json(bulk_res))
}

fn add_record_status(
    stream_name: String,
    doc_id: String,
    action: String,
    value: json::Value,
    bulk_res: &mut BulkResponse,
    failure_type: Option<String>,
    failure_reason: Option<String>,
) {
    let mut item = AHashMap::new();

    match failure_type {
        Some(failure_type) => {
            let bulk_err = BulkResponseError::new(
                failure_type,
                stream_name.clone(),
                failure_reason.unwrap(),
                "0".to_owned(), //TODO check
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
        }
        None => {
            item.insert(
                action,
                BulkResponseItem::new(stream_name.clone(), doc_id, value, stream_name),
            );
        }
    }
    bulk_res.items.push(item);
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
            "1".to_string(),
            "create".to_string(),
            json::Value::Null,
            &mut bulk_res,
            None,
            None,
        );
        assert!(bulk_res.items.len() == 1);
    }
}
