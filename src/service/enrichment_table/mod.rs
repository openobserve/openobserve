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

use std::io::Error;

use actix_multipart::Multipart;
use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use ahash::AHashMap;
use bytes::Bytes;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use futures::{StreamExt, TryStreamExt};

use crate::{
    common::{
        infra::{
            cache::stats,
            cluster,
            config::{CONFIG, STREAM_SCHEMAS},
        },
        meta::{
            self,
            http::HttpResponse as MetaHttpResponse,
            stream::{PartitionTimeLevel, StreamParams},
            usage::UsageType,
            StreamType,
        },
        utils::json,
    },
    service::{
        compact::retention,
        db, format_stream_name,
        ingestion::{chk_schema_by_record, write_file},
        schema::stream_schema_exists,
        usage::report_request_usage_stats,
    },
};

pub mod geoip;

pub async fn save_enrichment_data(
    org_id: &str,
    table_name: &str,
    mut payload: Multipart,
    thread_id: usize,
    append_data: bool,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let mut hour_key = String::new();
    let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
    let stream_name = &format_stream_name(table_name);

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

    if stream_schema.has_fields && !append_data {
        delete_enrichment_table(org_id, stream_name, StreamType::EnrichmentTables).await;
    }

    let mut records = vec![];
    let timestamp = if !append_data {
        Utc::now().timestamp_micros()
    } else {
        let schema = stream_schema_map.get(stream_name).unwrap();
        schema
            .metadata()
            .get("created_at")
            .unwrap()
            .parse::<i64>()
            .unwrap()
    };
    while let Ok(Some(mut field)) = payload.try_next().await {
        let content_disposition = field.content_disposition();
        let filename = content_disposition.get_filename();
        let mut data = bytes::Bytes::new();

        if filename.is_some() {
            while let Some(chunk) = field.next().await {
                let chunked_data = chunk.unwrap();
                // Reconstruct entire CSV data bytes here to prevent fragmentation of values.
                data = Bytes::from([data.as_ref(), chunked_data.as_ref()].concat());
            }
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
                    hour_key = super::ingestion::get_wal_time_key(
                        timestamp,
                        &vec![],
                        PartitionTimeLevel::Unset,
                        &json_record,
                        None,
                    );
                }
                records.push(value_str);
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
        &buf,
        thread_id,
        &StreamParams::new(org_id, stream_name, StreamType::EnrichmentTables),
        &mut stream_file_name,
        None,
    )
    .await;
    req_stats.response_time = start.elapsed().as_secs_f64();
    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
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
