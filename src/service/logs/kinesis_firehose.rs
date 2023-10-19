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

use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;

use super::{ingest::decode_and_decompress, StreamMeta};
use crate::common::{
    infra::{cluster, config::CONFIG, metrics},
    meta::{
        alert::{Alert, Trigger},
        ingestion::{
            AWSRecordType, KinesisFHData, KinesisFHIngestionResponse, KinesisFHRequest,
            StreamStatus,
        },
        stream::StreamParams,
        usage::UsageType,
        StreamType,
    },
    utils::{
        flatten, json,
        time::{parse_i64_to_timestamp_micros, parse_timestamp_micro_from_value},
    },
};
use crate::service::{
    db, get_formatted_stream_name, ingestion::write_file, usage::report_request_usage_stats,
};

pub async fn process(
    org_id: &str,
    in_stream_name: &str,
    request: KinesisFHRequest,
    thread_id: usize,
) -> Result<KinesisFHIngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&stream_params, &mut stream_schema_map).await;

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_name, StreamType::Logs, None) {
        return Err(anyhow::anyhow!("stream [{stream_name}] is being deleted"));
    }

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut trigger: Option<Trigger> = None;

    // Start Register Transforms for stream

    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let partition_det =
        crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map).await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    for record in request.records {
        match decode_and_decompress(&record.data) {
            Err(err) => {
                return Ok(KinesisFHIngestionResponse {
                    request_id: request.request_id,
                    error_message: Some(err.to_string()),
                    timestamp: request.timestamp.unwrap_or(Utc::now().timestamp_micros()),
                });
            }
            Ok((decompressed_data, record_type)) => {
                let mut value = json::Value::Null;
                let mut timestamp = 0;
                if record_type.eq(&AWSRecordType::Cloudwatch) {
                    let kfh_data: KinesisFHData = json::from_str(&decompressed_data)?;

                    for event in kfh_data.log_events.iter() {
                        value = json::to_value(event).unwrap();
                        let local_val = value.as_object_mut().unwrap();

                        local_val.insert("requestId".to_owned(), request.request_id.clone().into());
                        local_val.insert(
                            "messageType".to_owned(),
                            kfh_data.message_type.clone().into(),
                        );
                        local_val.insert("owner".to_owned(), kfh_data.owner.clone().into());
                        local_val.insert("logGroup".to_owned(), kfh_data.log_group.clone().into());
                        local_val
                            .insert("logStream".to_owned(), kfh_data.log_stream.clone().into());
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
                                    local_val.insert("message".to_owned(), event.message.clone());
                                }
                                Ok(message_val) => {
                                    local_val.insert("message".to_owned(), message_val.clone());
                                }
                            }
                        } else {
                            local_val.insert("message".to_owned(), local_msg.into());
                        }

                        value = local_val.clone().into();
                        // handling of timestamp
                        timestamp = match event.timestamp {
                            Some(v) => parse_i64_to_timestamp_micros(v),
                            None => Utc::now().timestamp_micros(),
                        };
                    }
                } else {
                    value = json::from_str(&decompressed_data)?;
                    timestamp = match value
                        .as_object()
                        .unwrap()
                        .get(&CONFIG.common.column_timestamp)
                    {
                        Some(v) => match parse_timestamp_micro_from_value(v) {
                            Ok(t) => t,
                            Err(e) => {
                                stream_status.status.failed += 1;
                                stream_status.status.error = e.to_string();
                                continue;
                            }
                        },
                        None => Utc::now().timestamp_micros(),
                    };
                }

                // JSON Flattening
                value = flatten::flatten(&value)?;

                // Start row based transform

                let mut value = crate::service::ingestion::apply_stream_transform(
                    &local_trans,
                    &value,
                    &stream_vrl_map,
                    stream_name,
                    &mut runtime,
                )?;

                if value.is_null() || !value.is_object() {
                    stream_status.status.failed += 1; // transform failed or dropped
                    continue;
                }
                // End row based transform

                // get json object
                let local_val = value.as_object_mut().unwrap();

                // check ingestion time
                let earliest_time =
                    Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
                if timestamp < earliest_time.timestamp_micros() {
                    stream_status.status.failed += 1; // to old data, just discard
                    stream_status.status.error = super::get_upto_discard_error();
                    continue;
                }
                if timestamp < min_ts {
                    min_ts = timestamp;
                }
                local_val.insert(
                    CONFIG.common.column_timestamp.clone(),
                    json::Value::Number(timestamp.into()),
                );

                // write data
                let local_trigger = super::add_valid_record(
                    &StreamMeta {
                        org_id: org_id.to_string(),
                        stream_name: stream_name.to_string(),
                        partition_keys: &partition_keys,
                        partition_time_level: &partition_time_level,
                        stream_alerts_map: &stream_alerts_map,
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
        }
    }

    // write to file
    let mut stream_file_name = "".to_string();
    let mut req_stats =
        write_file(&buf, thread_id, &stream_params, &mut stream_file_name, None).await;

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, &stream_alerts_map).await;

    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::KinesisFirehose,
        local_trans.len() as u16,
    )
    .await;

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_kinesis",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_kinesis",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    Ok(KinesisFHIngestionResponse {
        request_id: request.request_id,
        timestamp: request.timestamp.unwrap_or(Utc::now().timestamp_micros()),
        error_message: None,
    })
}
