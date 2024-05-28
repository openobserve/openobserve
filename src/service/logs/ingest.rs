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
    io::{BufRead, Read},
};

use actix_web::http;
use anyhow::Result;
use chrono::{Duration, Utc};
use config::{
    meta::{stream::StreamType, usage::UsageType},
    metrics,
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
    CONFIG, DISTINCT_FIELDS,
};
use flate2::read::GzDecoder;
use infra::schema::SchemaCache;
use vrl::compiler::runtime::Runtime;

use crate::{
    common::meta::{
        alerts::Alert,
        functions::{StreamTransform, VRLResultResolver},
        ingestion::{
            AWSRecordType, GCPIngestionResponse, IngestionData, IngestionDataIter, IngestionError,
            IngestionRequest, IngestionResponse, KinesisFHIngestionResponse, StreamStatus,
        },
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

pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    in_req: IngestionRequest<'_>,
    thread_id: usize,
    user_email: &str,
) -> Result<IngestionResponse> {
    let start = std::time::Instant::now();
    // check stream
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;
    check_ingestion_allowed(org_id, Some(stream_name))?;

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Ok(IngestionResponse {
            code: http::StatusCode::SERVICE_UNAVAILABLE.into(),
            status: vec![],
            error: Some(e.to_string()),
        });
    }

    let conf = CONFIG.read().await;
    let min_ts = (Utc::now() - Duration::try_hours(conf.limit.ingest_allowed_upto).unwrap())
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
    // End get stream alerts

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, HashSet<String>> = HashMap::new();
    crate::service::ingestion::get_user_defined_schema(
        &[stream_param],
        &mut user_defined_schema_map,
    )
    .await;
    // End get user defined schema

    let mut stream_status = StreamStatus::new(stream_name);
    let mut distinct_values = Vec::with_capacity(16);
    let mut trigger: Option<TriggerAlertData> = None;

    let partition_det = crate::service::ingestion::get_stream_partition_keys(
        org_id,
        &StreamType::Logs,
        stream_name,
    )
    .await;
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
            org_id,
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

        let mut local_val = match res.take() {
            json::Value::Object(val) => val,
            _ => unreachable!(),
        };

        if let Some(fields) = user_defined_schema_map.get(stream_name) {
            local_val = crate::service::logs::refactor_map(local_val, fields);
        }

        if let Err(e) = handle_timestamp(&mut local_val, min_ts) {
            stream_status.status.failed += 1;
            stream_status.status.error = e.to_string();
            continue;
        }

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

        // add distinct values
        distinct_values.extend(to_add_distinct_values);
    }

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Logs.to_string()).await;
    let mut req_stats = write_file(&writer, stream_name, write_buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
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
    req_stats.user_email = Some(user_email.to_string());

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
    org_id: &'a str,
    stream_name: &'a str,
    runtime: &mut Runtime,
) -> Result<json::Value> {
    let conf = CONFIG.blocking_read();
    let mut value = flatten::flatten_with_level(item, conf.limit.ingest_flatten_level)?;

    if !local_trans.is_empty() {
        value = crate::service::ingestion::apply_stream_functions(
            local_trans,
            value,
            stream_vrl_map,
            org_id,
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
    let conf = CONFIG.blocking_read();
    // handle timestamp
    let timestamp = match local_val.get(&conf.common.column_timestamp) {
        Some(v) => match parse_timestamp_micro_from_value(v) {
            Ok(t) => t,
            Err(_) => return Err(anyhow::Error::msg("Can't parse timestamp")),
        },
        None => Utc::now().timestamp_micros(),
    };
    // check ingestion time
    if timestamp < min_ts {
        return Err(get_upto_discard_error());
    }
    local_val.insert(
        conf.common.column_timestamp.clone(),
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
                    Ok(decompressed_data) => {
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
                        Ok(decompressed_data) => {
                            match deserialize_aws_record_from_str(&decompressed_data, request_id) {
                                Ok(parsed_events) => events.extend(parsed_events),
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
                            }
                        }
                    }
                }
                return IngestionDataIter::KinesisFH(events.into_iter(), None);
            }
        }
    }
}

pub fn decode_and_decompress(encoded_data: &str) -> Result<String, Box<dyn std::error::Error>> {
    let decoded_data = config::utils::base64::decode_raw(encoded_data)?;
    let mut gz = GzDecoder::new(&decoded_data[..]);
    let mut decompressed_data = String::new();
    match gz.read_to_string(&mut decompressed_data) {
        Ok(_) => Ok(decompressed_data),
        Err(_) => Ok(String::from_utf8(decoded_data)?),
    }
}

fn deserialize_aws_record_from_str(data: &str, request_id: &str) -> Result<Vec<json::Value>> {
    let mut events = vec![];
    let mut value;
    for line in data.lines() {
        match json::from_str(line) {
            Ok(AWSRecordType::KinesisFHLogs(kfh_log_data)) => {
                for event in kfh_log_data.log_events.iter() {
                    value = json::to_value(event)?;
                    let local_val = value
                        .as_object_mut()
                        .ok_or(anyhow::anyhow!("Error to convert Value to object"))?;

                    local_val.insert("requestId".to_owned(), request_id.into());
                    local_val.insert(
                        "messageType".to_owned(),
                        kfh_log_data.message_type.clone().into(),
                    );
                    local_val.insert("owner".to_owned(), kfh_log_data.owner.clone().into());
                    local_val.insert("logGroup".to_owned(), kfh_log_data.log_group.clone().into());
                    local_val.insert(
                        "logStream".to_owned(),
                        kfh_log_data.log_stream.clone().into(),
                    );
                    local_val.insert(
                        "subscriptionFilters".to_owned(),
                        kfh_log_data.subscription_filters.clone().into(),
                    );

                    let local_msg = event.message.as_str().unwrap();

                    if local_msg.starts_with('{') && local_msg.ends_with('}') {
                        let result: Result<json::Value, json::Error> = json::from_str(local_msg);

                        match result {
                            Err(_e) => {
                                local_val.insert("message".to_owned(), event.message.clone());
                            }
                            Ok(message_val) => {
                                local_val.insert("message".to_owned(), message_val.clone());
                            }
                        }
                    } else {
                        local_val.insert("message".to_owned(), local_msg.into());
                    }

                    local_val.insert(
                        CONFIG.blocking_read().common.column_timestamp.clone(),
                        event.timestamp.into(),
                    );

                    value = local_val.clone().into();
                    events.push(value);
                }
            }
            Ok(AWSRecordType::KinesisFHMetrics(kfh_metric_data)) => {
                // Parse "dimensions" and "values" fields from KinesisFHMetricData
                let values = json::to_value(kfh_metric_data.value.clone())?;
                let dimensions = kfh_metric_data.dimensions.clone();
                let timestamp = kfh_metric_data.timestamp;

                let mut parsed_metric_value = json::to_value(kfh_metric_data)?;
                let local_parsed_metric_value = parsed_metric_value.as_object_mut().ok_or(
                    anyhow::anyhow!("CloudWatch metrics failed to parse Metric Object"),
                )?;

                for (value_name, value_val) in values.as_object().ok_or(anyhow::anyhow!(
                    "CloudWatch metrics failed to Metric Value Object"
                ))? {
                    local_parsed_metric_value.insert(value_name.to_owned(), value_val.to_owned());
                }
                local_parsed_metric_value.remove("value");

                let metric_dimensions = dimensions
                    .as_object()
                    .ok_or(anyhow::anyhow!(
                        "CloudWatch metrics dimensions parsing failed"
                    ))?
                    .iter()
                    .map(|(k, v)| format!("{}=[{}]", k, v))
                    .collect::<Vec<_>>()
                    .join(", ");

                local_parsed_metric_value
                    .insert("metric_dimensions".to_owned(), metric_dimensions.into());
                local_parsed_metric_value.remove("dimensions");

                local_parsed_metric_value.insert(
                    CONFIG.blocking_read().common.column_timestamp.clone(),
                    timestamp.into(),
                );
                local_parsed_metric_value.remove("timestamp");

                value = local_parsed_metric_value.clone().into();
                events.push(value);
            }
            _ => {
                value = json::from_str(line)?;
                events.push(value);
            }
        }
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::{decode_and_decompress, deserialize_aws_record_from_str};

    #[test]
    fn test_decode_and_decompress_success() {
        let encoded_data = "H4sIAAAAAAAAADWO0QqCMBiFX2XsOkKJZHkXot5YQgpdhMTSPzfSTbaZhPjuzbTLj3M45xtxC1rTGvJPB9jHQXrOL2lyP4VZdoxDvMFyEKDmpJF9NVBTskTW2gaNrGMl+85mC2VGAW0X1P1Dl4p3hksR8caA0ti/Fb9e+AZhZhwxr5a64VbD0NaOuR5xPLJzycEh+81fbxa4JmjVQ6uejwIG5YuLGjGgjWFIPlFll7ig8zOKuAImNWzxVExfL8ipzewAAAA=";
        let expected = "{\"messageType\":\"CONTROL_MESSAGE\",\"owner\":\"CloudwatchLogs\",\"logGroup\":\"\",\"logStream\":\"\",\"subscriptionFilters\":[],\"logEvents\":[{\"id\":\"\",\"timestamp\":1680683189085,\"message\":\"CWL CONTROL MESSAGE: Checking health of destination Firehose.\"}]}";
        let result =
            decode_and_decompress(encoded_data).expect("Failed to decode and decompress data");
        assert_eq!(result, expected);
    }

    #[test]
    fn test_decode_success() {
        let encoded_data = "eyJtZXNzYWdlIjoiMiAwNTg2OTQ4NTY0NzYgZW5pLTAzYzBmNWJhNzlhNjZlZjE3IDEwLjMuMTY2LjcxIDEwLjMuMTQxLjIwOSA0NDMgMzg2MzQgNiAxMDMgNDI5MjYgMTY4MDgzODU1NiAxNjgwODM4NTc4IEFDQ0VQVCBPSyJ9Cg==";
        let expected = "{\"message\":\"2 058694856476 eni-03c0f5ba79a66ef17 10.3.166.71 10.3.141.209 443 38634 6 103 42926 1680838556 1680838578 ACCEPT OK\"}\n";
        let result = decode_and_decompress(encoded_data).expect("Failed to decode data");
        assert_eq!(result, expected);
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

    #[test]
    fn test_deserialize_from_str_metrics() {
        let encoded_data = "eyJtZXRyaWNfc3RyZWFtX25hbWUiOiJDdXN0b21QYXJ0aWFsLUJDbjVjQSIsImFjY291bnRfaWQiOiI3MzkxNDcyMjI5ODkiLCJyZWdpb24iOiJ1cy1lYXN0LTIiLCJuYW1lc3BhY2UiOiJBV1MvVXNhZ2UiLCJtZXRyaWNfbmFtZSI6IkNhbGxDb3VudCIsImRpbWVuc2lvbnMiOnsiQ2xhc3MiOiJOb25lIiwiUmVzb3VyY2UiOiJHZXRNZXRyaWNEYXRhIiwiU2VydmljZSI6IkNsb3VkV2F0Y2giLCJUeXBlIjoiQVBJIn0sInRpbWVzdGFtcCI6MTcxMzkwMjcwMDAwMCwidmFsdWUiOnsibWF4IjoxLjAsIm1pbiI6MS4wLCJzdW0iOjMuMCwiY291bnQiOjMuMH0sInVuaXQiOiJOb25lIn0KeyJtZXRyaWNfc3RyZWFtX25hbWUiOiJDdXN0b21QYXJ0aWFsLUJDbjVjQSIsImFjY291bnRfaWQiOiI3MzkxNDcyMjI5ODkiLCJyZWdpb24iOiJ1cy1lYXN0LTIiLCJuYW1lc3BhY2UiOiJBV1MvRmlyZWhvc2UiLCJtZXRyaWNfbmFtZSI6IktNU0tleUludmFsaWRTdGF0ZSIsImRpbWVuc2lvbnMiOnsiRGVsaXZlcnlTdHJlYW1OYW1lIjoiUFVULUhUUC1SZFFXOCJ9LCJ0aW1lc3RhbXAiOjE3MTM5MDI2NDAwMDAsInZhbHVlIjp7Im1heCI6MC4wLCJtaW4iOjAuMCwic3VtIjowLjAsImNvdW50Ijo2MC4wfSwidW5pdCI6IkNvdW50In0KeyJtZXRyaWNfc3RyZWFtX25hbWUiOiJDdXN0b21QYXJ0aWFsLUJDbjVjQSIsImFjY291bnRfaWQiOiI3MzkxNDcyMjI5ODkiLCJyZWdpb24iOiJ1cy1lYXN0LTIiLCJuYW1lc3BhY2UiOiJBV1MvRmlyZWhvc2UiLCJtZXRyaWNfbmFtZSI6IktNU0tleU5vdEZvdW5kIiwiZGltZW5zaW9ucyI6eyJEZWxpdmVyeVN0cmVhbU5hbWUiOiJQVVQtSFRQLVJkUVc4In0sInRpbWVzdGFtcCI6MTcxMzkwMjY0MDAwMCwidmFsdWUiOnsibWF4IjowLjAsIm1pbiI6MC4wLCJzdW0iOjAuMCwiY291bnQiOjYwLjB9LCJ1bml0IjoiQ291bnQifQo=";
        let decoded = decode_and_decompress(encoded_data);
        assert!(decoded.is_ok());
        let decoded = decoded.unwrap();
        let request_id = "test_id".to_string();
        let result = deserialize_aws_record_from_str(&decoded, &request_id);
        assert!(result.is_ok());
        let value = result.unwrap();
        for val in value {
            assert_eq!(val.get("account_id").unwrap(), "739147222989");
        }
    }

    #[test]
    fn test_deserialize_from_str_logs() {
        let encoded_data = "eyJtZXNzYWdlVHlwZSI6IkRBVEFfTUVTU0FHRSIsIm93bmVyIjoiMTIzNDU2Nzg5MDEyIiwibG9nR3JvdXAiOiJsb2dfZ3JvdXBfbmFtZSIsImxvZ1N0cmVhbSI6ImxvZ19zdHJlYW1fbmFtZSIsInN1YnNjcmlwdGlvbkZpbHRlcnMiOlsic3Vic2NyaXB0aW9uX2ZpbHRlcl9uYW1lIl0sImxvZ0V2ZW50cyI6W3siaWQiOiIwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1IiwidGltZXN0YW1wIjoxNzEzOTgzNDQ2LCJtZXNzYWdlIjoibG9nbWVzc2FnZTEifSx7ImlkIjoiMDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NSIsInRpbWVzdGFtcCI6IDE3MTM5ODM0NDYsIm1lc3NhZ2UiOiJsb2dtZXNzYWdlMiJ9XX0=";
        let decoded = decode_and_decompress(encoded_data);
        assert!(decoded.is_ok());
        let decoded = decoded.unwrap();
        let request_id = "test_id".to_string();
        let result = deserialize_aws_record_from_str(&decoded, &request_id);
        assert!(result.is_ok());
        let result = result.unwrap();
        for val in result {
            assert_eq!(val.get("owner").unwrap(), "123456789012");
        }
    }
}
