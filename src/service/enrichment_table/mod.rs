// Copyright 2025 OpenObserve Inc.
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
    HttpResponse,
    http::{self, StatusCode},
};
use bytes::Bytes;
use chrono::Utc;
use config::{
    SIZE_IN_MB, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        self_reporting::usage::UsageType,
        stream::{PartitionTimeLevel, StreamType},
    },
    utils::{flatten::format_key, json, schema_ext::SchemaExt, time::now_micros},
};
use futures::{StreamExt, TryStreamExt};
use hashbrown::HashSet;
use infra::{
    cache::stats,
    schema::{
        STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
        SchemaCache,
    },
};

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
    handler::http::router::ERROR_HEADER,
    service::{
        db, format_stream_name,
        ingestion::write_file,
        schema::{check_for_schema, stream_schema_exists},
        self_reporting::report_request_usage_stats,
    },
};

pub mod geoip;

pub async fn save_enrichment_data(
    org_id: &str,
    table_name: &str,
    payload: Vec<json::Map<String, json::Value>>,
    append_data: bool,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();
    let cfg = get_config();

    let mut hour_key = String::new();
    let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
    let table_name = table_name.trim();
    let stream_name = &format_stream_name(table_name);

    if !LOCAL_NODE.is_ingester() {
        return Ok(HttpResponse::InternalServerError()
            .append_header((ERROR_HEADER, "not an ingester".to_string()))
            .json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )));
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(
        org_id,
        StreamType::EnrichmentTables,
        stream_name,
        None,
    ) {
        return Ok(HttpResponse::BadRequest()
            .append_header((
                ERROR_HEADER,
                format!("enrichment table [{stream_name}] is being deleted"),
            ))
            .json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("enrichment table [{stream_name}] is being deleted"),
            )));
    }

    // Estimate the size of the payload in json format in bytes
    let mut bytes_in_payload = 0;
    for p in payload.iter() {
        match json::to_value(p) {
            Ok(v) => bytes_in_payload += json::estimate_json_bytes(&v),
            Err(_) => {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid JSON payload: Could not convert file data into valid JSON object"
                        .to_string(),
                )));
            }
        }
    }

    let current_size_in_bytes = if append_data {
        db::enrichment_table::get_table_size(org_id, stream_name).await
    } else {
        // If we are not appending data, we do not need to check the current size
        // we will simply use the payload size to check if it exceeds the max size
        0.0
    };
    let enrichment_table_max_size = cfg.limit.enrichment_table_max_size as f64;
    let total_expected_size_in_bytes = current_size_in_bytes + bytes_in_payload as f64;
    let total_expected_size_in_mb = total_expected_size_in_bytes / SIZE_IN_MB;
    log::info!(
        "enrichment table [{stream_name}] current stats in bytes: {:?} vs total expected size in mb: {} vs max_table_size in mb: {}",
        current_size_in_bytes,
        total_expected_size_in_mb,
        enrichment_table_max_size
    );

    // we need to check if the storage size exceeds the max size
    // if not, we can append the data
    // if it does, we need to return an error
    if total_expected_size_in_mb > enrichment_table_max_size {
        return Ok(
            HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!(
                    "enrichment table [{stream_name}] total expected storage size {} exceeds max storage size {}",
                    total_expected_size_in_mb, enrichment_table_max_size
                ),
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
        stream_schema_map.remove(stream_name);
    }

    let mut records = vec![];
    let mut records_size = 0;
    let timestamp = Utc::now().timestamp_micros();
    for mut json_record in payload {
        let timestamp = match json_record.get(TIMESTAMP_COL_NAME) {
            Some(v) => v.as_i64().unwrap_or(timestamp),
            None => timestamp,
        };
        json_record.insert(
            TIMESTAMP_COL_NAME.to_string(),
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
            hour_key = super::ingestion::get_write_partition_key(
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

    if records.is_empty() {
        return Ok(HttpResponse::Ok().json(MetaHttpResponse::error(
            StatusCode::OK.into(),
            "Saved enrichment table".to_string(),
        )));
    }

    let schema = stream_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());
    let schema = Arc::new(schema);
    let schema_key = schema.hash_key();
    buf.insert(
        hour_key,
        SchemaRecords {
            schema_key,
            schema: schema.clone(),
            records,
            records_size,
        },
    );

    // write data to wal
    let writer = ingester::get_writer(
        0,
        org_id,
        StreamType::EnrichmentTables.as_str(),
        stream_name,
    )
    .await;
    let mut req_stats =
        match write_file(&writer, stream_name, buf, !cfg.common.wal_fsync_disabled).await {
            Ok(stats) => stats,
            Err(e) => {
                return Ok(HttpResponse::InternalServerError()
                    .append_header((
                        ERROR_HEADER,
                        format!("Error writing enrichment table: {}", e),
                    ))
                    .json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        format!("Error writing enrichment table: {}", e),
                    )));
            }
        };

    let mut enrich_meta_stats = enrichment_table::get_meta_table_stats(org_id, stream_name)
        .await
        .unwrap_or_default();

    if !append_data {
        enrich_meta_stats.start_time = started_at;
    }
    if enrich_meta_stats.start_time == 0 {
        enrich_meta_stats.start_time = enrichment_table::get_start_time(org_id, stream_name).await;
    }
    enrich_meta_stats.end_time = now_micros();
    enrich_meta_stats.size = total_expected_size_in_bytes as i64;
    // The stream_stats table takes some time to update, so we need to update the enrichment table
    // size in the meta table to avoid exceeding the `ZO_ENRICHMENT_TABLE_LIMIT`.
    let _ = enrichment_table::update_meta_table_stats(org_id, stream_name, enrich_meta_stats).await;

    // notify update
    if !schema.fields().is_empty() {
        if let Err(e) = super::db::enrichment_table::notify_update(org_id, stream_name).await {
            log::error!("Error notifying enrichment table {org_id}/{stream_name} update: {e}");
        };
    }

    req_stats.response_time = start.elapsed().as_secs_f64();
    log::info!(
        "save enrichment data to: {}/{}/{} success with stats {:?}",
        org_id,
        table_name,
        append_data,
        req_stats
    );

    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        stream_name,
        StreamType::Logs,
        UsageType::EnrichmentTable,
        0,
        started_at,
    )
    .await;

    let mut enrich_meta_stats = db::enrichment_table::get_meta_table_stats(org_id, stream_name)
        .await
        .unwrap_or_default();

    if !append_data {
        enrich_meta_stats.start_time = started_at;
    }
    if enrich_meta_stats.start_time == 0 {
        enrich_meta_stats.start_time =
            db::enrichment_table::get_start_time(org_id, stream_name).await;
    }
    enrich_meta_stats.end_time = now_micros();
    enrich_meta_stats.size = total_expected_size_in_bytes as i64;
    // The stream_stats table takes some time to update, so we need to update the enrichment table
    // size in the meta table to avoid exceeding the `ZO_ENRICHMENT_TABLE_LIMIT`.
    let _ =
        db::enrichment_table::update_meta_table_stats(org_id, stream_name, enrich_meta_stats).await;

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

    // create delete for compactor
    if let Err(e) =
        db::compact::retention::delete_stream(org_id, stream_type, stream_name, None).await
    {
        log::error!("Error creating stream retention job: {}", e);
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    let mut w = STREAM_SCHEMAS.write().await;
    w.remove(&key);
    drop(w);
    let mut w = STREAM_SCHEMAS_LATEST.write().await;
    w.remove(&key);
    drop(w);

    // delete stream settings cache
    let mut w = STREAM_SETTINGS.write().await;
    w.remove(&key);
    infra::schema::set_stream_settings_atomic(w.clone());
    drop(w);

    // delete record_id generator if present
    {
        STREAM_RECORD_ID_GENERATOR.remove(&key);
    }

    // delete stream key
    if let Err(e) = db::enrichment_table::delete(org_id, stream_name).await {
        log::error!("Error deleting enrichment table: {}", e);
    }

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted enrichment table  {stream_name}");
}

pub async fn extract_multipart(
    mut payload: Multipart,
    append_data: bool,
) -> Result<Vec<json::Map<String, json::Value>>, Error> {
    let mut records = Vec::new();
    let mut headers_set = HashSet::new();
    while let Ok(Some(mut field)) = payload.try_next().await {
        let Some(content_disposition) = field.content_disposition() else {
            continue;
        };
        if content_disposition.get_filename().is_none() {
            continue;
        };

        let mut data = bytes::Bytes::new();
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
                headers_set.insert(x.clone());
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

            if !json_record.is_empty() {
                records.push(json_record);
            }
        }
    }

    if records.is_empty() && !headers_set.is_empty() && !append_data {
        // If the records are empty, that means user has uploaded only headers, not the data
        // So, we can assume that the user wants to upload an enrichment table with no row data.
        // The headers are the columns of the enrichment table. Lets push a json
        // with the headers as the keys and empty strings as the values.

        // This way we will still have the headers in the enrichment table.
        // And the enrichment table will not be deleted.
        let mut json_record = json::Map::new();
        for header in headers_set {
            json_record.insert(header, json::Value::String("".to_string()));
        }
        records.push(json_record);
    }

    Ok(records)
}
