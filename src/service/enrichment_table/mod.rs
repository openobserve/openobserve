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

use std::{collections::HashMap, io::Error, sync::Arc};

use actix_multipart::Multipart;
use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use bytes::Bytes;
use chrono::Utc;
use config::{
    cluster,
    meta::{
        stream::{PartitionTimeLevel, StreamType},
        usage::UsageType,
    },
    utils::{flatten::format_key, json, schema_ext::SchemaExt},
    CONFIG,
};
use futures::{StreamExt, TryStreamExt};
use infra::{
    cache::stats,
    schema::{
        SchemaCache, STREAM_SCHEMAS, STREAM_SCHEMAS_COMPRESSED, STREAM_SCHEMAS_LATEST,
        STREAM_SETTINGS,
    },
};

use crate::{
    common::meta::{self, http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
    service::{
        compact::retention,
        db, format_stream_name,
        ingestion::write_file,
        schema::{check_for_schema, stream_schema_exists},
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
    let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
    let table_name = table_name.trim();
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
        StreamType::EnrichmentTables,
        stream_name,
        None,
    ) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("enrichment table [{stream_name}] is being deleted"),
            )),
        );
    }

    let mut schema_evolved = false;
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
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
    let mut records_size = 0;
    let timestamp = if !append_data {
        Utc::now().timestamp_micros()
    } else {
        let schema = stream_schema_map.get(stream_name).unwrap();
        schema
            .schema()
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
            let headers: csv::StringRecord = rdr
                .headers()?
                .iter()
                .map(|x| {
                    let mut x = x.trim().to_string();
                    format_key(&mut x);
                    x
                })
                .collect::<Vec<_>>()
                .into();

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

                // check for schema evolution
                if !schema_evolved
                    && check_for_schema(
                        org_id,
                        stream_name,
                        StreamType::EnrichmentTables,
                        &mut stream_schema_map,
                        vec![&json_record],
                        timestamp,
                    )
                    .await
                    .is_ok()
                {
                    schema_evolved = true;
                }

                if records.is_empty() {
                    let schema = stream_schema_map.get(stream_name).unwrap();
                    let schema_key = schema.hash_key();
                    hour_key = super::ingestion::get_wal_time_key(
                        timestamp,
                        &vec![],
                        PartitionTimeLevel::Unset,
                        &json_record,
                        Some(schema_key),
                    );
                }
                let record = json::Value::Object(json_record);
                let record_size = json::estimate_json_bytes(&record);
                records.push(Arc::new(record));
                records_size += record_size;
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

    let schema = stream_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .clone()
        .with_metadata(HashMap::new());
    let schema_key = schema.hash_key();
    buf.insert(
        hour_key,
        SchemaRecords {
            schema_key,
            schema: Arc::new(schema),
            records,
            records_size,
        },
    );

    // write data to wal
    let writer =
        ingester::get_writer(thread_id, org_id, &StreamType::EnrichmentTables.to_string()).await;
    let mut req_stats = write_file(&writer, stream_name, buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

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

    if let Err(e) = retention::delete_all(org_id, stream_type, stream_name).await {
        log::error!("Error deleting stream {}", e);
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    let mut w = STREAM_SCHEMAS.write().await;
    w.remove(&key);
    drop(w);
    let mut w = STREAM_SCHEMAS_COMPRESSED.write().await;
    w.remove(&key);
    drop(w);
    let mut w = STREAM_SCHEMAS_LATEST.write().await;
    w.remove(&key);
    drop(w);

    // delete stream settings cache
    let mut w = STREAM_SETTINGS.write().await;
    w.remove(&key);
    drop(w);

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted enrichment table  {stream_name}");
}
