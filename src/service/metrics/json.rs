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

use std::{collections::HashMap, io::BufReader, sync::Arc};

use actix_web::{http, web};
use anyhow::{anyhow, Result};
use config::{
    cluster,
    meta::{
        stream::{PartitioningDetails, StreamType},
        usage::UsageType,
    },
    metrics,
    utils::{flatten, json, schema::infer_json_schema, schema_ext::SchemaExt, time},
    CONFIG,
};
use datafusion::arrow::datatypes::Schema;
use infra::schema::unwrap_partition_time_level;
use vrl::compiler::runtime::Runtime;

use super::get_exclude_labels;
use crate::{
    common::meta::{
        authz::Authz,
        ingestion::{IngestionResponse, StreamStatus},
        prom::{Metadata, HASH_LABEL, METADATA_LABEL, NAME_LABEL, TYPE_LABEL, VALUE_LABEL},
        stream::SchemaRecords,
    },
    service::{
        db, format_stream_name,
        ingestion::{get_wal_time_key, write_file},
        schema::{check_for_schema, SchemaCache},
        usage::report_request_usage_stats,
    },
};

pub async fn ingest(org_id: &str, body: web::Bytes, thread_id: usize) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(anyhow::anyhow!(
            "Quota exceeded for this organization [{}]",
            org_id
        ));
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Ok(IngestionResponse {
            code: http::StatusCode::SERVICE_UNAVAILABLE.into(),
            status: vec![],
            error: Some(e.to_string()),
        });
    }

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_status_map: HashMap<String, StreamStatus> = HashMap::new();
    let mut stream_data_buf: HashMap<String, HashMap<String, SchemaRecords>> = HashMap::new();
    let mut stream_partitioning_map: HashMap<String, PartitioningDetails> = HashMap::new();

    let reader: Vec<json::Value> = json::from_slice(&body)?;
    for record in reader.into_iter() {
        // JSON Flattening
        let mut record = flatten::flatten(record)?;
        // check data type
        let record = record.as_object_mut().unwrap();
        let stream_name = match record.get(NAME_LABEL).ok_or(anyhow!("missing __name__"))? {
            json::Value::String(s) => format_stream_name(s),
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
            if !stream_schema_map.contains_key(&stream_name) {
                let mut schema =
                    infra::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
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
                    db::schema::merge(
                        org_id,
                        &stream_name,
                        StreamType::Metrics,
                        &schema,
                        Some(chrono::Utc::now().timestamp_micros()),
                    )
                    .await?;
                }
                let fields_map = schema
                    .fields()
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (f.name().to_owned(), i))
                    .collect();
                stream_schema_map.insert(stream_name.clone(), SchemaCache::new(schema, fields_map));
            }
            continue;
        }

        // apply functions
        let record = json::Value::Object(record.to_owned());
        let mut record = apply_func(&mut runtime, org_id, &stream_name, record)?;

        let record = record.as_object_mut().unwrap();

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
        // add hash
        let hash = super::signature_without_labels(record, &get_exclude_labels());
        record.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));

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

        // check schema
        if !stream_schema_map.contains_key(&stream_name) {
            let mut schema = infra::schema::get(org_id, &stream_name, StreamType::Metrics).await?;
            if schema.fields().is_empty() {
                let mut schema_reader = BufReader::new(record_str.as_bytes());
                let inferred_schema =
                    infer_json_schema(&mut schema_reader, None, StreamType::Metrics).unwrap();
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
                schema = inferred_schema.with_metadata(extra_metadata);
                db::schema::merge(
                    org_id,
                    &stream_name,
                    StreamType::Metrics,
                    &schema,
                    Some(timestamp),
                )
                .await?;
                crate::common::utils::auth::set_ownership(
                    org_id,
                    &StreamType::Metrics.to_string(),
                    Authz::new(&stream_name),
                )
                .await;
            }
            let fields_map = schema
                .fields()
                .iter()
                .enumerate()
                .map(|(i, f)| (f.name().to_owned(), i))
                .collect();
            stream_schema_map.insert(stream_name.clone(), SchemaCache::new(schema, fields_map));
        }

        // check for schema evolution
        let _ = check_for_schema(
            org_id,
            &stream_name,
            StreamType::Metrics,
            &mut stream_schema_map,
            vec![record],
            timestamp,
        )
        .await;

        // write into buffer
        if !stream_partitioning_map.contains_key(&stream_name) {
            let partition_det = crate::service::ingestion::get_stream_partition_keys(
                org_id,
                &StreamType::Metrics,
                &stream_name,
            )
            .await;
            stream_partitioning_map.insert(stream_name.to_string(), partition_det.clone());
        }

        let partition_det = stream_partitioning_map.get(&stream_name).unwrap();
        let partition_keys = partition_det.partition_keys.clone();
        let partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Metrics);

        let schema = stream_schema_map
            .get(&stream_name)
            .unwrap()
            .schema()
            .clone()
            .with_metadata(HashMap::new());
        let schema_key = schema.hash_key();
        let hour_key = get_wal_time_key(
            timestamp,
            &partition_keys,
            partition_time_level,
            record,
            Some(&schema_key),
        );
        let stream_buf = stream_data_buf.entry(stream_name.to_string()).or_default();
        let hour_buf = stream_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key,
            schema: Arc::new(schema),
            records: vec![],
            records_size: 0,
        });
        hour_buf
            .records
            .push(Arc::new(json::Value::Object(record.to_owned())));
        hour_buf.records_size += record_str.len();

        // update status
        let stream_status = stream_status_map
            .entry(stream_name.clone())
            .or_insert_with(|| StreamStatus::new(&stream_name));
        stream_status.status.successful += 1;
    }

    // write data to wal
    let time = start.elapsed().as_secs_f64();
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Metrics.to_string()).await;
    for (stream_name, stream_data) in stream_data_buf {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            StreamType::Metrics,
            &stream_name,
            None,
        ) {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }

        let mut req_stats = write_file(&writer, &stream_name, stream_data).await;
        req_stats.response_time = time;
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            UsageType::JsonMetrics,
            0,
        )
        .await;
    }
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
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
    // let fns_length: usize = stream_transform_map.values().map(|v| v.len()).sum();

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        stream_status_map.values().map(|v| v.to_owned()).collect(),
    ))
}

fn apply_func(
    runtime: &mut Runtime,
    org_id: &str,
    metric_name: &str,
    value: json::Value,
) -> Result<json::Value> {
    let (local_tans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Metrics,
        metric_name,
    );

    crate::service::ingestion::apply_stream_functions(
        &local_tans,
        value,
        &stream_vrl_map,
        metric_name,
        runtime,
    )
}
