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

use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use arrow::json::reader::infer_json_schema;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use std::collections::HashMap;
use std::io::{BufReader, Error};
use std::time::Instant;

use super::StreamMeta;
use crate::common::json;
use crate::common::time::parse_timestamp_micro_from_value;
use crate::infra::config::{CONFIG, STREAMS_DATA, STREAM_SCHEMAS};
use crate::infra::{cluster, metrics};
use crate::meta::alert::{Alert, Trigger};
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::ingestion::{IngestionResponse, RecordStatus, StreamStatus};
use crate::meta::StreamType;
use crate::service::db;
use crate::service::ingestion::write_file;
use crate::service::schema::stream_schema_exists;

pub async fn ingest(
    org_id: &str,
    in_stream_name: &str,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
    let start = Instant::now();

    let stream_name = &crate::service::ingestion::format_stream_name(in_stream_name);

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
    let mut data: Vec<json::Value> = json::from_slice(&body)?;

    if CONFIG.common.memory_wal_booster {
        let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);

        if !STREAM_SCHEMAS.contains_key(&key) {
            let val_str = data
                .clone()
                .into_iter()
                .map(|value| value.to_string())
                .collect::<Vec<String>>()
                .join("\n");

            let mut schema_reader = BufReader::new(val_str.as_bytes());
            let inferred_schema = infer_json_schema(&mut schema_reader, None).unwrap();
            let mut metadata: HashMap<String, String> = HashMap::new();
            let ts = Utc::now().timestamp_micros();
            metadata.insert("created_at".to_string(), ts.to_string());
            db::schema::set(
                org_id,
                stream_name,
                StreamType::Logs,
                &inferred_schema.clone().with_metadata(metadata),
                Some(ts),
                false,
            )
            .await
            .unwrap();
        }

        if STREAMS_DATA.contains_key(&key) {
            STREAMS_DATA.get_mut(&key).unwrap().append(&mut data);
        } else {
            STREAMS_DATA.insert(key, data);
        }
        Ok(HttpResponse::Ok().json(IngestionResponse::new(http::StatusCode::OK.into(), vec![])))
    } else {
        process_json_data(stream_name, org_id, &data, thread_id, start).await
    }
}

pub async fn process_json_data(
    stream_name: &String,
    org_id: &str,
    data: &[json::Value],
    thread_id: web::Data<usize>,
    start: Instant,
) -> Result<HttpResponse, Error> {
    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();

    /*  #[cfg(feature = "zo_functions")]
    let mut runtime = crate::service::ingestion::init_functions_runtime(); */

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

    /*  // Start Register Transforms for stream
    #[cfg(feature = "zo_functions")]
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Logs,
        stream_name,
    );
    // End Register Transforms for stream */

    let stream_schema = stream_schema_exists(
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

    for item in data.iter() {
        //JSON Flattening
        let mut value = json::flatten_json_and_format_field(item);

        /* #[cfg(feature = "zo_functions")]
        if !local_trans.is_empty() {
            value = crate::service::ingestion::apply_stream_transform(
                &local_trans,
                &value,
                &stream_vrl_map,
                stream_name,
                &mut runtime,
            );
        }
        #[cfg(feature = "zo_functions")]
        if value.is_null() || !value.is_object() {
            stream_status.status.failed += 1; // transform failed or dropped
            continue;
        } */
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
        let earlest_time = Utc::now() + Duration::hours(0 - CONFIG.limit.ingest_allowed_upto);
        if timestamp < earlest_time.timestamp_micros() {
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

    // write to file
    write_file(buf, thread_id, org_id, stream_name, StreamType::Logs);

    // only one trigger per request, as it updates etcd
    super::evaluate_trigger(trigger, stream_alerts_map).await;

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/_json",
            "200",
            org_id,
            stream_name,
            StreamType::Logs.to_string().as_str(),
        ])
        .inc();

    Ok(HttpResponse::Ok().json(IngestionResponse::new(
        http::StatusCode::OK.into(),
        vec![stream_status],
    )))
}
