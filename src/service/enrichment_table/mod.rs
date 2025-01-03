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

use std::{collections::HashMap, io::Error, sync::Arc};

use actix_multipart::Multipart;
use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use chrono::Utc;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        self_reporting::usage::UsageType,
        stream::{PartitionTimeLevel, StreamType},
    },
    utils::{flatten::format_key, json, schema_ext::SchemaExt},
    SIZE_IN_MB,
};
use futures::{channel::mpsc, sink::SinkExt, StreamExt, TryStreamExt};
use infra::{
    cache::stats,
    schema::{
        SchemaCache, STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_COMPRESSED,
        STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
    },
};
use tokio::sync::Semaphore;

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
const MAX_CHUNK_SIZE: usize = 25 * 1024 * 1024; // 25 MB
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

pub async fn extract_and_save_data(
    org_id: &str,
    table_name: &str,
    append_data: bool,
    mut payload: Multipart,
) -> Result<(), std::io::Error> {
    log::info!(
        "Starting to extract and save data for org_id: {}, table_name: {}, append_data: {}",
        org_id,
        table_name,
        append_data
    );

    // Create a channel to send extracted records to the saving task
    let (mut tx, mut rx) = mpsc::unbounded::<Vec<json::Map<String, json::Value>>>();
    let semaphore = Arc::new(Semaphore::new(1));

    // Spawn a separate task to handle saving records
    let org_id_clone = org_id.to_string();
    let table_name_clone = table_name.to_string();
    let saving_task = tokio::spawn(async move {
        while let Some(records) = rx.next().await {
            if let Err(e) = save_records(
                records,
                semaphore.clone(),
                &org_id_clone,
                &table_name_clone,
                append_data,
            )
            .await
            {
                log::error!("Error saving records: {:?}", e);
            }
        }
    });

    let mut data_buffer = Vec::new();
    let mut leftover = String::new();
    let mut record_buffer = Vec::new();
    let mut chunk_id = 0;
    let mut part_number = 0;
    let mut headers: Option<csv::StringRecord> = None;

    // Process each field in the multipart payload
    while let Ok(Some(mut field)) = payload.try_next().await {
        let Some(content_disposition) = field.content_disposition() else {
            continue;
        };
        if content_disposition.get_filename().is_none() {
            continue;
        };

        // Process the field's data in chunks
        while let Some(chunk) = field.next().await {
            let chunk = chunk.unwrap();
            data_buffer.extend_from_slice(&chunk);

            if headers.is_none() {
                let (head_record, remaining_data) = extract_headers_and_data(&data_buffer)?;
                if head_record.is_some() {
                    headers = head_record;
                }
                data_buffer = remaining_data;
            }

            // If the data buffer exceeds MAX_CHUNK_SIZE, process it
            if data_buffer.len() >= MAX_CHUNK_SIZE {
                chunk_id += 1;

                let processed_data = process_chunk(&data_buffer, &mut leftover, chunk_id)?;

                // Parse and buffer records from the processed data
                parse_and_buffer_records(
                    &processed_data,
                    &mut record_buffer,
                    &mut tx,
                    chunk_id,
                    &mut part_number,
                    headers.as_ref(),
                )
                .await?;

                data_buffer.clear();
            }
        }
    }

    // Process any remaining data in the buffer
    if !data_buffer.is_empty() || !leftover.is_empty() {
        chunk_id += 1;

        let processed_data = process_chunk(&data_buffer, &mut leftover, chunk_id)?;
        parse_and_buffer_records(
            &processed_data,
            &mut record_buffer,
            &mut tx,
            chunk_id,
            &mut part_number,
            headers.as_ref(),
        )
        .await?;
    }

    // Save any remaining records in the record buffer
    if !record_buffer.is_empty() {
        part_number += 1;

        // Send the buffer to the saving task
        if let Err(e) = tx.send(record_buffer).await {
            log::error!(
                "Error sending remaining records for chunk ID {}, part_number: {}, to saving task: {}",
                chunk_id,
                part_number,
                e
            );
        }
    }

    drop(tx);

    // Wait for the saving task to complete
    if let Err(e) = saving_task.await {
        log::error!("Error in saving task: {:?}", e);
    }

    log::info!(
        "[ENRICHMENT_TABLE] All records processed successfully for org_id: {}, table_name: {}",
        org_id,
        table_name
    );
    Ok(())
}

fn extract_headers_and_data(
    data: &[u8],
) -> Result<(Option<csv::StringRecord>, Vec<u8>), std::io::Error> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(data);

    // Extract the first row as the header
    let headers = if let Some(result) = rdr.records().next() {
        match result {
            Ok(record) => Some(record),
            Err(e) => {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, e));
            }
        }
    } else {
        None
    };

    // Get the remaining unprocessed data
    let position = rdr.position().byte();
    let remaining_data = data[position as usize..].to_vec();

    Ok((headers, remaining_data))
}

fn process_chunk(
    data: &[u8],
    leftover: &mut String,
    _chunk_id: usize,
) -> Result<Vec<u8>, std::io::Error> {
    // Combine leftover with the current chunk
    let mut combined_data = leftover.clone();
    if !data.is_empty() {
        let data = std::str::from_utf8(data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        combined_data.push_str(data);
    } else {
        // We can assume that this is the last chunk
        // Append a newline character if the data does not end with one
        if !combined_data.ends_with('\n') && !combined_data.is_empty() {
            combined_data.push('\n');
        }
    }

    let mut processed_data = Vec::new();
    let mut is_incomplete = false;

    // Split the data into lines
    for line in combined_data.split_inclusive('\n') {
        if line.ends_with('\n') {
            processed_data.extend_from_slice(line.as_bytes());
        } else {
            *leftover = combined_data[line.as_ptr() as usize - combined_data.as_ptr() as usize..]
                .to_string();
            is_incomplete = true;
            break;
        }
    }

    if !is_incomplete {
        leftover.clear();
    }

    Ok(processed_data)
}

#[allow(clippy::too_many_arguments)]
async fn parse_and_buffer_records(
    data: &[u8],
    record_buffer: &mut Vec<json::Map<String, json::Value>>,
    tx: &mut mpsc::UnboundedSender<Vec<json::Map<String, json::Value>>>,
    chunk_id: usize,
    part_number: &mut usize,
    headers: Option<&csv::StringRecord>,
) -> Result<(), std::io::Error> {
    let headers = match headers {
        Some(h) => h.clone(),
        None => {
            log::error!("Headers not found for chunk ID: {}", chunk_id);
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Headers not found",
            ));
        }
    };

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .from_reader(data);

    for record in rdr.records() {
        let record = record?;
        let mut json_record = json::Map::new();

        for (header, field) in headers.iter().zip(record.iter()) {
            json_record.insert(header.into(), json::Value::String(field.into()));
        }

        record_buffer.push(json_record);

        // Trigger save when the buffer reaches MAX_RECORDS
        if record_buffer.len() >= MAX_RECORDS {
            *part_number += 1;

            let full_buffer = std::mem::take(record_buffer);

            // Send the buffer to the saving task
            if let Err(e) = tx.send(full_buffer).await {
                log::error!(
                    "Error sending records for chunk ID {} to saving task: {}",
                    chunk_id,
                    e
                );
            }
        }
    }

    // Handle any remaining records in the buffer
    if !record_buffer.is_empty() {
        *part_number += 1;

        let full_buffer = std::mem::take(record_buffer);

        // Send the buffer to the saving task
        if let Err(e) = tx.send(full_buffer).await {
            log::error!(
                "Error sending remaining records for chunk ID {} to saving task: {}",
                chunk_id,
                e
            );
        }
    }

    Ok(())
}

async fn save_records(
    records: Vec<json::Map<String, json::Value>>,
    semaphore: Arc<Semaphore>,
    org_id: &str,
    table_name: &str,
    append_data: bool,
) -> Result<(), std::io::Error> {
    let _permit = semaphore.acquire().await.unwrap();
    if let Err(e) = save_enrichment_data(org_id, table_name, records, append_data).await {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("Error saving records: {:?}", e,),
        ));
    }

    Ok(())
}
