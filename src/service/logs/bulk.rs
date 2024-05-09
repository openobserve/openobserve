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
    sync::Arc,
};

use actix_web::web;
use anyhow::{Error, Result};
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::{
        stream::{PartitioningDetails, Routing, StreamType},
        usage::UsageType,
    },
    metrics,
    utils::{flatten, json, schema_ext::SchemaExt, time::parse_timestamp_micro_from_value},
    BLOCKED_STREAMS, CONFIG, DISTINCT_FIELDS,
};
use infra::schema::unwrap_partition_time_level;

use super::{add_record, cast_to_schema_v1, StreamMeta};
use crate::{
    common::meta::{
        alerts::Alert,
        functions::{StreamTransform, VRLResultResolver},
        ingestion::{
            BulkResponse, BulkResponseError, BulkResponseItem, BulkStreamData, RecordStatus,
            StreamSchemaChk,
        },
        stream::StreamParams,
    },
    service::{
        db, format_stream_name,
        ingestion::{evaluate_trigger, write_file, TriggerAlertData},
        metadata::{distinct_values::DvItem, write, MetadataItem, MetadataType},
        schema::{
            get_invalid_schema_start_dt, get_upto_discard_error, stream_schema_exists, SchemaCache,
        },
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
    user_email: &str,
) -> Result<BulkResponse, anyhow::Error> {
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
    ingester::check_memtable_size().map_err(|e| Error::msg(e.to_string()))?;

    // let mut errors = false;
    let mut bulk_res = BulkResponse {
        took: 0,
        errors: false,
        items: vec![],
    };

    let min_ts = (Utc::now() - Duration::try_hours(CONFIG.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_vrl_map: HashMap<String, VRLResultResolver> = HashMap::new();
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_data_map = HashMap::new();

    let mut stream_functions_map: HashMap<String, Vec<StreamTransform>> = HashMap::new();
    let mut stream_partition_keys_map: HashMap<String, (StreamSchemaChk, PartitioningDetails)> =
        HashMap::new();
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let mut action = String::from("");
    let mut stream_name = String::from("");
    let mut doc_id = String::from("");
    let mut stream_trigger_map: HashMap<String, Option<TriggerAlertData>> = HashMap::new();

    let mut blocked_stream_warnings: HashMap<String, bool> = HashMap::new();

    let mut stream_routing_map: HashMap<String, Vec<Routing>> = HashMap::new();

    let mut user_defined_schema_map: HashMap<String, Vec<String>> = HashMap::new();

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

            if !CONFIG.common.skip_formatting_bulk_stream_name {
                stream_name = format_stream_name(&stream_name);
            }

            // skip blocked streams
            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);
            if BLOCKED_STREAMS.contains(&key.as_str()) {
                // print warning only once
                blocked_stream_warnings.entry(key).or_insert_with(|| {
                    log::warn!("stream [{stream_name}] is blocked from ingestion");
                    true
                });
                continue; // skip
            }

            // Start get routing keys
            crate::service::ingestion::get_stream_routing(
                StreamParams {
                    org_id: org_id.to_owned().into(),
                    stream_type: StreamType::Logs,
                    stream_name: stream_name.to_owned().into(),
                },
                &mut stream_routing_map,
            )
            .await;

            let mut streams = vec![StreamParams {
                org_id: org_id.to_owned().into(),
                stream_type: StreamType::Logs,
                stream_name: stream_name.to_owned().into(),
            }];

            if let Some(routes) = stream_routing_map.get(&stream_name) {
                for route in routes {
                    streams.push(StreamParams {
                        org_id: org_id.to_owned().into(),
                        stream_type: StreamType::Logs,
                        stream_name: route.destination.clone().into(),
                    });
                }
            }

            // End get stream keys

            crate::service::ingestion::get_user_defined_schema(
                &streams,
                &mut user_defined_schema_map,
            )
            .await;

            next_line_is_data = true;

            // Start Register functions for stream
            crate::service::ingestion::get_stream_functions(
                &streams,
                &mut stream_functions_map,
                &mut stream_vrl_map,
            )
            .await;
            // End Register functions for index

            // Start get stream alerts
            crate::service::ingestion::get_stream_alerts(&streams, &mut stream_alerts_map).await;
            // End get stream alert

            for stream in streams {
                let local_stream_name = stream.stream_name.to_string();
                if let std::collections::hash_map::Entry::Vacant(e) =
                    stream_partition_keys_map.entry(local_stream_name.to_owned())
                {
                    let stream_schema = stream_schema_exists(
                        org_id,
                        &local_stream_name,
                        StreamType::Logs,
                        &mut stream_schema_map,
                    )
                    .await;
                    let partition_det = crate::service::ingestion::get_stream_partition_keys(
                        org_id,
                        &StreamType::Logs,
                        &local_stream_name,
                    )
                    .await;
                    e.insert((stream_schema, partition_det));
                }
            }

            stream_data_map
                .entry(stream_name.clone())
                .or_insert_with(|| BulkStreamData {
                    data: HashMap::new(),
                });
        } else {
            next_line_is_data = false;

            // JSON Flattening
            let mut value = flatten::flatten_with_level(value, CONFIG.limit.ingest_flatten_level)?;

            if let Some(routing) = stream_routing_map.get(&stream_name) {
                if !routing.is_empty() {
                    for route in routing {
                        let mut is_routed = true;
                        let val = &route.routing;
                        for q_condition in val.iter() {
                            is_routed =
                                is_routed && q_condition.evaluate(value.as_object().unwrap()).await;
                        }
                        if is_routed && !val.is_empty() {
                            stream_name = route.destination.clone();
                            if !stream_data_map.contains_key(&stream_name) {
                                stream_data_map.insert(
                                    stream_name.clone(),
                                    BulkStreamData {
                                        data: HashMap::new(),
                                    },
                                );
                            }
                            break;
                        }
                    }
                }
            }

            let stream_data = stream_data_map.get_mut(&stream_name).unwrap();
            let buf = &mut stream_data.data;

            let key = format!("{org_id}/{}/{stream_name}", StreamType::Logs);

            // Start row based transform
            if let Some(transforms) = stream_functions_map.get(&key) {
                let mut ret_value = value.clone();
                ret_value = crate::service::ingestion::apply_stream_functions(
                    transforms,
                    ret_value,
                    &stream_vrl_map,
                    org_id,
                    &stream_name,
                    &mut runtime,
                )?;

                if ret_value.is_null() || !ret_value.is_object() {
                    bulk_res.errors = true;
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        Some(value),
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
            let mut local_val = match value.take() {
                json::Value::Object(v) => v,
                _ => unreachable!(),
            };

            if let Some(fields) = user_defined_schema_map.get(&stream_name) {
                crate::service::logs::refactor_map(&mut local_val, fields);
            }

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
                            Some(value),
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
                    Some(value),
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

            let mut to_add_distinct_values = vec![];
            // get distinct_value items
            for field in DISTINCT_FIELDS.iter() {
                if let Some(val) = local_val.get(field) {
                    if !val.is_null() {
                        to_add_distinct_values.push(MetadataItem::DistinctValues(DvItem {
                            stream_type: StreamType::Logs,
                            stream_name: stream_name.clone(),
                            field_name: field.to_string(),
                            field_value: val.as_str().unwrap().to_string(),
                            filter_name: "".to_string(),
                            filter_value: "".to_string(),
                        }));
                    }
                }
            }

            // this is for schema inference at stream level , which avoids locks in case schema
            // changes are frequent within request
            if CONFIG.common.infer_schema_per_request {
                if let Err(e) = add_record(
                    &StreamMeta {
                        org_id: org_id.to_string(),
                        stream_name: stream_name.clone(),
                        partition_keys: &partition_keys,
                        partition_time_level: &partition_time_level,
                        stream_alerts_map: &stream_alerts_map,
                    },
                    buf,
                    local_val,
                )
                .await
                {
                    bulk_res.errors = true;
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        Some(value),
                        &mut bulk_res,
                        Some(TS_PARSE_FAILED.to_string()),
                        Some(e.to_string()),
                    );
                    continue;
                }
            } else {
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
                            Some(value),
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
                distinct_values.extend(to_add_distinct_values);

                if status.failed > 0 {
                    bulk_res.errors = true;
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        Some(value),
                        &mut bulk_res,
                        Some(SCHEMA_CONFORMANCE_FAILED.to_string()),
                        Some(status.error),
                    );
                } else {
                    add_record_status(
                        stream_name.clone(),
                        doc_id.clone(),
                        action.clone(),
                        None,
                        &mut bulk_res,
                        None,
                        None,
                    );
                }
            }
        }
    }

    // write data to wal
    let time = start.elapsed().as_secs_f64();
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    for (stream_name, mut stream_data) in stream_data_map {
        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(org_id, StreamType::Logs, &stream_name, None)
        {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }

        // new flow for schema inference at stream level
        stream_data.data = if CONFIG.common.infer_schema_per_request {
            process_record(
                &mut stream_data,
                &StreamParams {
                    org_id: org_id.to_owned().into(),
                    stream_name: stream_name.to_owned().into(),
                    stream_type: StreamType::Logs,
                },
                &mut stream_schema_map,
                &stream_partition_keys_map,
                &stream_alerts_map,
                &mut bulk_res,
                &mut stream_trigger_map,
            )
            .await?
        } else {
            stream_data.data
        };

        // write to file
        let mut req_stats = write_file(&writer, &stream_name, stream_data.data).await;
        req_stats.response_time += time;
        req_stats.user_email = Some(user_email.to_string());
        // metric + data usage
        let fns_length: usize = stream_functions_map.values().map(|v| v.len()).sum();
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
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
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

async fn process_record(
    stream_data: &mut BulkStreamData,
    stream: &StreamParams,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    stream_partition_keys_map: &HashMap<String, (StreamSchemaChk, PartitioningDetails)>,
    stream_alerts_map: &HashMap<String, Vec<Alert>>,
    bulk_res: &mut BulkResponse,
    stream_trigger_map: &mut HashMap<String, Option<TriggerAlertData>>,
) -> Result<HashMap<String, crate::common::meta::stream::SchemaRecords>, Error> {
    let mut new_stream_buf = HashMap::new();
    let mut trigger: TriggerAlertData = Vec::new();
    for schema_records in stream_data.data.values_mut() {
        // check schema
        let mut timestamp = 0;
        let mut records: Vec<&serde_json::Map<std::string::String, serde_json::Value>> =
            schema_records
                .records
                .iter()
                .map(|record| {
                    let rec = record.as_ref();
                    let rec_ts = rec
                        .get(&CONFIG.common.column_timestamp)
                        .unwrap()
                        .as_i64()
                        .unwrap();
                    if timestamp == 0 || timestamp < rec_ts {
                        timestamp = rec_ts;
                    };
                    rec.as_object().unwrap()
                })
                .collect();
        if let Err(e) = crate::service::schema::check_for_schema(
            &stream.org_id,
            &stream.stream_name,
            StreamType::Logs,
            stream_schema_map,
            records.clone(),
            timestamp,
        )
        .await
        {
            if e.to_string() == get_invalid_schema_start_dt().to_string() {
                log::error!(
                    "Invalid schema start_dt detected for stream: {}, start_dt: {}",
                    stream.stream_name,
                    timestamp
                );
                // discard records
                continue;
            } else {
                return Err(e);
            }
        }

        // get schema
        let rec_schema = stream_schema_map
            .get(&stream.stream_name.to_string())
            .unwrap();
        let schema_key = rec_schema.hash_key();

        let mut schema_latest_map = HashMap::with_capacity(rec_schema.schema().fields().len());
        for field in rec_schema.schema().fields() {
            schema_latest_map.insert(field.name(), field.data_type());
        }

        for rec in records.iter_mut() {
            let mut local_rec = rec.to_owned();
            let doc_id = match &local_rec.get("_id") {
                Some(v) => v.as_str().unwrap().to_string(),
                None => "".to_string(),
            };

            match cast_to_schema_v1(&mut local_rec, &schema_latest_map) {
                Ok(_) => {
                    let timestamp: i64 = local_rec
                        .get(&CONFIG.common.column_timestamp)
                        .unwrap()
                        .as_i64()
                        .unwrap();

                    let (partition_keys, partition_time_level) =
                        match stream_partition_keys_map.get(&stream.stream_name.to_string()) {
                            Some((_, partition_det)) => (
                                partition_det.partition_keys.clone(),
                                partition_det.partition_time_level,
                            ),
                            None => (vec![], None),
                        };

                    // get hour key
                    let hour_key = crate::service::ingestion::get_wal_time_key(
                        timestamp,
                        &partition_keys,
                        unwrap_partition_time_level(partition_time_level, StreamType::Logs),
                        &local_rec,
                        Some(schema_key),
                    );

                    let hour_buf = new_stream_buf.entry(hour_key).or_insert_with(|| {
                        let schema =
                            Arc::new(rec_schema.schema().clone().with_metadata(HashMap::new()));
                        let schema_key = schema.hash_key();
                        crate::common::meta::stream::SchemaRecords {
                            schema_key,
                            schema,
                            records: vec![],
                            records_size: 0,
                        }
                    });

                    if !stream_alerts_map.is_empty() {
                        // Start check for alert trigger
                        let key = format!(
                            "{}/{}/{}",
                            &stream.org_id,
                            StreamType::Logs,
                            &stream.stream_name,
                        );
                        if let Some(alerts) = stream_alerts_map.get(&key) {
                            for alert in alerts {
                                if let Ok(Some(v)) = alert.evaluate(Some(&local_rec)).await {
                                    trigger.push((alert.clone(), v));
                                }
                            }
                        }
                        // End check for alert trigger
                    }

                    let record_val = json::Value::Object(local_rec);
                    let record_size = json::estimate_json_bytes(&record_val);
                    hour_buf.records.push(Arc::new(record_val));
                    hour_buf.records_size += record_size;

                    add_record_status(
                        stream.stream_name.to_string(),
                        doc_id,
                        "".to_string(),
                        None,
                        bulk_res,
                        None,
                        None,
                    );
                }
                Err(e) => {
                    bulk_res.errors = true;

                    let record_val = json::Value::Object(local_rec);
                    add_record_status(
                        stream.stream_name.to_string(),
                        doc_id,
                        "".to_string(),
                        Some(record_val),
                        bulk_res,
                        Some(SCHEMA_CONFORMANCE_FAILED.to_string()),
                        Some(e.to_string()),
                    );
                    continue;
                }
            }
        }
    }
    if !trigger.is_empty() {
        stream_trigger_map.insert(stream.stream_name.to_string(), Some(trigger));
    }
    Ok(new_stream_buf)
}

fn add_record_status(
    stream_name: String,
    doc_id: String,
    action: String,
    value: Option<json::Value>,
    bulk_res: &mut BulkResponse,
    failure_type: Option<String>,
    failure_reason: Option<String>,
) {
    let mut item = HashMap::new();

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
            None,
            &mut bulk_res,
            None,
            None,
        );
        assert!(bulk_res.items.len() == 1);
    }
}
