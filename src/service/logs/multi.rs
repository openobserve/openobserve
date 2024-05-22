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
    collections::HashMap,
    io::{BufRead, BufReader},
};

use actix_web::{http, web};
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    meta::{stream::StreamType, usage::UsageType},
    metrics,
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
    CONFIG, DISTINCT_FIELDS,
};
use infra::schema::SchemaCache;

use crate::{
    common::meta::{
        alerts::Alert,
        ingestion::{IngestionResponse, StreamStatus},
        stream::{SchemaRecords, StreamParams},
    },
    service::{
        get_formatted_stream_name,
        ingestion::{check_ingestion_allowed, evaluate_trigger, write_file, TriggerAlertData},
        logs::StreamMeta,
        metadata::{distinct_values::DvItem, write, MetadataItem, MetadataType},
        schema::get_upto_discard_error,
        usage::report_request_usage_stats,
    },
};

/// Ingest a multiline json body but add extra keys to each json row
///
/// ### Args
/// - org_id: org id to ingest data in
/// - in_stream_name: stream to write data in
/// - body: incoming payload
/// - extend_json: a hashmap of string -> string values which should be extended in each json row
/// - thread_id: a unique thread-id associated with this process
pub async fn ingest_with_keys(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &HashMap<String, serde_json::Value>,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    ingest_inner(org_id, in_stream_name, body, extend_json, thread_id).await
}

async fn ingest_inner(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &HashMap<String, serde_json::Value>,
    thread_id: usize,
) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();

    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;

    check_ingestion_allowed(org_id, Some(stream_name))?;
    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let min_ts = (Utc::now() - Duration::try_hours(CONFIG.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();

    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut trigger: Option<TriggerAlertData> = None;

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let partition_det = crate::service::ingestion::get_stream_partition_keys(
        org_id,
        &StreamType::Logs,
        stream_name,
    )
    .await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    crate::service::ingestion::get_stream_alerts(
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: stream_name.to_owned().into(),
            stream_type: StreamType::Logs,
        }],
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

        let mut value: json::Value = json::from_slice(line.as_bytes())?;

        for (key, val) in extend_json.iter() {
            value[key] = val.clone();
        }

        // JSON Flattening
        value = flatten::flatten_with_level(value, CONFIG.limit.ingest_flatten_level)?;
        // Start row based transform

        if !local_trans.is_empty() {
            value = crate::service::ingestion::apply_stream_functions(
                &local_trans,
                value,
                &stream_vrl_map,
                org_id,
                stream_name,
                &mut runtime,
            )?;
        }

        if value.is_null() || !value.is_object() {
            stream_status.status.failed += 1; // transform failed or dropped
            continue;
        }
        // End row based transform

        // get json object
        let mut local_val = match value.take() {
            json::Value::Object(v) => v,
            _ => unreachable!(),
        };

        // handle timestamp
        let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
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
        // check ingestion time
        if timestamp < min_ts {
            stream_status.status.failed += 1; // to old data, just discard
            stream_status.status.error = get_upto_discard_error().to_string();
            continue;
        }
        local_val.insert(
            CONFIG.common.column_timestamp.clone(),
            json::Value::Number(timestamp.into()),
        );

        let mut to_add_distinct_values = vec![];
        // get distinct_value item
        for field in DISTINCT_FIELDS.iter() {
            if let Some(val) = local_val.get(field) {
                if !val.is_null() {
                    to_add_distinct_values.push(MetadataItem::DistinctValues(DvItem {
                        stream_type: StreamType::Logs,
                        stream_name: stream_name.to_string(),
                        field_name: field.to_string(),
                        field_value: val.as_str().unwrap().to_string(),
                        filter_name: "".to_string(),
                        filter_value: "".to_string(),
                    }));
                }
            }
        }

        // write data
        let local_trigger = match super::add_valid_record(
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
            trigger.is_none(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                stream_status.status.failed += 1;
                stream_status.status.error = e.to_string();
                continue;
            }
        };
        if local_trigger.is_some() {
            trigger = local_trigger;
        }

        // add distinct values
        distinct_values.extend(to_add_distinct_values);
    }

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    let mut req_stats = write_file(&writer, stream_name, buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    req_stats.response_time = start.elapsed().as_secs_f64();
    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Multi,
        local_trans.len() as u16,
    )
    .await;

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_multi",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_multi",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    ))
}
