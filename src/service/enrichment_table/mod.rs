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

use actix_multipart::Multipart;
use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use ahash::AHashMap;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use futures::{StreamExt, TryStreamExt};
use std::io::Error;

use crate::infra::{
    cache::stats,
    cluster,
    config::{CONFIG, STREAM_SCHEMAS},
};
use crate::meta::{self, http::HttpResponse as MetaHttpResponse, StreamType};
use crate::{common::json, meta::usage::UsageType};

use super::{
    compact::retention,
    db,
    ingestion::{chk_schema_by_record, write_file},
    schema::stream_schema_exists,
    usage::report_usage_stats,
};

pub async fn save_enrichment_data(
    org_id: &str,
    table_name: &str,
    mut payload: Multipart,
    thread_id: usize,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let mut hour_key = String::new();
    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    let stream_name = &crate::service::ingestion::format_stream_name(table_name);

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(
        org_id,
        stream_name,
        StreamType::EnrichmentTables,
        None,
    ) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("enrichment table [{stream_name}] is being deleted"),
            )),
        );
    }

    let mut stream_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let stream_schema = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::EnrichmentTables,
        &mut stream_schema_map,
    )
    .await;

    if stream_schema.has_fields {
        delete_enrichment_table(org_id, stream_name, StreamType::EnrichmentTables).await;
    }

    let mut records = vec![];
    let timestamp = Utc::now().timestamp_micros();
    while let Ok(Some(mut field)) = payload.try_next().await {
        let content_disposition = field.content_disposition();
        let filename = content_disposition.get_filename();

        if filename.is_some() {
            while let Some(chunk) = field.next().await {
                let data = chunk.unwrap();
                let mut rdr = csv::Reader::from_reader(data.as_ref());
                let headers = rdr.headers()?.clone();

                for result in rdr.records() {
                    // The iterator yields Result<StringRecord, Error>, so we check the
                    // error here.
                    let record = result?;
                    // Transform the record to a JSON value
                    let mut json_record = json::Map::new();

                    for (header, field) in headers.iter().zip(record.iter()) {
                        json_record.insert(header.into(), json::Value::String(field.into()));
                    }
                    json_record.insert(
                        CONFIG.common.column_timestamp.clone(),
                        json::Value::Number(timestamp.into()),
                    );
                    let value_str = json::to_string(&json_record).unwrap();
                    chk_schema_by_record(
                        &mut stream_schema_map,
                        org_id,
                        StreamType::EnrichmentTables,
                        stream_name,
                        timestamp,
                        &value_str,
                    )
                    .await;

                    if records.is_empty() {
                        hour_key =
                            super::ingestion::get_hour_key(timestamp, vec![], &json_record, None);
                    }
                    records.push(value_str);
                }
            }
        }
    }

    if records.is_empty() {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "No records to ingest for look up table".to_string(),
            )),
        );
    }

    buf.insert(hour_key.clone(), records.clone());
    let mut stream_file_name = "".to_string();
    let mut req_stats = write_file(
        buf,
        thread_id,
        org_id,
        stream_name,
        &mut stream_file_name,
        StreamType::EnrichmentTables,
    );
    req_stats.response_time = start.elapsed().as_secs_f64();
    //metric + data usage
    report_usage_stats(
        req_stats,
        org_id,
        StreamType::Logs,
        UsageType::EnrichmentTable,
        0,
    )
    .await;

    Ok(HttpResponse::Ok().json(MetaHttpResponse::error(
        StatusCode::OK.into(),
        "Saved enrichment table".to_string(),
    )))
}

async fn delete_enrichment_table(org_id: &str, stream_name: &str, stream_type: StreamType) {
    log::info!("deleting enrichment table  {stream_name}");
    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        log::error!("Error deleting stream schema: {}", e);
    }

    if let Err(e) = retention::delete_all(org_id, stream_name, stream_type).await {
        log::error!("Error deleting stream {}", e);
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STREAM_SCHEMAS.remove(&key);

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted enrichment table  {stream_name}");
}
