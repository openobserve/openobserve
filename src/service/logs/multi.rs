// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{http, web};
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use std::io::{BufRead, BufReader};

use crate::common::{
    infra::{
        config::{CONFIG, DISTINCT_FIELDS},
        metrics,
    },
    meta::{
        alerts::{Alert, Trigger},
        ingestion::{IngestionResponse, StreamStatus},
        stream::StreamParams,
        usage::UsageType,
        StreamType,
    },
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
};
use crate::service::{
    distinct_values, get_formatted_stream_name, ingestion::is_ingestion_allowed,
    ingestion::write_file, logs::StreamMeta, usage::report_request_usage_stats,
};

/// Ingest a multiline json body but add extra keys to each json row
///
/// ### Args
/// - org_id: org id to ingest data in
/// - in_stream_name: stream to write data in
/// - body: incoming payload
/// - extend_json: a hashmap of string -> string values which should be extended in each json row
/// - thread_id: a unique thread-id associated with this process
///
pub async fn ingest_with_keys(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &AHashMap<String, serde_json::Value>,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    ingest_inner(org_id, in_stream_name, body, extend_json, thread_id).await
}

/// Ingest a multiline json body
///
/// ### Args
/// - org_id: org id to ingest data in
/// - in_stream_name: stream to write data in
/// - body: incoming payload
/// - thread_id: a unique thread-id associated with this process
///
pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    ingest_inner(
        org_id,
        in_stream_name,
        body,
        &AHashMap::default(),
        thread_id,
    )
    .await
}

async fn ingest_inner(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &AHashMap<String, serde_json::Value>,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();

    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut distinct_values = Vec::with_capacity(16);
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;

    if let Some(value) = is_ingestion_allowed(org_id, Some(stream_name)) {
        return Err(value);
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
        value = flatten::flatten(&value)?;
        // Start row based transform

        if !local_trans.is_empty() {
            value = crate::service::ingestion::apply_stream_transform(
                &local_trans,
                &value,
                &stream_vrl_map,
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
        let local_val = value.as_object_mut().unwrap();

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
        let earliest_time = Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto);
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

        // get distinct_value item
        for field in DISTINCT_FIELDS.iter() {
            if let Some(val) = local_val.get(field) {
                if !val.is_null() {
                    distinct_values.push(distinct_values::DvItem {
                        stream_type: StreamType::Logs,
                        stream_name: stream_name.to_string(),
                        field_name: field.to_string(),
                        field_value: val.as_str().unwrap().to_string(),
                        filter_name: "".to_string(),
                        filter_value: "".to_string(),
                    });
                }
            }
        }

        if local_trigger.is_some() {
            trigger = Some(local_trigger.unwrap());
        }
    }

    // write to file
    let mut stream_file_name = "".to_string();

    let mut req_stats = write_file(
        &buf,
        thread_id,
        &stream_params,
        &mut stream_file_name,
        partition_time_level,
    )
    .await;

    if stream_file_name.is_empty() {
        return Ok(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ));
    }

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, &stream_alerts_map).await;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
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
