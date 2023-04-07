use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use bytes::BufMut;
use bytes::BytesMut;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use flate2::read::GzDecoder;
#[cfg(feature = "zo_functions")]
use mlua::Lua;
use std::io::prelude::*;
use std::io::Error;
use std::time::Instant;

use crate::common::json;
use crate::common::time::parse_i64_to_timestamp_micros;
use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::infra::file_lock;
use crate::infra::metrics;
use crate::meta::alert::{Alert, Trigger};
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::ingestion::KinesisFHData;
use crate::meta::ingestion::KinesisFHIngestionResponse;
use crate::meta::ingestion::KinesisFHRequest;
use crate::meta::ingestion::RecordStatus;
use crate::meta::ingestion::StreamStatus;
use crate::meta::StreamType;
use crate::service::db;

use super::StreamMeta;

pub async fn process(
    org_id: &str,
    stream_name: &str,
    request: KinesisFHRequest,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let start = Instant::now();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    // check if we are allowed to ingest
    if db::compact::delete::is_deleting_stream(org_id, stream_name, StreamType::Logs, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("stream [{stream_name}] is being deleted"),
            )),
        );
    }

    #[cfg(feature = "zo_functions")]
    let lua = Lua::new();
    #[cfg(feature = "zo_functions")]
    let state = vrl::state::Runtime::default();
    #[cfg(feature = "zo_functions")]
    let mut runtime = vrl::Runtime::new(state);

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus {
        name: stream_name.to_owned(),
        status: RecordStatus {
            successful: 0,
            failed: 0,
            error: "".to_string(),
        },
    };
    let mut trigger: Option<Trigger> = None;

    // Start Register Transforms for stream
    #[cfg(feature = "zo_functions")]
    let (local_tans, stream_lua_map, stream_vrl_map) =
        crate::service::ingestion::register_stream_transforms(
            org_id,
            stream_name,
            StreamType::Logs,
            &lua,
        );
    // End Register Transforms for stream

    let stream_schema = crate::service::schema::stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Logs,
        &mut stream_schema_map,
    )
    .await;
    let mut partition_keys: Vec<String> = vec![];
    if stream_schema.has_partition_keys {
        partition_keys = crate::service::ingestion::get_stream_partition_keys(
            stream_name.to_string(),
            stream_schema_map.clone(),
        )
        .await;
    }
    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    for record in request.records {
        match decode_and_decompress(&record.data) {
            Ok(decompressed_data) => {
                let kfh_data: KinesisFHData = json::from_str(&decompressed_data)?;

                for event in kfh_data.log_events.iter() {
                    let mut value = json::to_value(event).unwrap();
                    let local_val = value.as_object_mut().unwrap();

                    local_val.insert("requestId".to_owned(), request.request_id.clone().into());
                    local_val.insert(
                        "messageType".to_owned(),
                        kfh_data.message_type.clone().into(),
                    );
                    local_val.insert("owner".to_owned(), kfh_data.owner.clone().into());
                    local_val.insert("logGroup".to_owned(), kfh_data.log_group.clone().into());
                    local_val.insert("logStream".to_owned(), kfh_data.log_stream.clone().into());
                    local_val.insert(
                        "subscriptionFilters".to_owned(),
                        kfh_data.subscription_filters.clone().into(),
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

                    value = local_val.clone().into();

                    // Start row based transform
                    #[cfg(feature = "zo_functions")]
                    let value = crate::service::ingestion::apply_stream_transform(
                        &local_tans,
                        &value,
                        &lua,
                        &stream_lua_map,
                        &stream_vrl_map,
                        stream_name,
                        &mut runtime,
                    );
                    #[cfg(feature = "zo_functions")]
                    if value.is_null() || !value.is_object() {
                        stream_status.status.failed += 1; // transform failed or dropped
                        continue;
                    }
                    // End row based transform

                    // JSON Flattening
                    let mut value = json::flatten_json_and_format_field(&value);
                    // get json object
                    let local_val = value.as_object_mut().unwrap();

                    // handle timestamp
                    let timestamp = match event.timestamp {
                        Some(v) => match parse_i64_to_timestamp_micros(v) {
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
                    let earliest_time =
                        Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
                    if timestamp < earliest_time.timestamp_micros() {
                        stream_status.status.failed += 1; // to old data, just discard
                        stream_status.status.error = super::get_upto_discard_error();
                        continue;
                    }
                    if timestamp < min_ts {
                        min_ts = timestamp;
                    }
                    local_val.insert(
                        CONFIG.common.time_stamp_col.clone(),
                        json::Value::Number(timestamp.into()),
                    );

                    // write data
                    let local_trigger = super::add_valid_record(
                        StreamMeta {
                            org_id: org_id.to_string(),
                            stream_name: stream_name.to_string(),
                            partition_keys: partition_keys.clone(),
                            stream_alerts_map: stream_alerts_map.clone(),
                        },
                        &mut stream_schema_map,
                        &mut stream_status.status,
                        &mut buf,
                        local_val,
                    )
                    .await;

                    if local_trigger.is_some() {
                        trigger = Some(local_trigger.unwrap());
                    }
                }
            }
            Err(err) => {
                return Ok(
                    HttpResponse::InternalServerError().json(KinesisFHIngestionResponse {
                        request_id: request.request_id,
                        error_message: Some(err.to_string()),
                        timestamp: request.timestamp.unwrap_or(Utc::now().timestamp_micros()),
                    }),
                );
            }
        }
    }

    // write to file
    let mut stream_file_name = "".to_string();
    let mut write_buf = BytesMut::new();
    for (key, entry) in buf {
        if entry.is_empty() {
            continue;
        }
        write_buf.clear();
        for row in &entry {
            write_buf.put(row.as_bytes());
            write_buf.put("\n".as_bytes());
        }
        let file = file_lock::get_or_create(
            *thread_id.as_ref(),
            org_id,
            stream_name,
            StreamType::Logs,
            &key,
            CONFIG.common.wal_memory_mode_enabled,
        );
        if stream_file_name.is_empty() {
            stream_file_name = file.full_name();
        }
        file.write(write_buf.as_ref());

        // metrics
        metrics::INGEST_RECORDS
            .with_label_values(&[org_id, stream_name, StreamType::Logs.to_string().as_str()])
            .add(entry.len() as i64);
        metrics::INGEST_BYTES
            .with_label_values(&[org_id, stream_name, StreamType::Logs.to_string().as_str()])
            .add(write_buf.len() as i64);
    }

    if stream_file_name.is_empty() {
        return Ok(
            HttpResponse::InternalServerError().json(KinesisFHIngestionResponse {
                request_id: request.request_id,
                error_message: Some(
                    json::to_string(&stream_status)
                        .unwrap_or("error processing request".to_string()),
                ),
                timestamp: request.timestamp.unwrap_or(Utc::now().timestamp_micros()),
            }),
        );
    }

    // only one trigger per request, as it updates etcd
    if trigger.is_some() {
        let val = trigger.unwrap();
        let mut alerts = stream_alerts_map
            .get(&format!("{}/{}/{}", val.org, StreamType::Logs, val.stream))
            .unwrap()
            .clone();

        alerts.retain(|alert| alert.name.eq(&val.alert_name));
        if !alerts.is_empty() {
            crate::service::ingestion::send_ingest_notification(
                val.clone(),
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/_multi",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/_multi",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    Ok(HttpResponse::Ok().json(KinesisFHIngestionResponse {
        request_id: request.request_id,
        timestamp: request.timestamp.unwrap_or(Utc::now().timestamp_micros()),
        error_message: None,
    }))
}

fn decode_and_decompress(encoded_data: &str) -> Result<String, Box<dyn std::error::Error>> {
    let decoded_data = crate::common::base64::decode_raw(encoded_data)?;
    let mut gz = GzDecoder::new(&decoded_data[..]);
    let mut decompressed_data = String::new();
    gz.read_to_string(&mut decompressed_data)?;
    Ok(decompressed_data)
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
    fn test_decode_and_decompress_invalid_gzip() {
        let encoded_data = "aGVsbG8gd29ybGQh"; // "hello world!" base64-encoded but not compressed
        let result = decode_and_decompress(encoded_data);
        assert!(
            result.is_err(),
            "Expected an error due to invalid gzip data"
        );
    }
}
