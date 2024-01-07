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

use std::io::{BufRead, BufReader};

use actix_web::web;
use ahash::AHashMap;
use chrono::{Duration, Utc};
use config::{meta::stream::StreamType, metrics, CONFIG, DISTINCT_FIELDS};
use datafusion::arrow::datatypes::Schema;

use super::StreamMeta;
use crate::{
    common::{
        infra::cluster,
        meta::{
            alerts::Alert,
            functions::{StreamTransform, VRLResultResolver},
            ingestion::{
                BulkResponse, BulkResponseError, BulkResponseItem, BulkStreamData, RecordStatus,
                StreamSchemaChk,
            },
            stream::PartitioningDetails,
            usage::UsageType,
        },
        utils::{flatten, json, time::parse_timestamp_micro_from_value},
    },
    service::{
        db, distinct_values,
        ingestion::{evaluate_trigger, write_file, TriggerAlertData},
        schema::{get_upto_discard_error, stream_schema_exists},
        usage::report_request_usage_stats,
    },
};

pub const TRANSFORM_FAILED: &str = "document_failed_transform";
pub const TS_PARSE_FAILED: &str = "timestamp_parsing_failed";
pub const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";

pub async fn ingest(
    org_id: &str,
    body: web::Bytes,
    thread_id: usize,
) -> Result<BulkResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(anyhow::anyhow!("Quota exceeded for this organization"));
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Err(anyhow::Error::msg(e.to_string()));
    }

    // let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let min_ts =
        (Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_vrl_map: AHashMap<String, VRLResultResolver> = AHashMap::new();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_data_map = AHashMap::new();

    let mut stream_transform_map: AHashMap<String, Vec<StreamTransform>> = AHashMap::new();
    let mut stream_partition_keys_map: AHashMap<String, (StreamSchemaChk, PartitioningDetails)> =
        AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let mut action = String::from("");
    let mut stream_name = String::from("");
    let mut doc_id = String::from("");
    let mut stream_trigger_map: AHashMap<String, TriggerAlertData> = AHashMap::new();

    let mut next_line_is_data = false;
    let reader = BufReader::new(body.as_ref());
    for line in reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

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

            crate::service::ingestion::get_stream_transforms(
                org_id,
                StreamType::Logs,
                &stream_name,
                &mut stream_transform_map,
                &mut stream_vrl_map,
            )
            .await;
            // End Register Transfoms for index

            // Start get stream alerts
            crate::service::ingestion::get_stream_alerts(
                org_id,
                StreamType::Logs,
                &stream_name,
                &mut stream_alerts_map,
            )
            .await;
            // End get stream alert

            if !stream_partition_keys_map.contains_key(&stream_name.clone()) {
                let stream_schema = stream_schema_exists(
                    org_id,
                    &stream_name,
                    StreamType::Logs,
                    &mut stream_schema_map,
                )
                .await;
                let partition_det = crate::service::ingestion::get_stream_partition_keys(
                    &stream_name,
                    &stream_schema_map,
                )
                .await;
                stream_partition_keys_map
                    .insert(stream_name.clone(), (stream_schema, partition_det));
            }

            stream_data_map
                .entry(stream_name.clone())
                .or_insert_with(|| BulkStreamData {
                    data: AHashMap::new(),
                });
        } else {
            next_line_is_data = false;

            let stream_data = stream_data_map.get_mut(&stream_name).unwrap();
            let buf = &mut stream_data.data;

            // Start row based transform

            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);

            // JSON Flattening
            let mut value = flatten::flatten(value)?;

            if let Some(transforms) = stream_transform_map.get(&key) {
                let mut ret_value = value.clone();
                ret_value = crate::service::ingestion::apply_stream_transform(
                    transforms,
                    ret_value,
                    &stream_vrl_map,
                    &stream_name,
                    &mut runtime,
                )?;

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
            // End row based transform

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
                            Some(TS_PARSE_FAILED.to_string()),
                            Some(TS_PARSE_FAILED.to_string()),
                        );
                        continue;
                    }
                },
                None => Utc::now().timestamp_micros(),
            };
            // check ingestion time
            if timestamp < min_ts {
                bulk_res.errors = true;
                let failure_reason = Some(get_upto_discard_error().to_string());
                add_record_status(
                    stream_name.clone(),
                    doc_id.clone(),
                    action.clone(),
                    value,
                    &mut bulk_res,
                    Some(TS_PARSE_FAILED.to_string()),
                    failure_reason,
                );
                continue;
            }
            local_val.insert(
                CONFIG.common.column_timestamp.clone(),
                json::Value::Number(timestamp.into()),
            );
            let (partition_keys, partition_time_level) =
                match stream_partition_keys_map.get(&stream_name) {
                    Some((_, partition_det)) => (
                        partition_det.partition_keys.clone(),
                        partition_det.partition_time_level,
                    ),
                    None => (vec![], None),
                };

            // only for bulk insert
            let mut status = RecordStatus::default();
            let need_trigger = !stream_trigger_map.contains_key(&stream_name);

            let local_trigger = match super::add_valid_record(
                &StreamMeta {
                    org_id: org_id.to_string(),
                    stream_name: stream_name.clone(),
                    partition_keys: &partition_keys,
                    partition_time_level: &partition_time_level,
                    stream_alerts_map: &stream_alerts_map,
                },
                &mut stream_schema_map,
                &mut status,
                buf,
                local_val,
                need_trigger,
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    bulk_res.errors = true;
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        value,
                        &mut bulk_res,
                        Some(TS_PARSE_FAILED.to_string()),
                        Some(e.to_string()),
                    );
                    continue;
                }
            };
            if local_trigger.is_some() {
                stream_trigger_map.insert(stream_name.clone(), local_trigger);
            }

            // get distinct_value item
            for field in DISTINCT_FIELDS.iter() {
                if let Some(val) = local_val.get(field) {
                    if !val.is_null() {
                        distinct_values.push(distinct_values::DvItem {
                            stream_type: StreamType::Logs,
                            stream_name: stream_name.clone(),
                            field_name: field.to_string(),
                            field_value: val.as_str().unwrap().to_string(),
                            filter_name: "".to_string(),
                            filter_value: "".to_string(),
                        });
                    }
                }
            }

            if status.failed > 0 {
                bulk_res.errors = true;
                add_record_status(
                    stream_name.clone(),
                    doc_id.clone(),
                    action.clone(),
                    value,
                    &mut bulk_res,
                    Some(SCHEMA_CONFORMANCE_FAILED.to_string()),
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

    // write data to wal
    let time = start.elapsed().as_secs_f64();
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    for (stream_name, stream_data) in stream_data_map {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(org_id, &stream_name, StreamType::Logs, None)
        {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }
        // write to file
        let mut req_stats = write_file(&writer, &stream_name, stream_data.data).await;
        req_stats.response_time += time;
        // metric + data usage
        let fns_length: usize = stream_transform_map.values().map(|v| v.len()).sum();
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Logs,
            UsageType::Bulk,
            fns_length as u16,
        )
        .await;
    }
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // only one trigger per request, as it updates etcd
    for (_, entry) in stream_trigger_map {
        evaluate_trigger(entry).await;
    }

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_bulk",
            "200",
            org_id,
            "",
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();
    bulk_res.took = start.elapsed().as_millis();

    Ok(bulk_res)
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
                "0".to_owned(), // TODO check
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
