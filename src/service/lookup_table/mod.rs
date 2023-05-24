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
use actix_web::http::{self, StatusCode};
use actix_web::{web, HttpResponse};
use ahash::AHashMap;
use chrono::{TimeZone, Utc};
use futures::{StreamExt, TryStreamExt};
use std::fs::OpenOptions;
use std::io::Error;

use super::compact::delete;
use super::db;
use super::ingestion::write_file;
use super::schema::{add_stream_schema, stream_schema_exists};
use crate::common::json;
use crate::infra::cache::stats;
use crate::infra::cluster;
use crate::infra::config::{CONFIG, STREAM_SCHEMAS};
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::{self, StreamType};

pub async fn save_metadata(
    org_id: &str,
    table_name: &str,
    mut payload: Multipart,
    thread_id: web::Data<usize>,
) -> Result<HttpResponse, Error> {
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
    if db::compact::delete::is_deleting_stream(org_id, stream_name, StreamType::LookUpTable, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("enrichment table [{stream_name}] is being deleted"),
            )),
        );
    }

    let stream_schema = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::LookUpTable,
        &mut AHashMap::new(),
    )
    .await;

    if stream_schema.has_fields {
        delete_lookup_table(org_id, stream_name, StreamType::LookUpTable).await;
    }

    let mut records = vec![];
    let timestamp = Utc.timestamp_opt(0, 0).unwrap().timestamp_micros();
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

                    if records.is_empty() {
                        hour_key =
                            super::ingestion::get_hour_key(timestamp, vec![], json_record.clone());
                    }
                    records.push(json::to_string(&json_record).unwrap());
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

    let mut stream_file_name = "".to_string();
    buf.insert(hour_key.clone(), records.clone());

    write_file(
        buf,
        thread_id,
        org_id,
        stream_name,
        StreamType::LookUpTable,
        &mut stream_file_name,
    );

    let file = OpenOptions::new()
        .read(true)
        .open(&stream_file_name)
        .unwrap();
    add_stream_schema(
        org_id,
        stream_name,
        StreamType::LookUpTable,
        &file,
        &mut AHashMap::new(),
        timestamp,
    )
    .await;

    Ok(HttpResponse::Ok().json(MetaHttpResponse::error(
        StatusCode::OK.into(),
        "Saved enrichment table".to_string(),
    )))
}

async fn delete_lookup_table(org_id: &str, stream_name: &str, stream_type: StreamType) {
    log::info!("deleting lookup table  {stream_name}");
    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        log::error!("Error deleting stream schema: {}", e);
    }

    if let Err(e) = delete::delete_all(org_id, stream_name, stream_type).await {
        log::error!("Error deleting stream {}", e);
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STREAM_SCHEMAS.remove(&key);

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted lookup table  {stream_name}");
}
