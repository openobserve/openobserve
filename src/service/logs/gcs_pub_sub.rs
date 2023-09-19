use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;

use super::{ingest::decode_and_decompress, StreamMeta};
use crate::common::{
    infra::{cluster, config::CONFIG, metrics},
    meta::{
        alert::{Alert, Trigger},
        ingestion::{GCPIngestionRequest, GCPIngestionResponse, RecordStatus, StreamStatus},
        stream::StreamParams,
        usage::UsageType,
        StreamType,
    },
    utils::{flatten, json, time::parse_timestamp_micro_from_value},
};
use crate::service::{
    db, format_stream_name, ingestion::write_file, usage::report_request_usage_stats,
};

pub async fn process(
    org_id: &str,
    in_stream_name: &str,
    request: GCPIngestionRequest,
    thread_id: usize,
) -> Result<GCPIngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();

    let stream_name = &format_stream_name(in_stream_name);

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_name, StreamType::Logs, None) {
        return Err(anyhow::anyhow!(format!(
            "stream [{stream_name}] is being deleted"
        )));
    }

    let mut runtime = crate::service::ingestion::init_functions_runtime();

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

    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
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
        let partition_det =
            crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map)
                .await;
        partition_keys = partition_det.partition_keys;
    }
    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    let data = request.message.data;
    match decode_and_decompress(&data) {
        Ok((decompressed_data, _)) => {
            let mut value: json::Value = json::from_str(&decompressed_data)?;

            // handling of timestamp
            let timestamp = match value.get("timestamp") {
                Some(v) => match parse_timestamp_micro_from_value(v) {
                    Ok(t) => t,
                    Err(_) => Utc::now().timestamp_micros(),
                },
                None => Utc::now().timestamp_micros(),
            };

            // JSON Flattening
            value = flatten::flatten(&value)?;

            // Start row based transform

            let mut value = crate::service::ingestion::apply_stream_transform(
                &local_trans,
                &value,
                &stream_vrl_map,
                stream_name,
                &mut runtime,
            )?;
            if value.is_null() || !value.is_object() {
                stream_status.status.failed += 1; // transform failed or dropped
            }
            // End row based transform

            // get json object
            let local_val = value.as_object_mut().unwrap();

            // check ingestion time
            let earliest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
            if timestamp < earliest_time.timestamp_micros() {
                stream_status.status.failed += 1; // to old data, just discard
                stream_status.status.error = super::get_upto_discard_error();
            }

            local_val.insert(
                CONFIG.common.column_timestamp.clone(),
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
        Err(err) => {
            return Ok(GCPIngestionResponse {
                request_id: request.message.message_id,
                error_message: Some(err.to_string()),
                timestamp: request.message.publish_time,
            });
        }
    }

    if stream_status.status.failed > 0 {
        return Ok(GCPIngestionResponse {
            request_id: request.message.message_id,
            error_message: Some(stream_status.status.error),
            timestamp: request.message.publish_time,
        });
    }
    let mut stream_file_name = "".to_string();
    // write to file
    let mut req_stats = write_file(
        buf,
        thread_id,
        StreamParams::new(org_id, stream_name, StreamType::Logs),
        &mut stream_file_name,
        None,
    )
    .await;

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, stream_alerts_map).await;

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_gcs",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_gcs",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::GCPSubscription,
        local_trans.len() as u16,
    )
    .await;

    Ok(GCPIngestionResponse {
        request_id: request.message.message_id,
        timestamp: request.message.publish_time,
        error_message: None,
    })
}
