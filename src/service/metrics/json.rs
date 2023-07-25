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
use datafusion::arrow::{datatypes::Schema, json::reader::infer_json_schema};
use std::fs::OpenOptions;
use std::{collections::HashMap, io::BufReader};
use vrl::compiler::runtime::Runtime;

use crate::common::infra::{
    cluster,
    config::{CONFIG, METRIC_SERIES_HASH},
    metrics,
};
use crate::common::meta::{
    ingestion::{IngestionResponse, StreamStatus},
    prom::{
        Metadata, HASH_LABEL, METADATA_LABEL, METRIC_NAME, NAME_LABEL, SERIES_NAME, TYPE_LABEL,
        VALUE_LABEL,
    },
    stream::PartitionTimeLevel,
    usage::UsageType,
    StreamType,
};
use crate::common::{flatten, json, time};
use crate::service::{
    db,
    ingestion::{get_wal_time_key, write_file},
    schema::{add_stream_schema, stream_schema_exists},
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
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_status_map: AHashMap<String, StreamStatus> = AHashMap::new();
    let mut stream_data_buf: AHashMap<String, AHashMap<String, Vec<String>>> = AHashMap::new();
    let mut metric_series_values: AHashMap<String, Vec<String>> = AHashMap::new();

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
            if stream_schema_map.get(&stream_name).is_none() {
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
                stream_schema_map.insert(stream_name.clone(), schema);
            }
            continue;
        }

        // apply functions
        let mut record = json::Value::Object(record.to_owned());
        apply_func(&mut runtime, org_id, &stream_name, &mut record)?;

        let record = record.as_object_mut().unwrap();

        // add hash
        let hash = super::signature_without_labels(
            record,
            &[VALUE_LABEL, CONFIG.common.column_timestamp.as_str()],
        );
        let hash_val: String = hash.into();
        let key = format!("{}/{}/{}", &org_id, stream_name.clone(), &hash_val);

        record.insert(
            HASH_LABEL.to_string(),
            json::Value::String(hash_val.clone()),
        );

        let present = METRIC_SERIES_HASH.get(&key);
        if present.is_none() {
            METRIC_SERIES_HASH.insert(key.clone(), true);
            let mut series_values = record.clone();
            series_values.remove_entry(VALUE_LABEL);
            series_values.insert(HASH_LABEL.to_string(), json::Value::String(hash_val));
            series_values.insert(
                CONFIG.common.column_timestamp.clone(),
                json::Value::Number(now_ts.into()),
            );
            let series_str = crate::common::json::to_string(&series_values).unwrap();
            metric_series_values
                .entry(stream_name.clone())
                .or_default()
                .push(series_str);
        }

        // check timestamp & value
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
        let record_str = json::to_string(&record).unwrap();

        let mut final_value_map: json::Map<String, json::Value> = record.clone();
        final_value_map.retain(|k, _| {
            k.eq(&CONFIG.common.column_timestamp)
                || k.eq(HASH_LABEL)
                || k.eq(VALUE_LABEL)
                || k.eq(NAME_LABEL)
        });

        // check schema
        if stream_schema_map.get(&stream_name).is_none() {
            let mut schema = db::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
            if schema.fields().is_empty() {
                let mut schema_reader = BufReader::new(record_str.as_bytes());
                schema = infer_json_schema(&mut schema_reader, None).unwrap();
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
            stream_schema_map.insert(stream_name.clone(), schema);
        }

        // write into buffer
        let partition_keys =
            crate::service::ingestion::get_stream_partition_keys(&stream_name, &stream_schema_map)
                .await;

        let stream_buf = stream_data_buf.entry(stream_name.to_string()).or_default();
        let hour_key = get_wal_time_key(
            timestamp,
            PartitionTimeLevel::Hourly,
            &partition_keys,
            record,
            None,
        );
        let hour_buf = stream_buf.entry(hour_key).or_default();
        let final_value_str = crate::common::json::to_string(&final_value_map).unwrap();
        hour_buf.push(final_value_str);

        // update status
        let stream_status = stream_status_map
            .entry(stream_name.clone())
            .or_insert(StreamStatus::new(&stream_name));
        stream_status.status.successful += 1;
    }
    let time = start.elapsed().as_secs_f64();

    for (stream_name, stream_data) in stream_data_buf {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            &stream_name,
            StreamType::Metrics,
            None,
        ) {
            return Err(anyhow!("stream [{stream_name}] is being deleted"));
        }
        let mut stream_file_name = "".to_string();
        let mut req_stats = write_file(
            stream_data,
            thread_id,
            org_id,
            METRIC_NAME,
            &mut stream_file_name,
            StreamType::Metrics,
        );
        req_stats.response_time = time;

        report_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            UsageType::JsonMetrics,
            0,
        )
        .await;
    }

    let mut series_file_name = "".to_string();
    super::write_series_file(
        metric_series_values,
        thread_id,
        org_id,
        &mut series_file_name,
    );

    let schema_exists = stream_schema_exists(
        org_id,
        SERIES_NAME,
        StreamType::Metrics,
        &mut stream_schema_map,
    )
    .await;

    if !schema_exists.has_fields {
        let file = OpenOptions::new()
            .read(true)
            .open(&series_file_name)
            .unwrap();
        add_stream_schema(
            org_id,
            SERIES_NAME,
            StreamType::Metrics,
            &file,
            &mut stream_schema_map,
            now_ts,
        )
        .await;
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
        stream_status_map.values().map(|v| v.to_owned()).collect(),
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
