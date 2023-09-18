// Copyright 2023 Zinc Labs Inc.
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

use std::io::{BufRead, ErrorKind};

use actix_web::http;
use ahash::AHashMap;
use bytes::Bytes;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use vrl::compiler::runtime::Runtime;

use super::StreamMeta;
use crate::common::infra::{config::CONFIG, metrics};
use crate::common::meta::functions::{StreamTransform, VRLRuntimeConfig};
use crate::common::meta::ingestion::{
    AWSRecordType, GCPIngestionResponse, IngestionData, IngestionDataIter, IngestionError,
    IngestionRequest, KinesisFHData, KinesisFHIngestionResponse,
};
use crate::common::meta::{
    alert::{Alert, Trigger},
    ingestion::{IngestionResponse, StreamStatus},
    stream::StreamParams,
    usage::UsageType,
    StreamType,
};
use crate::common::utils::{flatten, json, time::parse_timestamp_micro_from_value};
use crate::service::ingestion::is_ingestion_allowed;
use crate::service::{
    format_stream_name, ingestion::write_file, schema::stream_schema_exists,
    usage::report_request_usage_stats,
};

pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    in_req: IngestionRequest,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    let stream_name = &format_stream_name(in_stream_name);

    if let Some(value) = is_ingestion_allowed(org_id, Some(stream_name)) {
        return Err(value);
    }

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut trigger: Option<Trigger> = None;
    let multi_req: Bytes;

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let stream_schema = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Logs,
        &mut stream_schema_map,
    )
    .await;

    let mut partition_keys: Vec<String> = vec![];
    if stream_schema.has_partition_keys {
        let partition_det =
            crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map)
                .await;
        partition_keys = partition_det.partition_keys;
    }

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    let ep: &str;

    let data = match in_req {
        IngestionRequest::JSON(req) => {
            let reader: Vec<json::Value> = json::from_slice(&req)?;
            ep = "/api/org/ingest/logs/_json";
            IngestionData::JSON(reader)
        }
        IngestionRequest::GCP(req) => {
            ep = "/api/org/ingest/logs/_gcs";
            IngestionData::GCP(req)
        }
        IngestionRequest::Multi(req) => {
            multi_req = req;
            ep = "/api/org/ingest/logs/_multi";
            IngestionData::Multi(&multi_req)
        }
        IngestionRequest::KinesisFH(req) => {
            ep = "/api/org/ingest/logs/_kinesis";
            IngestionData::KinesisFH(req)
        }
    };

    for item in data.iter() {
        match item {
            Ok(value) => {
                match apply_functions(
                    &value,
                    &local_trans,
                    &stream_vrl_map,
                    stream_name,
                    &mut runtime,
                ) {
                    Ok(mut res) => {
                        let local_val = res.as_object_mut().unwrap();

                        match handle_ts(local_val, min_ts) {
                            Ok(t) => min_ts = t,
                            Err(e) => {
                                stream_status.status.failed += 1;
                                stream_status.status.error = e.to_string();
                                continue;
                            }
                        }
                        let local_trigger = super::add_valid_record(
                            StreamMeta {
                                org_id: org_id.to_string(),
                                stream_name: stream_name.to_string(),
                                partition_keys: partition_keys.clone(),
                                stream_alerts_map: stream_alerts_map.clone(),
                            },
                            &mut stream_schema_map,
                            &mut stream_status.status,
                            &mut buf,
                            local_val,
                        )
                        .await;

                        if local_trigger.is_some() {
                            trigger = Some(local_trigger.unwrap());
                        }
                    }
                    Err(e) => {
                        stream_status.status.failed += 1;
                        stream_status.status.error = e.to_string();
                        continue;
                    }
                };
            }
            Err(e) => {
                println!("Error: {:?}", e);
                return Err(anyhow::Error::msg("Failed processing"));
            }
        }
    }

    // write to file
    let mut stream_file_name = "".to_string();
    let mut req_stats = write_file(
        buf,
        thread_id,
        StreamParams {
            org_id,
            stream_name,
            stream_type: StreamType::Logs,
        },
        &mut stream_file_name,
        None,
    );

    if stream_file_name.is_empty() {
        return Ok(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ));
    }
    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, stream_alerts_map).await;

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Json,
        local_trans.len() as u16,
    )
    .await;

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    ))
}

fn apply_functions<'a>(
    item: &'a json::Value,
    local_trans: &Vec<StreamTransform>,
    stream_vrl_map: &'a AHashMap<String, VRLRuntimeConfig>,
    stream_name: &'a str,
    runtime: &mut Runtime,
) -> Result<json::Value, anyhow::Error> {
    let mut value = flatten::flatten(item)?;

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_transform(
            local_trans,
            &value,
            stream_vrl_map,
            stream_name,
            runtime,
        )?;
    }

    if value.is_null() || !value.is_object() {
        Err(anyhow::Error::msg("apply functions failure"))
    } else {
        Ok(value)
    }
}

fn handle_ts(
    local_val: &mut json::Map<String, json::Value>,
    mut min_ts: i64,
) -> Result<i64, anyhow::Error> {
    // handle timestamp
    let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
        Some(v) => match parse_timestamp_micro_from_value(v) {
            Ok(t) => t,
            Err(_) => return Err(anyhow::Error::msg("Cant parse timestamp")),
        },
        None => Utc::now().timestamp_micros(),
    };
    // check ingestion time
    let earliest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
    if timestamp < earliest_time.timestamp_micros() {
        return Err(anyhow::Error::msg(super::get_upto_discard_error()));
    }
    if timestamp < min_ts {
        min_ts = timestamp;
    }
    local_val.insert(
        CONFIG.common.column_timestamp.clone(),
        json::Value::Number(timestamp.into()),
    );
    Ok(min_ts)
}

impl<'a> Iterator for IngestionDataIter<'a> {
    type Item = Result<json::Value, IngestionError>;

    fn next(&mut self) -> Option<Result<json::Value, IngestionError>> {
        match self {
            IngestionDataIter::JSONIter(iter) => iter.next().cloned().map(Ok),
            IngestionDataIter::MultiIter(iter) => iter.next().map(|line_result| {
                line_result.map_err(IngestionError::from).and_then(|line| {
                    if line.is_empty() {
                        std::io::Error::new(
                            ErrorKind::InvalidData,
                            "Empty line in multi ingestion".to_string(),
                        );
                    }
                    json::from_str(&line).map_err(IngestionError::from)
                })
            }),
            IngestionDataIter::GCP(iter, err) => match err {
                Some(e) => Some(Err(IngestionError::GCPError(e.clone()))),
                None => iter.next().map(Ok),
            },
            IngestionDataIter::KinesisFH(iter, err) => match err {
                Some(e) => Some(Err(IngestionError::AWSError(e.clone()))),
                None => iter.next().map(Ok),
            },
        }
    }
}

impl<'a> IngestionData<'a> {
    pub fn iter(&'a self) -> IngestionDataIter<'a> {
        match self {
            IngestionData::JSON(vec) => IngestionDataIter::JSONIter(vec.iter()),
            IngestionData::Multi(data) => {
                IngestionDataIter::MultiIter(std::io::BufReader::new(*data).lines())
            }
            IngestionData::GCP(request) => {
                let data = &request.message.data;
                let request_id = &request.message.message_id;
                let req_timestamp = &request.message.publish_time;
                match crate::service::logs::gcs_pub_sub::decode_and_decompress(data) {
                    Ok((decompressed_data, _)) => {
                        let value: json::Value = json::from_str(&decompressed_data).unwrap();
                        IngestionDataIter::GCP(vec![value].into_iter(), None)
                    }
                    Err(e) => IngestionDataIter::GCP(
                        vec![].into_iter(),
                        Some(GCPIngestionResponse {
                            request_id: request_id.to_string(),
                            error_message: Some(e.to_string()),
                            timestamp: req_timestamp.to_string(),
                        }),
                    ),
                }
            }
            IngestionData::KinesisFH(request) => {
                let mut events = Vec::new();
                let request_id = &request.request_id;
                let req_timestamp = request.timestamp.unwrap_or(Utc::now().timestamp_micros());

                for record in &request.records {
                    match super::kinesis_firehose::decode_and_decompress(&record.data) {
                        Err(err) => {
                            return IngestionDataIter::KinesisFH(
                                events.into_iter(),
                                Some(KinesisFHIngestionResponse {
                                    request_id: request_id.to_string(),
                                    error_message: Some(err.to_string()),
                                    timestamp: req_timestamp,
                                }),
                            );
                        }
                        Ok((decompressed_data, record_type)) => {
                            let mut value;
                            //let mut timestamp;
                            if record_type.eq(&AWSRecordType::Cloudwatch) {
                                let kfh_data: KinesisFHData =
                                    json::from_str(&decompressed_data).unwrap();

                                for event in kfh_data.log_events.iter() {
                                    value = json::to_value(event).unwrap();
                                    let local_val = value.as_object_mut().unwrap();

                                    local_val.insert(
                                        "requestId".to_owned(),
                                        request.request_id.clone().into(),
                                    );
                                    local_val.insert(
                                        "messageType".to_owned(),
                                        kfh_data.message_type.clone().into(),
                                    );
                                    local_val
                                        .insert("owner".to_owned(), kfh_data.owner.clone().into());
                                    local_val.insert(
                                        "logGroup".to_owned(),
                                        kfh_data.log_group.clone().into(),
                                    );
                                    local_val.insert(
                                        "logStream".to_owned(),
                                        kfh_data.log_stream.clone().into(),
                                    );
                                    local_val.insert(
                                        "subscriptionFilters".to_owned(),
                                        kfh_data.subscription_filters.clone().into(),
                                    );

                                    let local_msg = event.message.as_str().unwrap();

                                    if local_msg.starts_with('{') && local_msg.ends_with('}') {
                                        let result: Result<json::Value, json::Error> =
                                            json::from_str(local_msg);

                                        match result {
                                            Err(_e) => {
                                                local_val.insert(
                                                    "message".to_owned(),
                                                    event.message.clone(),
                                                );
                                            }
                                            Ok(message_val) => {
                                                local_val.insert(
                                                    "message".to_owned(),
                                                    message_val.clone(),
                                                );
                                            }
                                        }
                                    } else {
                                        local_val.insert("message".to_owned(), local_msg.into());
                                    }

                                    /*  // handling of timestamp
                                    timestamp = match event.timestamp {
                                        Some(v) => parse_i64_to_timestamp_micros(v),
                                        None => Utc::now().timestamp_micros(),
                                    }; */

                                    local_val.insert(
                                        CONFIG.common.column_timestamp.clone(),
                                        event.timestamp.into(),
                                    );

                                    value = local_val.clone().into();

                                    events.push(value);
                                }
                            } else {
                                value = json::from_str(&decompressed_data).unwrap();
                                events.push(value);
                            };
                        }
                    }
                }
                return IngestionDataIter::KinesisFH(events.into_iter(), None);
            }
        }
    }
}
