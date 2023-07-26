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

use actix_web::{http, web};
use ahash::AHashMap;
use anyhow::{anyhow, Result};
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use std::{collections::HashMap, fs::OpenOptions};
use vrl::compiler::runtime::Runtime;

use crate::common::infra::{
    cluster,
    config::{CONFIG, METRIC_SERIES_HASH},
    metrics,
};
use crate::common::meta::{
    ingestion::{IngestionResponse, StreamStatus},
    prom::{
        Metadata, HASH_LABEL, METADATA_LABEL, NAME_LABEL, SAMPLES_NAME, SERIES_NAME, TYPE_LABEL,
        VALUE_LABEL,
    },
    stream::PartitionTimeLevel,
    stream::StreamSettings,
    usage::UsageType,
    StreamType,
};
use crate::common::{flatten, json, time};
use crate::service::{
    db,
    ingestion::{get_wal_time_key, write_file},
    schema::{add_stream_schema, stream_schema_exists},
    stream::{save_stream_settings, stream_created},
    usage::report_usage_stats,
};

pub async fn ingest(org_id: &str, body: web::Bytes, thread_id: usize) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(anyhow::anyhow!("Quota exceeded for this organisation"));
    }

    let now_ts = Utc::now().timestamp_micros();

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut metrics_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut metrics_status_map: AHashMap<String, StreamStatus> = AHashMap::new();
    let mut metrics_samples_data: AHashMap<String, Vec<String>> = AHashMap::new();
    let mut metrics_series_values: AHashMap<String, Vec<String>> = AHashMap::new();

    let reader: Vec<json::Value> = json::from_slice(&body)?;
    for record in reader.iter() {
        // JSON Flattening
        let mut record = flatten::flatten(record)?;
        // check data type
        let record = record.as_object_mut().unwrap();
        let stream_name = match record.get(NAME_LABEL).ok_or(anyhow!("missing __name__"))? {
            json::Value::String(s) => s.clone(),
            _ => {
                return Err(anyhow::anyhow!("invalid __name__, need to be string"));
            }
        };
        let metrics_type = match record.get(TYPE_LABEL).ok_or(anyhow!("missing __type__"))? {
            json::Value::String(s) => s.clone(),
            _ => {
                return Err(anyhow::anyhow!("invalid __type__, need to be string"));
            }
        };

        // check metrics type for Histogram & Summary
        if metrics_type.to_lowercase() == "histogram" || metrics_type.to_lowercase() == "summary" {
            if metrics_schema_map.get(&stream_name).is_none() {
                let mut schema = db::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
                if schema == Schema::empty() {
                    // create the metadata for the stream
                    let metadata = Metadata {
                        metric_family_name: stream_name.clone(),
                        metric_type: metrics_type.as_str().into(),
                        help: stream_name.clone().replace('_', " "),
                        unit: "".to_string(),
                    };
                    let mut extra_metadata: HashMap<String, String> = HashMap::new();
                    extra_metadata.insert(
                        METADATA_LABEL.to_string(),
                        json::to_string(&metadata).unwrap(),
                    );
                    schema = schema.with_metadata(extra_metadata);
                    db::schema::set(
                        org_id,
                        &stream_name,
                        StreamType::Metrics,
                        &schema,
                        Some(chrono::Utc::now().timestamp_micros()),
                        false,
                    )
                    .await?;
                }
                metrics_schema_map.insert(stream_name.clone(), schema);
            }
            continue;
        }

        // apply functions
        let mut record = json::Value::Object(record.to_owned());
        apply_func(&mut runtime, org_id, SERIES_NAME, &mut record)?;

        let record = record.as_object_mut().unwrap();

        // add hash
        let hash = super::signature_without_labels(
            record,
            &[VALUE_LABEL, CONFIG.common.column_timestamp.as_str()],
        );
        let hash_val: String = hash.into();
        record.insert(
            HASH_LABEL.to_string(),
            json::Value::String(hash_val.clone()),
        );

        // check series table
        let series_key = format!("{}/{}/{}", &org_id, stream_name.clone(), &hash_val);
        let present = METRIC_SERIES_HASH.get(&series_key);
        if present.is_none() {
            METRIC_SERIES_HASH.insert(series_key.clone());
            let mut series_values = record.clone();
            series_values.remove_entry(VALUE_LABEL);
            series_values.remove_entry(TYPE_LABEL);
            series_values.insert(
                CONFIG.common.column_timestamp.clone(),
                json::Value::Number(now_ts.into()),
            );
            let series_str = crate::common::json::to_string(&series_values).unwrap();
            metrics_series_values
                .entry(stream_name.clone())
                .or_default()
                .push(series_str);
        }

        // check record timestamp & value
        let timestamp: i64 = match record.get(&CONFIG.common.column_timestamp) {
            None => chrono::Utc::now().timestamp_micros(),
            Some(json::Value::Number(s)) => {
                time::parse_i64_to_timestamp_micros(s.as_f64().unwrap() as i64)
            }
            Some(_) => {
                return Err(anyhow::anyhow!("invalid _timestamp, need to be number"));
            }
        };
        let value: f64 = match record.get(VALUE_LABEL).ok_or(anyhow!("missing value"))? {
            json::Value::Number(s) => s.as_f64().unwrap(),
            _ => {
                return Err(anyhow::anyhow!("invalid value, need to be number"));
            }
        };
        // reset time & value
        record.insert(
            CONFIG.common.column_timestamp.clone(),
            json::Value::Number(timestamp.into()),
        );
        record.insert(
            VALUE_LABEL.to_string(),
            json::Number::from_f64(value).unwrap().into(),
        );
        // remove type from labels
        record.remove(TYPE_LABEL);

        // convert every label to string
        for (k, v) in record.iter_mut() {
            if k == NAME_LABEL
                || k == TYPE_LABEL
                || k == VALUE_LABEL
                || k == &CONFIG.common.column_timestamp
            {
                continue;
            }
            match v {
                json::Value::String(_) => {}
                _ => {
                    *v = json::Value::String(v.to_string());
                }
            }
        }

        // sample value
        let mut sample_values: json::Map<String, json::Value> = record.clone();
        sample_values.retain(|k, _| {
            k.eq(&CONFIG.common.column_timestamp)
                || k.eq(HASH_LABEL)
                || k.eq(VALUE_LABEL)
                || k.eq(NAME_LABEL)
        });

        // check schema for current metrics name
        if metrics_schema_map.get(&stream_name).is_none() {
            let mut schema = db::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
            if stream_created(&schema).is_none() {
                let metadata = Metadata {
                    metric_family_name: stream_name.clone(),
                    metric_type: metrics_type.as_str().into(),
                    help: stream_name.clone().replace('_', " "),
                    unit: "".to_string(),
                };
                let mut extra_metadata: HashMap<String, String> = HashMap::new();
                extra_metadata.insert(
                    METADATA_LABEL.to_string(),
                    json::to_string(&metadata).unwrap(),
                );
                schema = schema.with_metadata(extra_metadata);
                db::schema::set(
                    org_id,
                    &stream_name,
                    StreamType::Metrics,
                    &schema,
                    Some(timestamp),
                    false,
                )
                .await?;
            }
            metrics_schema_map.insert(stream_name.clone(), schema);
        }

        // write into buffer
        let partition_keys =
            crate::service::ingestion::get_stream_partition_keys(SERIES_NAME, &metrics_schema_map)
                .await;

        let hour_key = get_wal_time_key(
            timestamp,
            PartitionTimeLevel::Hourly,
            &partition_keys,
            record,
            None,
        );
        let hour_buf = metrics_samples_data.entry(hour_key).or_default();
        let final_value_str = crate::common::json::to_string(&sample_values).unwrap();
        hour_buf.push(final_value_str);

        // update status
        let stream_status = metrics_status_map
            .entry(stream_name.clone())
            .or_insert(StreamStatus::new(&stream_name));
        stream_status.status.successful += 1;
    }
    let time = start.elapsed().as_secs_f64();

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, SAMPLES_NAME, StreamType::Metrics, None) {
        return Err(anyhow::anyhow!("stream [{SAMPLES_NAME}] is being deleted"));
    }

    // write sample records into sample table
    let mut stream_file_name = "".to_string();
    let mut req_stats = write_file(
        metrics_samples_data,
        thread_id,
        org_id,
        SAMPLES_NAME,
        &mut stream_file_name,
        StreamType::Metrics,
    );
    req_stats.response_time = time;

    report_usage_stats(
        req_stats,
        org_id,
        SAMPLES_NAME,
        StreamType::Metrics,
        UsageType::JsonMetrics,
        0,
    )
    .await;

    // write series data into series table
    let mut series_file_name = "".to_string();
    super::write_series_file(
        metrics_series_values,
        thread_id,
        org_id,
        &mut series_file_name,
    );

    let schema_exists = stream_schema_exists(
        org_id,
        SERIES_NAME,
        StreamType::Metrics,
        &mut metrics_schema_map,
    )
    .await;

    if !schema_exists.has_fields {
        // create series stream schema
        let file = OpenOptions::new()
            .read(true)
            .open(&series_file_name)
            .unwrap();
        add_stream_schema(
            org_id,
            SERIES_NAME,
            StreamType::Metrics,
            &file,
            &mut metrics_schema_map,
            now_ts,
        )
        .await;
        // set the series stream partition time level is daily
        let settings = StreamSettings {
            partition_time_level: Some(PartitionTimeLevel::Daily),
            ..Default::default()
        };
        save_stream_settings(org_id, SERIES_NAME, StreamType::Metrics, settings).await?;
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/metrics/_json",
            "200",
            org_id,
            "",
            &StreamType::Metrics.to_string(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/metrics/_json",
            "200",
            org_id,
            "",
            &StreamType::Metrics.to_string(),
        ])
        .inc();
    //let fns_length: usize = stream_transform_map.values().map(|v| v.len()).sum();

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        metrics_status_map.values().map(|v| v.to_owned()).collect(),
    ))
}

fn apply_func(
    runtime: &mut Runtime,
    org_id: &str,
    metric_name: &str,
    value: &mut json::Value,
) -> Result<()> {
    let (local_tans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Metrics,
        metric_name,
    );

    *value = crate::service::ingestion::apply_stream_transform(
        &local_tans,
        value,
        &stream_vrl_map,
        metric_name,
        runtime,
    )?;

    Ok(())
}
