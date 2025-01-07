// Copyright 2024 OpenObserve Inc.
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

use std::{collections::HashMap, fs::File, io::Error, sync::Arc};

use actix_multipart::Multipart;
use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use chrono::Utc;
use config::{
    cluster::LOCAL_NODE,
    get_config, ider,
    meta::{
        self_reporting::usage::UsageType,
        stream::{PartitionTimeLevel, StreamType},
    },
    utils::{flatten::format_key, json, schema_ext::SchemaExt},
    SIZE_IN_MB,
};
use futures::{StreamExt, TryStreamExt};
use infra::{
    cache::stats,
    schema::{
        SchemaCache, STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_COMPRESSED,
        STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
    },
    table::enrichment_table_jobs::{self, EnrichmentTableJobsRecord},
};
use tokio::io::AsyncWriteExt;

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
    service::{
        compact::retention,
        db::{self, enrichment_table},
        format_stream_name,
        ingestion::write_file,
        schema::{check_for_schema, stream_schema_exists},
        self_reporting::report_request_usage_stats,
    },
};

pub mod geoip;

// Constants for chunk size and record limits
const MAX_RECORDS: usize = 8192; // Save every 8192 records

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

    let stats = stats::get_stream_stats(org_id, stream_name, StreamType::EnrichmentTables);
    let max_enrichment_table_size = cfg.limit.max_enrichment_table_size;
    log::info!(
        "enrichment table [{stream_name}] saving stats: {:?} vs max_table_size {}",
        stats,
        max_enrichment_table_size
    );
    if (stats.storage_size / SIZE_IN_MB) > max_enrichment_table_size as f64 {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!(
                    "enrichment table [{stream_name}] storage size {} exceeds max storage size {}",
                    stats.storage_size, max_enrichment_table_size
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
    }

    let mut records = vec![];
    let mut records_size = 0;
    let timestamp = Utc::now().timestamp_micros();
    for mut json_record in payload {
        let timestamp = match json_record.get(&cfg.common.column_timestamp) {
            Some(v) => v.as_i64().unwrap_or(timestamp),
            None => timestamp,
        };
        json_record.insert(
            cfg.common.column_timestamp.clone(),
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
    let writer = ingester::get_writer(
        0,
        org_id,
        &StreamType::EnrichmentTables.to_string(),
        stream_name,
    )
    .await;
    let mut req_stats = write_file(&writer, stream_name, buf, !cfg.common.wal_fsync_disabled).await;

    // notify update
    if stream_schema.has_fields {
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

    // delete record_id generator if present
    {
        STREAM_RECORD_ID_GENERATOR.remove(&key);
    }

    // delete stream key
    let _ = enrichment_table::delete(org_id, stream_name).await;

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted enrichment table  {stream_name}");
}

pub async fn extract_multipart(
    mut payload: Multipart,
) -> Result<Vec<json::Map<String, json::Value>>, Error> {
    let mut records = Vec::new();
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
            data = bytes::Bytes::from([data.as_ref(), chunked_data.as_ref()].concat());
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

            if !json_record.is_empty() {
                records.push(json_record);
            }
        }
    }

    Ok(records)
}

pub async fn add_task(
    org_id: &str,
    table_name: &str,
    append_data: bool,
    file_link: Option<String>,
) -> Result<(String, String), Error> {
    let key = generte_file_key(org_id, table_name, append_data);
    let task_id = generate_task_id();
    enrichment_table_jobs::add(
        &task_id,
        enrichment_table_jobs::TaskStatus::Pending,
        Some(key.clone()),
        file_link,
    )
    .await
    .map_err(|e| {
        log::error!("[ENRICHMENT_TABLE] Failed to add task: {}", e);
        Error::other("Failed to add task")
    })?;
    Ok((task_id, key))
}

pub async fn store_file_to_disk(key: &str, file_link: &str) -> Result<(), anyhow::Error> {
    let (org_id, table_name, append_data) = parse_key(key);

    let temp_file_path = prepare_file_path(&org_id, &table_name, append_data).await?;

    let mut response = reqwest::get(file_link).await?;
    write_to_file(&temp_file_path, &mut response).await?;

    Ok(())
}

pub async fn store_multipart_to_disk(
    key: &str,
    mut payload: Multipart,
) -> Result<(), anyhow::Error> {
    let (org_id, table_name, append_data) = parse_key(key);

    let temp_file_path = prepare_file_path(&org_id, &table_name, append_data).await?;

    let mut temp_file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temp_file_path)
        .await?;

    while let Ok(Some(mut field)) = payload.try_next().await {
        if let Some(content_disposition) = field.content_disposition() {
            if content_disposition.get_filename().is_some() {
                while let Some(chunk) = field.next().await {
                    let chunk = chunk.unwrap();
                    temp_file.write_all(&chunk).await?;
                }
            }
        }
    }

    temp_file.flush().await?;
    drop(temp_file);

    Ok(())
}

async fn remove_temp_file(
    org_id: &str,
    table_name: &str,
    append_data: bool,
) -> Result<(), std::io::Error> {
    let temp_file_path = construct_file_path(org_id, table_name, append_data);
    tokio::fs::remove_file(&temp_file_path).await
}

pub async fn extract_and_save_data(task: &EnrichmentTableJobsRecord) -> Result<(), std::io::Error> {
    let Some(ref key) = task.file_key else {
        log::error!(
            "[ENRICHMENT_TABLE] File key not found for task_id: {}",
            task.task_id
        );
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "File key not found",
        ));
    };
    let (org_id, table_name, append_data) = parse_key(key);
    log::info!(
        "[ENRICHMENT_TABLE] Starting to extract and save data for org_id: {}, table_name: {}, append_data: {}",
        org_id,
        table_name,
        append_data
    );

    let mut record_buffer = Vec::new();
    let mut part_number = 0;
    let file_path = construct_file_path(&org_id, &table_name, append_data);
    let file = File::open(file_path)?;
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(file);
    let headers = rdr.headers()?.clone();

    // if append_data is false, then we need to delete the existing table
    // and create a new one when processing part 1
    // and the rest of the data will be appended to the new table
    let tmp_append_data = append_data || part_number != 1;

    for record in rdr.records() {
        let record = record?;
        let mut json_record = json::Map::new();

        for (header, field) in headers.iter().zip(record.iter()) {
            json_record.insert(header.into(), json::Value::String(field.into()));
        }

        record_buffer.push(json_record);

        // Send records in batches to the saving task
        if record_buffer.len() >= MAX_RECORDS {
            part_number += 1;

            let full_buffer = std::mem::take(&mut record_buffer);

            // Save the buffer
            save_enrichment_data(&org_id, &table_name, full_buffer, tmp_append_data).await?;
            log::debug!(
                "[ENRICHMENT_TABLE] Saved records for org_id: {}, table_name: {}, part_number: {}",
                org_id,
                table_name,
                part_number
            );
        }
    }

    // Send any remaining records in the buffer
    if !record_buffer.is_empty() {
        part_number += 1;

        let full_buffer = std::mem::take(&mut record_buffer);

        // Save the buffer
        save_enrichment_data(&org_id, &table_name, full_buffer, tmp_append_data).await?;
        log::debug!(
            "[ENRICHMENT_TABLE] Saved records for org_id: {}, table_name: {}, part_number: {}",
            org_id,
            table_name,
            part_number
        );
    }

    log::info!(
        "[ENRICHMENT_TABLE] All records processed successfully for org_id: {}, table_name: {}",
        org_id,
        table_name
    );

    remove_temp_file(&org_id, &table_name, append_data).await?;
    Ok(())
}

#[inline]
fn generate_task_id() -> String {
    ider::uuid()
}

#[inline]
fn generte_file_key(org_id: &str, table_name: &str, append_data: bool) -> String {
    format!("{}/{}/{}", org_id, table_name, append_data)
}

#[inline]
fn parse_key(key: &str) -> (String, String, bool) {
    let parts: Vec<&str> = key.split('/').collect();
    let org_id = parts[0].to_string();
    let table_name = parts[1].to_string();
    let append_data = parts[2].parse::<bool>().unwrap_or(false);

    (org_id, table_name, append_data)
}

#[inline]
fn construct_file_path(org_id: &str, table_name: &str, append_data: bool) -> String {
    let tmp_dir = get_config().common.data_tmp_dir.clone();
    let dir_path = format!("{}enrichment_table/{}/", tmp_dir, org_id);
    format!("{}{}_{}.csv", dir_path, table_name, append_data)
}

#[inline]
async fn prepare_file_path(
    org_id: &str,
    table_name: &str,
    append_data: bool,
) -> Result<String, Error> {
    let file_path = construct_file_path(org_id, table_name, append_data);

    // Extract the directory from the file path
    if let Some(dir_path) = std::path::Path::new(&file_path).parent() {
        tokio::fs::create_dir_all(dir_path).await?;
    }
    Ok(file_path)
}

#[inline]
async fn write_to_file(file_path: &str, response: &mut reqwest::Response) -> Result<(), Error> {
    let mut temp_file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(file_path)
        .await?;

    while let Ok(Some(chunk)) = response.chunk().await {
        temp_file.write_all(&chunk).await?;
    }

    temp_file.flush().await?;
    Ok(())
}
