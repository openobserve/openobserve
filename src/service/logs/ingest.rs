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

use actix_web::{http, web};
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use std::io::{BufRead, BufReader};
use vrl::compiler::runtime::Runtime;

use super::StreamMeta;
use crate::common::infra::{config::CONFIG, metrics};
use crate::common::meta::functions::{StreamTransform, VRLRuntimeConfig};
use crate::common::meta::ingestion::{IngestionData, IngestionRequest};
use crate::common::meta::stream::Stream;
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

    let data = match in_req {
        IngestionRequest::JSON(req) => {
            let reader: Vec<json::Value> = json::from_slice(&req)?;
            reader
        }

        IngestionRequest::KinesisFH(_) => todo!(),
        IngestionRequest::GCP(_) => todo!(),
        IngestionRequest::Multi(_) => todo!(),
    };

    //let reader: Vec<json::Value> = json::from_slice(&body)?;
    for item in data.iter() {
        match apply_functions(
            item,
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
            "/api/org/ingest/logs/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_json",
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
    local_trans: &'a Vec<StreamTransform>,
    stream_vrl_map: &'a AHashMap<String, VRLRuntimeConfig>,
    stream_name: &'a str,
    mut runtime: &'a mut Runtime,
) -> Result<json::Value, anyhow::Error> {
    let mut value = flatten::flatten(item)?;

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_transform(
            &local_trans,
            &value,
            stream_vrl_map,
            stream_name,
            &mut runtime,
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
