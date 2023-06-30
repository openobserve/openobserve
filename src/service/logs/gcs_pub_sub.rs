use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use flate2::read::GzDecoder;
use std::io::Read;

use crate::common::{flatten, json, time::parse_timestamp_micro_from_value};
use crate::infra::{cluster, config::CONFIG, metrics};
use crate::meta::usage::UsageType;
use crate::meta::{
    alert::{Alert, Trigger},
    ingestion::{
        AWSRecordType, GCPIngestionRequest, GCPIngestionResponse, RecordStatus, StreamStatus,
    },
    StreamType,
};
use crate::service::usage::report_usage_stats;
use crate::service::{db, ingestion::write_file};

use super::StreamMeta;

pub async fn process(
    org_id: &str,
    in_stream_name: &str,
    request: GCPIngestionRequest,
    thread_id: usize,
) -> Result<GCPIngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();

    let stream_name = &crate::service::ingestion::format_stream_name(in_stream_name);

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
        partition_keys =
            crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map)
                .await;
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
        org_id,
        stream_name,
        &mut stream_file_name,
        StreamType::Logs,
    );

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
    report_usage_stats(
        req_stats,
        org_id,
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

fn decode_and_decompress(
    encoded_data: &str,
) -> Result<(String, AWSRecordType), Box<dyn std::error::Error>> {
    let decoded_data = crate::common::base64::decode_raw(encoded_data)?;
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
        let encoded_data = "eyJpbnNlcnRJZCI6Im8zM203czJ2ZjdvaGtqZHUiLCJsYWJlbHMiOnsiY29tcHV0ZS5nb29nbGVhcGlzLmNvbS9yZXNvdXJjZV9uYW1lIjoiZ2tlLWRldjEtYzNjcHUtcG9vbC1mYTM1YmE5My0yeGg3IiwiazhzLXBvZC9hcHBfa3ViZXJuZXRlc19pby9pbnN0YW5jZSI6InpvMSIsIms4cy1wb2QvYXBwX2t1YmVybmV0ZXNfaW8vbmFtZSI6Im9wZW5vYnNlcnZlIiwiazhzLXBvZC9wb2QtdGVtcGxhdGUtaGFzaCI6Ijc3ZmI0NzY3N2QiLCJrOHMtcG9kL3JvbGUiOiJjb21wYWN0b3IifSwibG9nTmFtZSI6InByb2plY3RzL3ppbmMxLTM0MjAxNi9sb2dzL3N0ZGVyciIsInJlY2VpdmVUaW1lc3RhbXAiOiIyMDIzLTA2LTE2VDE0OjU4OjA4LjQ2Nzc2NTk3M1oiLCJyZXNvdXJjZSI6eyJsYWJlbHMiOnsiY2x1c3Rlcl9uYW1lIjoiZGV2MSIsImNvbnRhaW5lcl9uYW1lIjoib3Blbm9ic2VydmUiLCJsb2NhdGlvbiI6InVzLWNlbnRyYWwxIiwibmFtZXNwYWNlX25hbWUiOiJ6aW94LWFscGhhMSIsInBvZF9uYW1lIjoiem8xLW9wZW5vYnNlcnZlLWNvbXBhY3Rvci03N2ZiNDc2NzdkLWs3cHZrIiwicHJvamVjdF9pZCI6InppbmMxLTM0MjAxNiJ9LCJ0eXBlIjoiazhzX2NvbnRhaW5lciJ9LCJzZXZlcml0eSI6IkVSUk9SIiwidGV4dFBheWxvYWQiOiJbMjAyMy0wNi0xNlQxNDo1ODowNVogSU5GTyAgb3Blbm9ic2VydmU6OnNlcnZpY2U6OmNvbXBhY3Q6Om1lcmdlXSBbQ09NUEFDVF0gbWVyZ2Ugc21hbGwgZmlsZTogZmlsZXMvcHJvZHVjdGlvbl9uMjMwazE5QVVOVDU2bTAvbWV0cmljcy9wcm9tZXRoZXVzX2h0dHBfcmVzcG9uc2Vfc2l6ZV9ieXRlc19zdW0vMjAyMy8wNi8xNS8yMy83MDc1MjQ4MzU1MDE3ODk1OTM2LnBhcnF1ZXQiLCJ0aW1lc3RhbXAiOiIyMDIzLTA2LTE2VDE0OjU4OjA1LjMyMzUwMjA0N1oifQ==";
        let expected = "{\"insertId\":\"o33m7s2vf7ohkjdu\",\"labels\":{\"compute.googleapis.com/resource_name\":\"gke-dev1-c3cpu-pool-fa35ba93-2xh7\",\"k8s-pod/app_kubernetes_io/instance\":\"zo1\",\"k8s-pod/app_kubernetes_io/name\":\"openobserve\",\"k8s-pod/pod-template-hash\":\"77fb47677d\",\"k8s-pod/role\":\"compactor\"},\"logName\":\"projects/zinc1-342016/logs/stderr\",\"receiveTimestamp\":\"2023-06-16T14:58:08.467765973Z\",\"resource\":{\"labels\":{\"cluster_name\":\"dev1\",\"container_name\":\"openobserve\",\"location\":\"us-central1\",\"namespace_name\":\"ziox-alpha1\",\"pod_name\":\"zo1-openobserve-compactor-77fb47677d-k7pvk\",\"project_id\":\"zinc1-342016\"},\"type\":\"k8s_container\"},\"severity\":\"ERROR\",\"textPayload\":\"[2023-06-16T14:58:05Z INFO  openobserve::service::compact::merge] [COMPACT] merge small file: files/production_n230k19AUNT56m0/metrics/prometheus_http_response_size_bytes_sum/2023/06/15/23/7075248355017895936.parquet\",\"timestamp\":\"2023-06-16T14:58:05.323502047Z\"}";
        let result =
            decode_and_decompress(encoded_data).expect("Failed to decode and decompress data");
        println!("{:?}", result.0);
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
