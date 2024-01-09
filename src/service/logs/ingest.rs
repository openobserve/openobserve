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

use std::{
    collections::HashMap,
    io::{BufRead, Read},
};

use actix_web::http;
use chrono::{Duration, Utc};
use config::{meta::stream::StreamType, metrics, CONFIG, DISTINCT_FIELDS};
use datafusion::arrow::datatypes::Schema;
use flate2::read::GzDecoder;
use vrl::compiler::runtime::Runtime;

use crate::{
    common::{
        meta::{
            alerts::Alert,
            functions::{StreamTransform, VRLResultResolver},
            ingestion::{
                AWSRecordType, GCPIngestionResponse, IngestionData, IngestionDataIter,
                IngestionError, IngestionRequest, IngestionResponse, KinesisFHData,
                KinesisFHIngestionResponse, StreamStatus,
            },
            stream::{SchemaRecords, StreamParams},
            usage::UsageType,
        },
        utils::{flatten, json, time::parse_timestamp_micro_from_value},
    },
    service::{
        distinct_values, get_formatted_stream_name,
        ingestion::{evaluate_trigger, is_ingestion_allowed, write_file, TriggerAlertData},
        logs::StreamMeta,
        schema::get_upto_discard_error,
        usage::report_request_usage_stats,
    },
};

pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    in_req: IngestionRequest<'_>,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    // check stream
    let mut stream_schema_map: HashMap<String, Schema> = HashMap::new();
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;
    if let Some(value) = is_ingestion_allowed(org_id, Some(stream_name)) {
        return Err(value);
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Ok(IngestionResponse {
            code: http::StatusCode::SERVICE_UNAVAILABLE.into(),
            status: vec![],
            error: Some(e.to_string()),
        });
    }

    let min_ts =
        (Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    // Start Register Transforms for stream
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    crate::service::ingestion::get_stream_alerts(
        org_id,
        StreamType::Logs,
        stream_name,
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alerts

    let mut stream_status = StreamStatus::new(stream_name);
    let mut distinct_values = Vec::with_capacity(16);
    let mut trigger: TriggerAlertData = None;

    let partition_det =
        crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map).await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    let mut write_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let json_req: Vec<json::Value>; // to hold json request because of borrow checker
    let (ep, data) = match in_req {
        IngestionRequest::JSON(req) => {
            json_req = json::from_slice(req).unwrap_or({
                let val: json::Value = json::from_slice(req)?;
                vec![val]
            });
            ("/api/org/ingest/logs/_json", IngestionData::JSON(&json_req))
        }
        IngestionRequest::GCP(req) => ("/api/org/ingest/logs/_gcs", IngestionData::GCP(req)),
        IngestionRequest::Multi(req) => ("/api/org/ingest/logs/_multi", IngestionData::Multi(req)),
        IngestionRequest::KinesisFH(req) => (
            "/api/org/ingest/logs/_kinesis",
            IngestionData::KinesisFH(req),
        ),
    };

    for ret in data.iter() {
        let item = match ret {
            Ok(item) => item,
            Err(e) => {
                log::error!("IngestionError: {:?}", e);
                return Err(anyhow::anyhow!("Failed processing: {:?}", e));
            }
        };

        let mut res = match apply_functions(
            item,
            &local_trans,
            &stream_vrl_map,
            stream_name,
            &mut runtime,
        ) {
            Ok(res) => res,
            Err(e) => {
                stream_status.status.failed += 1;
                stream_status.status.error = e.to_string();
                continue;
            }
        };

        let local_val = res.as_object_mut().unwrap();
        if let Err(e) = handle_timestamp(local_val, min_ts) {
            stream_status.status.failed += 1;
            stream_status.status.error = e.to_string();
            continue;
        }

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
            &mut write_buf,
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
    }

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    let mut req_stats = write_file(&writer, stream_name, write_buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    // only one trigger per request
    evaluate_trigger(trigger).await;

    // update ingestion metrics
    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            ep,
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();
    req_stats.response_time = start.elapsed().as_secs_f64();

    // report data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::Json,
        local_trans.len() as u16,
    )
    .await;

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

pub fn apply_functions<'a>(
    item: json::Value,
    local_trans: &[StreamTransform],
    stream_vrl_map: &'a HashMap<String, VRLResultResolver>,
    stream_name: &'a str,
    runtime: &mut Runtime,
) -> Result<json::Value, anyhow::Error> {
    let mut value = flatten::flatten(item)?;

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_transform(
            local_trans,
            value,
            stream_vrl_map,
            stream_name,
            runtime,
        )?;
    }

    if value.is_null() || !value.is_object() {
        Err(anyhow::Error::msg("apply functions failure"))
    } else {
        Ok(value)
    }
}

pub fn handle_timestamp(
    local_val: &mut json::Map<String, json::Value>,
    min_ts: i64,
) -> Result<(), anyhow::Error> {
    // handle timestamp
    let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
        Some(v) => match parse_timestamp_micro_from_value(v) {
            Ok(t) => t,
            Err(_) => return Err(anyhow::Error::msg("Cant parse timestamp")),
        },
        None => Utc::now().timestamp_micros(),
    };
    // check ingestion time
    if timestamp < min_ts {
        return Err(get_upto_discard_error());
    }
    local_val.insert(
        CONFIG.common.column_timestamp.clone(),
        json::Value::Number(timestamp.into()),
    );
    Ok(())
}

impl<'a> Iterator for IngestionDataIter<'a> {
    type Item = Result<json::Value, IngestionError>;

    fn next(&mut self) -> Option<Result<json::Value, IngestionError>> {
        match self {
            IngestionDataIter::JSONIter(iter) => iter.next().cloned().map(Ok),
            IngestionDataIter::MultiIter(iter) => loop {
                match iter.next() {
                    Some(Ok(line)) if line.trim().is_empty() => {
                        // If the line is empty, just continue to the next iteration.
                        continue;
                    }
                    Some(Ok(line)) => {
                        // If the line is not empty, attempt to parse it as JSON.
                        return Some(json::from_str(&line).map_err(IngestionError::from));
                    }
                    Some(Err(e)) => {
                        // If there's an error reading the line, return it.
                        return Some(Err(IngestionError::from(e)));
                    }
                    None => {
                        // If there are no more lines, return None.
                        return None;
                    }
                }
            },
            IngestionDataIter::GCP(iter, err) => match err {
                Some(e) => Some(Err(IngestionError::GCPError(e.clone()))),
                None => iter.next().map(Ok),
            },
            IngestionDataIter::KinesisFH(iter, err) => match err {
                Some(e) => Some(Err(IngestionError::AWSError(e.clone()))),
                None => iter.next().map(Ok),
            },
        }
    }
}

impl<'a> IngestionData<'a> {
    pub fn iter(&'a self) -> IngestionDataIter<'a> {
        match self {
            IngestionData::JSON(vec) => IngestionDataIter::JSONIter(vec.iter()),
            IngestionData::Multi(data) => {
                IngestionDataIter::MultiIter(std::io::BufReader::new(*data).lines())
            }
            IngestionData::GCP(request) => {
                let data = &request.message.data;
                let request_id = &request.message.message_id;
                let req_timestamp = &request.message.publish_time;
                match decode_and_decompress(data) {
                    Ok((decompressed_data, _)) => {
                        let value: json::Value = json::from_str(&decompressed_data).unwrap();
                        IngestionDataIter::GCP(vec![value].into_iter(), None)
                    }
                    Err(e) => IngestionDataIter::GCP(
                        vec![].into_iter(),
                        Some(GCPIngestionResponse {
                            request_id: request_id.to_string(),
                            error_message: Some(e.to_string()),
                            timestamp: req_timestamp.to_string(),
                        }),
                    ),
                }
            }
            IngestionData::KinesisFH(request) => {
                let mut events = Vec::new();
                let request_id = &request.request_id;
                let req_timestamp = request.timestamp.unwrap_or(Utc::now().timestamp_micros());

                for record in &request.records {
                    match decode_and_decompress(&record.data) {
                        Err(err) => {
                            return IngestionDataIter::KinesisFH(
                                events.into_iter(),
                                Some(KinesisFHIngestionResponse {
                                    request_id: request_id.to_string(),
                                    error_message: Some(err.to_string()),
                                    timestamp: req_timestamp,
                                }),
                            );
                        }
                        Ok((decompressed_data, record_type)) => {
                            let mut value;
                            // let mut timestamp;
                            if record_type.eq(&AWSRecordType::Cloudwatch) {
                                let kfh_data: KinesisFHData =
                                    json::from_str(&decompressed_data).unwrap();

                                for event in kfh_data.log_events.iter() {
                                    value = json::to_value(event).unwrap();
                                    let local_val = value.as_object_mut().unwrap();

                                    local_val.insert(
                                        "requestId".to_owned(),
                                        request.request_id.clone().into(),
                                    );
                                    local_val.insert(
                                        "messageType".to_owned(),
                                        kfh_data.message_type.clone().into(),
                                    );
                                    local_val
                                        .insert("owner".to_owned(), kfh_data.owner.clone().into());
                                    local_val.insert(
                                        "logGroup".to_owned(),
                                        kfh_data.log_group.clone().into(),
                                    );
                                    local_val.insert(
                                        "logStream".to_owned(),
                                        kfh_data.log_stream.clone().into(),
                                    );
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
                                                local_val.insert(
                                                    "message".to_owned(),
                                                    event.message.clone(),
                                                );
                                            }
                                            Ok(message_val) => {
                                                local_val.insert(
                                                    "message".to_owned(),
                                                    message_val.clone(),
                                                );
                                            }
                                        }
                                    } else {
                                        local_val.insert("message".to_owned(), local_msg.into());
                                    }

                                    local_val.insert(
                                        CONFIG.common.column_timestamp.clone(),
                                        event.timestamp.into(),
                                    );

                                    value = local_val.clone().into();

                                    events.push(value);
                                }
                            } else {
                                value = json::from_str(&decompressed_data).unwrap();
                                events.push(value);
                            };
                        }
                    }
                }
                return IngestionDataIter::KinesisFH(events.into_iter(), None);
            }
        }
    }
}

pub fn decode_and_decompress(
    encoded_data: &str,
) -> Result<(String, AWSRecordType), Box<dyn std::error::Error>> {
    let decoded_data = crate::common::utils::base64::decode_raw(encoded_data)?;
    let mut gz = GzDecoder::new(&decoded_data[..]);
    let mut decompressed_data = String::new();
    match gz.read_to_string(&mut decompressed_data) {
        Ok(_) => Ok((decompressed_data, AWSRecordType::Cloudwatch)),
        Err(_) => Ok((String::from_utf8(decoded_data)?, AWSRecordType::JSON)),
    }
}

#[cfg(test)]
mod tests {
    use super::decode_and_decompress;

    #[test]
    fn test_decode_and_decompress_success() {
        let encoded_data = "H4sIAAAAAAAAADWO0QqCMBiFX2XsOkKJZHkXot5YQgpdhMTSPzfSTbaZhPjuzbTLj3M45xtxC1rTGvJPB9jHQXrOL2lyP4VZdoxDvMFyEKDmpJF9NVBTskTW2gaNrGMl+85mC2VGAW0X1P1Dl4p3hksR8caA0ti/Fb9e+AZhZhwxr5a64VbD0NaOuR5xPLJzycEh+81fbxa4JmjVQ6uejwIG5YuLGjGgjWFIPlFll7ig8zOKuAImNWzxVExfL8ipzewAAAA=";
        let expected = "{\"messageType\":\"CONTROL_MESSAGE\",\"owner\":\"CloudwatchLogs\",\"logGroup\":\"\",\"logStream\":\"\",\"subscriptionFilters\":[],\"logEvents\":[{\"id\":\"\",\"timestamp\":1680683189085,\"message\":\"CWL CONTROL MESSAGE: Checking health of destination Firehose.\"}]}";
        let result =
            decode_and_decompress(encoded_data).expect("Failed to decode and decompress data");
        assert_eq!(result.0, expected);
    }

    #[test]
    fn test_decode_success() {
        let encoded_data = "eyJtZXNzYWdlIjoiMiAwNTg2OTQ4NTY0NzYgZW5pLTAzYzBmNWJhNzlhNjZlZjE3IDEwLjMuMTY2LjcxIDEwLjMuMTQxLjIwOSA0NDMgMzg2MzQgNiAxMDMgNDI5MjYgMTY4MDgzODU1NiAxNjgwODM4NTc4IEFDQ0VQVCBPSyJ9Cg==";
        let expected = "{\"message\":\"2 058694856476 eni-03c0f5ba79a66ef17 10.3.166.71 10.3.141.209 443 38634 6 103 42926 1680838556 1680838578 ACCEPT OK\"}\n";
        let result = decode_and_decompress(encoded_data).expect("Failed to decode data");
        assert_eq!(result.0, expected);
    }

    #[test]
    fn test_decode_and_decompress_invalid_base64() {
        let encoded_data = "H4sIAAAAAAAC/ytJLS4BAAxGw7gNAAA&"; // Invalid base64 string
        let result = decode_and_decompress(encoded_data);
        assert!(
            result.is_err(),
            "Expected an error due to invalid base64 input"
        );
    }
}
