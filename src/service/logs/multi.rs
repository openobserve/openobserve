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

use actix_web::{http, web};
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    meta::{stream::StreamType, usage::UsageType},
    metrics,
    utils::{flatten, json},
};
use infra::schema::SchemaCache;

use super::ingest::handle_timestamp;
use crate::{
    common::meta::{
        alerts::Alert,
        ingestion::{IngestionResponse, StreamStatus},
        stream::StreamParams,
    },
    service::{
        get_formatted_stream_name, ingestion::check_ingestion_allowed,
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
pub async fn ingest_with_keys(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &HashMap<String, serde_json::Value>,
) -> Result<IngestionResponse, anyhow::Error> {
    ingest_inner(org_id, in_stream_name, body, extend_json).await
}

async fn ingest_inner(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    extend_json: &HashMap<String, serde_json::Value>,
) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    // check stream
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;
    check_ingestion_allowed(org_id, Some(stream_name))?;

    let cfg = config::get_config();
    let min_ts = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();

    // Start Register Transforms for stream
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let stream_param = StreamParams {
        org_id: org_id.to_owned().into(),
        stream_name: stream_name.to_owned().into(),
        stream_type: StreamType::Logs,
    };

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    crate::service::ingestion::get_stream_alerts(&[stream_param.clone()], &mut stream_alerts_map)
        .await;
    // End get stream alert

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, HashSet<String>> = HashMap::new();
    crate::service::ingestion::get_user_defined_schema(
        &[stream_param],
        &mut user_defined_schema_map,
    )
    .await;
    // End get user defined schema

    let mut stream_status = StreamStatus::new(stream_name);
    let mut json_data = Vec::new(); // TODO(taiming): get size and use capacity

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
        value = flatten::flatten_with_level(value, cfg.limit.ingest_flatten_level)?;

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

        if let Some(fields) = user_defined_schema_map.get(stream_name) {
            local_val = crate::service::logs::refactor_map(local_val, fields);
        }

        // handle timestamp
        let timestamp = match handle_timestamp(&mut local_val, min_ts) {
            Ok(ts) => ts,
            Err(e) => {
                stream_status.status.failed += 1;
                stream_status.status.error = e.to_string();
                continue;
            }
        };

        json_data.push((timestamp, local_val));
    }

    // QUESTION(taiming): return directly when no data?
    // if no data, fast return
    if json_data.is_empty() {
        return Ok(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ));
    }

    let mut req_stats = match super::write_logs(
        &super::StreamMeta {
            org_id: org_id.to_string(),
            stream_name: stream_name.to_string(),
            stream_alerts_map: &stream_alerts_map,
        },
        &mut stream_schema_map,
        &mut stream_status.status,
        json_data,
    )
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            log::error!("Error while writing logs: {}", e);
            // QUESTION(taiming): return directly when error?
            return Ok(IngestionResponse::new(
                http::StatusCode::OK.into(),
                vec![stream_status],
            ));
        }
    };

    req_stats.response_time = start.elapsed().as_secs_f64();
    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Multi,
        local_trans.len() as u16,
        started_at,
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

    // drop variables
    drop(runtime);
    drop(stream_schema_map);
    drop(stream_vrl_map);
    drop(stream_params);
    drop(stream_alerts_map);

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    ))
}
