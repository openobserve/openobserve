use actix_web::{post, web, HttpResponse};
use arrow::array::StringArray;
use arrow::ipc::reader::StreamReader;
use arrow::json::ReaderBuilder;
use std::fs::File;
use std::sync::Arc;

use actix_web::http;
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;

use super::StreamMeta;
use crate::common::infra::{config::CONFIG, metrics};
use crate::common::meta::stream::SchemaRecords;
use crate::common::meta::{
    alert::{Alert, Trigger},
    ingestion::{IngestionResponse, StreamStatus},
    stream::StreamParams,
    usage::UsageType,
    StreamType,
};
use crate::common::utils::{flatten, json, time::parse_timestamp_micro_from_value};
use crate::service::ingestion::{is_ingestion_allowed, write_file_arrow};
use crate::service::{get_formatted_stream_name, usage::report_request_usage_stats};

#[post("/arrow")]
async fn json_to_arrow(body: web::Bytes) -> HttpResponse {
    // Define a schema for the Arrow data

    let reader: Vec<serde_json::Value> = serde_json::from_slice(&body).unwrap_or({
        let val: serde_json::Value = serde_json::from_slice(&body).unwrap();
        vec![val]
    });

    let batch_size = arrow::util::bit_util::round_upto_multiple_of_64(reader.len());

    let inferred_schema =
        arrow::json::reader::infer_json_schema_from_iterator(reader.iter().map(Ok)).unwrap();

    let mut decoder = ReaderBuilder::new(Arc::new(inferred_schema.clone()))
        .with_batch_size(batch_size)
        .build_decoder()
        .unwrap();

    let _ = decoder.serialize(&reader);
    let batch = decoder.flush().unwrap().unwrap();

    let rw_file = crate::common::infra::wal::get_or_create_arrow(
        0,
        StreamParams::new("default", "in_stream_name", StreamType::Logs),
        None,
        "aa",
        false,
        Some(inferred_schema.clone()),
    )
    .await;
    rw_file.write_arrow(batch).await;

    HttpResponse::Ok()
        .content_type("application/octet-stream")
        .body("success")
}

#[post("/data/{org_id}/{stream_name}")]
async fn data(path: web::Path<(String, String)>, file: web::Json<String>) -> HttpResponse {
    let (org_id, in_stream_name) = path.into_inner();
    let file = format!(
        "./data/openobserve/wal/files/{org_id}/logs/{in_stream_name}/{}",
        file.into_inner()
    );

    let buf = File::open(file).unwrap();
    let reader = StreamReader::try_new(&buf, None).unwrap();

    let mut num_rows = 0;
    let mut num_batches = 0;

    let mut batches = vec![];
    let mut rows = vec![];
    for batch in reader {
        num_batches += 1;
        match batch {
            Ok(read_batch) => {
                let name_column = read_batch
                    .column(1)
                    .as_any()
                    .downcast_ref::<StringArray>()
                    .expect("Expected StringArray");
                num_rows += read_batch.num_rows();

                for i in 0..read_batch.num_rows() {
                    let name = name_column.value(i).to_string();

                    rows.push(name);
                }
                batches.push(read_batch);
            }
            Err(err) => {
                println!("error:reading batch {}", err);
                continue;
            }
        }
    }
    println!("rows are {:?}", rows);
    let msg = format!("got {} rows", num_rows);

    HttpResponse::Ok()
        .content_type("application/json")
        .body(msg)
}

pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    body: web::Bytes,
    thread_id: usize,
) -> Result<IngestionResponse, anyhow::Error> {
    let start = std::time::Instant::now();
    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_params = StreamParams::new(org_id, in_stream_name, StreamType::Logs);
    let stream_name = &get_formatted_stream_name(&mut stream_params, &mut stream_schema_map).await;

    if let Some(value) = is_ingestion_allowed(org_id, Some(stream_name)) {
        return Err(value);
    }

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    let mut runtime = crate::service::ingestion::init_functions_runtime();

    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_status = StreamStatus::new(stream_name);
    let mut trigger: Option<Trigger> = None;

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream

    let partition_det =
        crate::service::ingestion::get_stream_partition_keys(stream_name, &stream_schema_map).await;
    let partition_keys = partition_det.partition_keys;
    let partition_time_level = partition_det.partition_time_level;

    // Start get stream alerts
    let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
    // End get stream alert

    let mut buf: AHashMap<String, SchemaRecords> = AHashMap::new();
    let reader: Vec<json::Value> = json::from_slice(&body).unwrap_or({
        let val: json::Value = json::from_slice(&body)?;
        vec![val]
    });
    for item in reader.iter() {
        //JSON Flattening
        let mut value = flatten::flatten(item)?;

        if !local_trans.is_empty() {
            value = crate::service::ingestion::apply_stream_transform(
                &local_trans,
                &value,
                &stream_vrl_map,
                stream_name,
                &mut runtime,
            )?;
        }

        if value.is_null() || !value.is_object() {
            stream_status.status.failed += 1; // transform failed or dropped
            continue;
        }
        // End row based transform

        // get json object
        let local_val = value.as_object_mut().unwrap();

        // handle timestamp
        let timestamp = match local_val.get(&CONFIG.common.column_timestamp) {
            Some(v) => match parse_timestamp_micro_from_value(v) {
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
        let earliest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
        if timestamp < earliest_time.timestamp_micros() {
            stream_status.status.failed += 1; // to old data, just discard
            stream_status.status.error = super::get_upto_discard_error();
            continue;
        }
        if timestamp < min_ts {
            min_ts = timestamp;
        }
        local_val.insert(
            CONFIG.common.column_timestamp.clone(),
            json::Value::Number(timestamp.into()),
        );

        let local_trigger = super::add_valid_record_arrow(
            &StreamMeta {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                partition_keys: &partition_keys,
                partition_time_level: &partition_time_level,
                stream_alerts_map: &stream_alerts_map,
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

    // write to file
    let mut stream_file_name = "".to_string();
    let mut req_stats =
        write_file_arrow(&buf, thread_id, &stream_params, &mut stream_file_name, None).await;

    if stream_file_name.is_empty() {
        return Ok(IngestionResponse::new(
            http::StatusCode::OK.into(),
            vec![stream_status],
        ));
    }

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, &stream_alerts_map).await;

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/ingest/logs/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/ingest/logs/_json",
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
        UsageType::Json,
        local_trans.len() as u16,
    )
    .await;

    Ok(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    ))
}
