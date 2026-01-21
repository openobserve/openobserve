// Copyright 2026 OpenObserve Inc.
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

use arrow_schema::Schema;
use axum::{
    extract::Multipart,
    http::{self, StatusCode},
    response::Response as HttpResponse,
};
use bytes::Bytes;
use chrono::Utc;
use config::{
    SIZE_IN_MB, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::stream::StreamType,
    utils::{flatten::format_key, json, schema::infer_json_schema_from_map, time::BASE_TIME},
};
use hashbrown::HashSet;
use infra::{
    cache::stats,
    schema::{
        STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
        SchemaCache,
    },
};

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::router::ERROR_HEADER,
    service::{
        db,
        enrichment::storage::Values,
        format_stream_name,
        schema::{check_for_schema, stream_schema_exists}, /* self_reporting::report_request_usage_stats, */
    },
};

pub mod geoip;
pub mod url_processor;

// Re-export the initialization function for easy access
pub use url_processor::init_url_processor;

pub async fn save_enrichment_data(
    org_id: &str,
    table_name: &str,
    payload: Vec<json::Map<String, json::Value>>,
    append_data: bool,
) -> Result<HttpResponse, Error> {
    // let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();
    let cfg = get_config();

    // let mut hour_key = String::new();
    // let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
    let table_name = table_name.trim();
    let stream_name = format_stream_name(table_name.to_string());

    if !LOCAL_NODE.is_ingester() {
        let mut resp = MetaHttpResponse::internal_error("not an ingester");
        resp.headers_mut().insert(
            ERROR_HEADER,
            http::HeaderValue::from_str("not an ingester").unwrap(),
        );
        return Ok(resp);
    }

    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(
        org_id,
        StreamType::EnrichmentTables,
        &stream_name,
        None,
    ) {
        let error_msg = format!("enrichment table [{stream_name}] is being deleted");
        let mut resp = MetaHttpResponse::bad_request(&error_msg);
        resp.headers_mut().insert(
            ERROR_HEADER,
            http::HeaderValue::from_str(&error_msg).unwrap(),
        );
        return Ok(resp);
    }

    // Estimate the size of the payload in json format in bytes
    let mut bytes_in_payload = 0;
    for p in payload.iter() {
        match json::to_value(p) {
            Ok(v) => bytes_in_payload += json::estimate_json_bytes(&v),
            Err(_) => {
                return Ok(MetaHttpResponse::bad_request(
                    "Invalid JSON payload: Could not convert file data into valid JSON object",
                ));
            }
        }
    }

    let current_size_in_bytes = if append_data {
        db::enrichment_table::get_table_size(org_id, &stream_name).await
    } else {
        // If we are not appending data, we do not need to check the current size
        // we will simply use the payload size to check if it exceeds the max size
        0.0
    };
    let enrichment_table_max_size = cfg.limit.enrichment_table_max_size as f64;
    let total_expected_size_in_bytes = current_size_in_bytes + bytes_in_payload as f64;
    let total_expected_size_in_mb = total_expected_size_in_bytes / SIZE_IN_MB;
    log::info!(
        "enrichment table [{stream_name}] current stats in bytes: {current_size_in_bytes:?} vs total expected size in mb: {total_expected_size_in_mb} vs max_table_size in mb: {enrichment_table_max_size}"
    );

    // we need to check if the storage size exceeds the max size
    // if not, we can append the data
    // if it does, we need to return an error
    if total_expected_size_in_mb > enrichment_table_max_size {
        return Ok(MetaHttpResponse::bad_request(format!(
            "enrichment table [{stream_name}] total expected storage size {total_expected_size_in_mb} exceeds max storage size {enrichment_table_max_size}"
        )));
    }

    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let stream_schema = stream_schema_exists(
        org_id,
        &stream_name,
        StreamType::EnrichmentTables,
        &mut stream_schema_map,
    )
    .await;

    if stream_schema.has_fields && !append_data {
        let start_time = BASE_TIME.timestamp_micros();
        let now = Utc::now().timestamp_micros();
        delete_enrichment_table(
            org_id,
            &stream_name,
            StreamType::EnrichmentTables,
            (start_time, now),
        )
        .await;
        stream_schema_map.remove(&stream_name);
    }

    let mut records = vec![];
    let mut records_size = 0;
    let timestamp = Utc::now().timestamp_micros();
    for mut json_record in payload {
        // Use now as _timestamp in the json records, as we don't
        // care about the timestamp in enrichment tables. Also, we can use the timestamp
        // as start_time and end_time in the meta table stats.
        json_record.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number(timestamp.into()),
        );

        let record = json::Value::Object(json_record);
        let record_size = json::estimate_json_bytes(&record);
        records.push(record);
        records_size += record_size;
    }

    let mut record_vals = vec![];
    for record in records.iter() {
        record_vals.push(record.as_object().unwrap());
    }

    // disallow schema change for enrichment tables
    let value_iter = record_vals.iter().take(1).cloned().collect::<Vec<_>>();
    let inferred_schema =
        infer_json_schema_from_map(value_iter.into_iter(), StreamType::EnrichmentTables)
            .map_err(|_e| std::io::Error::other("Error inferring schema"))?;
    let db_schema = stream_schema_map
        .get(&stream_name)
        .map(|s| s.schema().as_ref().clone())
        .unwrap_or(Schema::empty());
    if !db_schema.fields().is_empty() && db_schema.fields().ne(inferred_schema.fields()) {
        log::error!("Schema mismatch for enrichment table {org_id}/{stream_name}");
        let error_msg = format!("Schema mismatch for enrichment table {org_id}/{stream_name}");
        let mut resp = MetaHttpResponse::internal_error(&error_msg);
        resp.headers_mut().insert(
            ERROR_HEADER,
            http::HeaderValue::from_str(&error_msg).unwrap(),
        );
        return Ok(resp);
    }

    // check for schema evolution
    let _ = check_for_schema(
        org_id,
        &stream_name,
        StreamType::EnrichmentTables,
        &mut stream_schema_map,
        record_vals,
        timestamp,
        false,
    )
    .await;

    if records.is_empty() {
        return Ok(MetaHttpResponse::json(MetaHttpResponse::message(
            StatusCode::OK,
            "Saved enrichment table",
        )));
    }

    let schema = stream_schema_map
        .get(&stream_name)
        .unwrap()
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());
    let schema = Arc::new(schema);

    // If data size is less than the merge threshold, we can store it in the database
    let merge_threshold_mb = crate::service::enrichment::storage::remote::get_merge_threshold_mb()
        .await
        .unwrap_or(100) as f64;
    if (records_size as f64) < merge_threshold_mb * SIZE_IN_MB {
        if let Err(e) = crate::service::enrichment::storage::database::store(
            org_id,
            &stream_name,
            &records,
            timestamp,
        )
        .await
        {
            log::error!("Error writing enrichment table to database: {e}");
            let error_msg = format!("Error writing enrichment table to database: {e}");
            let mut resp =
                MetaHttpResponse::internal_error("Error writing enrichment table to database");
            resp.headers_mut().insert(
                ERROR_HEADER,
                http::HeaderValue::from_str(&error_msg).unwrap(),
            );
            return Ok(resp);
        }
    } else {
        // If data size is greater than the merge threshold, we can store it directly to s3
        if let Err(e) = crate::service::enrichment::storage::remote::store(
            org_id,
            &stream_name,
            &records,
            timestamp,
        )
        .await
        {
            log::error!("Error writing enrichment table to S3: {e}");
        }
    }

    // write data to local cache
    if let Err(e) = crate::service::enrichment::storage::local::store(
        org_id,
        &stream_name,
        Values::Json(std::sync::Arc::new(records)),
        timestamp,
    )
    .await
    {
        log::error!("Error writing enrichment table to local cache: {e}");
    }

    let mut enrich_meta_stats = db::enrichment_table::get_meta_table_stats(org_id, &stream_name)
        .await
        .unwrap_or_default();

    if !append_data {
        enrich_meta_stats.start_time = started_at;
    }
    if enrich_meta_stats.start_time == 0 {
        enrich_meta_stats.start_time =
            db::enrichment_table::get_start_time(org_id, &stream_name).await;
    }
    enrich_meta_stats.end_time = timestamp;
    enrich_meta_stats.size = total_expected_size_in_bytes as i64;
    // The stream_stats table takes some time to update, so we need to update the enrichment table
    // size in the meta table to avoid exceeding the `ZO_ENRICHMENT_TABLE_LIMIT`.
    let _ = db::enrichment_table::update_meta_table_stats(org_id, &stream_name, enrich_meta_stats)
        .await;

    // notify update
    if !schema.fields().is_empty()
        && let Err(e) = super::db::enrichment_table::notify_update(org_id, &stream_name).await
    {
        log::error!("Error notifying enrichment table {org_id}/{stream_name} update: {e}");
    }

    log::info!("save enrichment data to: {org_id}/{table_name}/{append_data} success with stats");

    Ok(MetaHttpResponse::json(MetaHttpResponse::message(
        StatusCode::OK,
        "Saved enrichment table",
    )))
}

pub async fn delete_enrichment_table(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: (i64, i64),
) {
    log::info!("deleting enrichment table  {stream_name}");
    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        log::error!("Error deleting stream schema: {e}");
    }

    if let Err(e) = crate::service::enrichment::storage::local::delete(org_id, stream_name).await {
        log::error!("Error deleting enrichment table from local cache: {e}");
    }
    if let Err(e) = crate::service::enrichment::storage::database::delete(org_id, stream_name).await
    {
        log::error!("Error deleting enrichment table from database: {e}");
    }

    if let Err(e) = delete_from_file_list(org_id, stream_type, stream_name, time_range).await {
        log::error!("Error deleting enrichment table from file list: {e}");
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
        log::error!("Error deleting enrichment table: {e}");
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

    while let Ok(Some(mut field)) = payload.next_field().await {
        if field.file_name().is_none() {
            continue;
        }

        let mut data = Bytes::new();
        while let Some(chunk) = field.chunk().await.transpose() {
            let chunk = chunk.unwrap();
            // Reconstruct entire data bytes here to prevent fragmentation of values.
            data = Bytes::from([data.as_ref(), chunk.as_ref()].concat());
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

pub async fn cleanup_enrichment_table_resources(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) {
    log::info!("cleaning up enrichment table  resources {stream_name}");

    if let Err(e) = crate::service::enrichment::storage::local::delete(org_id, stream_name).await {
        log::error!("Error deleting enrichment table from local cache: {e}");
    }
    if let Err(e) = crate::service::enrichment::storage::database::delete(org_id, stream_name).await
    {
        log::error!("Error deleting enrichment table from database: {e}");
    }

    // delete stream key
    if let Err(e) = db::enrichment_table::delete(org_id, stream_name).await {
        log::error!("Error deleting enrichment table: {e}");
    }

    // delete URL job record if it exists
    if let Err(e) = db::enrichment_table::delete_url_job(org_id, stream_name).await {
        log::error!("Error deleting enrichment table URL job: {e}");
    }

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);
    log::info!("deleted enrichment table  {stream_name}");
}

pub async fn delete_from_file_list(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: (i64, i64),
) -> Result<(), anyhow::Error> {
    crate::service::compact::retention::delete_from_file_list(
        org_id,
        stream_type,
        stream_name,
        time_range,
    )
    .await
    .map_err(|e| {
        log::error!("[ENRICHMENT_TABLE] delete_from_file_list failed: {e}");
        e
    })?;

    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
        let cfg = get_o2_config();
        if cfg.super_cluster.enabled {
            let time_range = config::meta::stream::TimeRange::new(time_range.0, time_range.1);
            let time_range_str = serde_json::to_string(&time_range).unwrap();
            let file_list_key =
                format!("/enrichment_file_list_delete/{org_id}/{stream_type}/{stream_name}");

            // broadcast the event to other region compactor nodes
            if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::put(
                &file_list_key,
                time_range_str.into(),
                false,
                None,
            )
            .await
            {
                log::error!(
                    "[ENRICHMENT_TABLE] Error broadcasting enrichment table {org_id}/{stream_name} file list delete event: {e}"
                );
            }
            // let _ = o2_enterprise::enterprise::super_cluster::queue::file_list_delete(
            //     file_list_key,
            //     time_range,
            // )
            // .await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use futures_util::stream;

    use super::*;

    // Since axum::Multipart has a private inner field and no public constructor,
    // we use unsafe transmute to convert multer::Multipart to axum::Multipart.
    // This is safe because axum::Multipart is a simple wrapper struct with the same memory layout:
    // pub struct Multipart { inner: multer::Multipart<'static> }
    unsafe fn create_axum_multipart(multer_multipart: multer::Multipart<'static>) -> Multipart {
        unsafe { std::mem::transmute::<multer::Multipart<'static>, Multipart>(multer_multipart) }
    }

    // Helper function to create a mock Multipart from CSV data
    fn create_multipart_from_csv(csv_data: &str, filename: &str) -> Multipart {
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
        let mut body = Vec::new();

        // Create multipart form data
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(b"Content-Type: text/csv\r\n\r\n");
        body.extend_from_slice(csv_data.as_bytes());
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        // Create a stream from the body
        let stream = stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(body))]);

        // Create multer::Multipart directly
        let multer_multipart = multer::Multipart::new(stream, boundary);

        // Wrap it in Axum's Multipart using unsafe transmute
        unsafe { create_axum_multipart(multer_multipart) }
    }

    // Helper function to create empty multipart
    fn create_empty_multipart() -> Multipart {
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
        let body = format!("--{boundary}--\r\n");

        let stream = stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(body))]);
        let multer_multipart = multer::Multipart::new(stream, boundary);
        unsafe { create_axum_multipart(multer_multipart) }
    }

    // Helper function to create multipart with field without filename
    fn create_multipart_without_filename() -> Multipart {
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
        let mut body = Vec::new();

        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"field\"\r\n\r\n");
        body.extend_from_slice(b"some value");
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let stream = stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(body))]);
        let multer_multipart = multer::Multipart::new(stream, boundary);
        unsafe { create_axum_multipart(multer_multipart) }
    }

    #[tokio::test]
    async fn test_extract_multipart_valid_csv_data() {
        let csv_data = "name,age,city\nJohn,25,New York\nJane,30,Los Angeles\nBob,35,Chicago";
        let multipart = create_multipart_from_csv(csv_data, "test.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 3);

        // Check first record
        assert_eq!(
            records[0].get("name"),
            Some(&json::Value::String("John".to_string()))
        );
        assert_eq!(
            records[0].get("age"),
            Some(&json::Value::String("25".to_string()))
        );
        assert_eq!(
            records[0].get("city"),
            Some(&json::Value::String("New York".to_string()))
        );

        // Check second record
        assert_eq!(
            records[1].get("name"),
            Some(&json::Value::String("Jane".to_string()))
        );
        assert_eq!(
            records[1].get("age"),
            Some(&json::Value::String("30".to_string()))
        );
        assert_eq!(
            records[1].get("city"),
            Some(&json::Value::String("Los Angeles".to_string()))
        );

        // Check third record
        assert_eq!(
            records[2].get("name"),
            Some(&json::Value::String("Bob".to_string()))
        );
        assert_eq!(
            records[2].get("age"),
            Some(&json::Value::String("35".to_string()))
        );
        assert_eq!(
            records[2].get("city"),
            Some(&json::Value::String("Chicago".to_string()))
        );
    }

    #[tokio::test]
    async fn test_extract_multipart_headers_only_append_false() {
        let csv_data = "name,age,city\n";
        let multipart = create_multipart_from_csv(csv_data, "headers_only.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 1);

        // Should create a record with empty values for each header
        assert_eq!(
            records[0].get("name"),
            Some(&json::Value::String("".to_string()))
        );
        assert_eq!(
            records[0].get("age"),
            Some(&json::Value::String("".to_string()))
        );
        assert_eq!(
            records[0].get("city"),
            Some(&json::Value::String("".to_string()))
        );
    }

    #[tokio::test]
    async fn test_extract_multipart_headers_only_append_true() {
        let csv_data = "name,age,city\n";
        let multipart = create_multipart_from_csv(csv_data, "headers_only.csv");

        let result = extract_multipart(multipart, true).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 0); // Should return empty when append_data=true
    }

    #[tokio::test]
    async fn test_extract_multipart_empty_payload() {
        let multipart = create_empty_multipart();

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 0);
    }

    #[tokio::test]
    async fn test_extract_multipart_field_without_filename() {
        let multipart = create_multipart_without_filename();

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 0); // Should skip fields without filename
    }

    #[tokio::test]
    async fn test_extract_multipart_malformed_csv() {
        let csv_data = "name,age,city\nJohn,25\nJane,30,Los Angeles,Extra"; // Malformed CSV
        let multipart = create_multipart_from_csv(csv_data, "malformed.csv");

        let result = extract_multipart(multipart, false).await;

        // Should handle malformed CSV gracefully - might return partial data or error
        // The exact behavior depends on the CSV parser, but it shouldn't panic
        match result {
            Ok(records) => {
                // If it succeeds, it should have processed what it could
                // records.len() is always >= 0, so we just verify it's a valid result
                let _ = records.len();
            }
            Err(_) => {
                // If it fails, that's also acceptable for malformed data
            }
        }
    }

    #[tokio::test]
    async fn test_extract_multipart_headers_with_whitespace() {
        let csv_data = " name , age , city \nJohn,25,New York";
        let multipart = create_multipart_from_csv(csv_data, "whitespace.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 1);

        // Headers should be trimmed and formatted
        assert_eq!(
            records[0].get("name"),
            Some(&json::Value::String("John".to_string()))
        );
        assert_eq!(
            records[0].get("age"),
            Some(&json::Value::String("25".to_string()))
        );
        assert_eq!(
            records[0].get("city"),
            Some(&json::Value::String("New York".to_string()))
        );
    }

    #[tokio::test]
    async fn test_extract_multipart_empty_records_included() {
        let csv_data = "name,age,city\nJohn,25,New York\n,,\nJane,30,Los Angeles";
        let multipart = create_multipart_from_csv(csv_data, "with_empty.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        // Should have 3 records (empty record is included)
        assert_eq!(records.len(), 3);

        assert_eq!(
            records[0].get("name"),
            Some(&json::Value::String("John".to_string()))
        );
        assert_eq!(
            records[1].get("name"),
            Some(&json::Value::String("".to_string()))
        ); // Empty record
        assert_eq!(
            records[2].get("name"),
            Some(&json::Value::String("Jane".to_string()))
        );
    }

    #[tokio::test]
    async fn test_extract_multipart_single_column() {
        let csv_data = "id\n1\n2\n3";
        let multipart = create_multipart_from_csv(csv_data, "single_column.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 3);

        for (i, record) in records.iter().enumerate() {
            assert_eq!(
                record.get("id"),
                Some(&json::Value::String((i + 1).to_string()))
            );
        }
    }

    #[tokio::test]
    async fn test_extract_multipart_special_characters() {
        let csv_data = "name,description\n\"John, Jr.\",\"A person with, commas\"\nJane,\"A person with \"\"quotes\"\"\"";
        let multipart = create_multipart_from_csv(csv_data, "special_chars.csv");

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        assert_eq!(records.len(), 2);

        assert_eq!(
            records[0].get("name"),
            Some(&json::Value::String("John, Jr.".to_string()))
        );
        assert_eq!(
            records[0].get("description"),
            Some(&json::Value::String("A person with, commas".to_string()))
        );
        assert_eq!(
            records[1].get("name"),
            Some(&json::Value::String("Jane".to_string()))
        );
        assert_eq!(
            records[1].get("description"),
            Some(&json::Value::String("A person with \"quotes\"".to_string()))
        );
    }

    #[tokio::test]
    async fn test_extract_multipart_multiple_files() {
        let boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
        let mut body = Vec::new();

        // First file
        let csv1 = "id,name\n1,John\n2,Jane";
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file1\"; filename=\"file1.csv\"\r\n",
        );
        body.extend_from_slice(b"Content-Type: text/csv\r\n\r\n");
        body.extend_from_slice(csv1.as_bytes());
        body.extend_from_slice(b"\r\n");

        // Second file
        let csv2 = "id,age\n1,25\n2,30";
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file2\"; filename=\"file2.csv\"\r\n",
        );
        body.extend_from_slice(b"Content-Type: text/csv\r\n\r\n");
        body.extend_from_slice(csv2.as_bytes());
        body.extend_from_slice(b"\r\n");

        // End boundary
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

        let stream = stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(body))]);
        let multer_multipart = multer::Multipart::new(stream, boundary);
        let multipart = unsafe { create_axum_multipart(multer_multipart) };

        let result = extract_multipart(multipart, false).await;

        assert!(result.is_ok());
        let records = result.unwrap();
        // Should process both files and combine all records
        assert_eq!(records.len(), 4); // 2 records from each file

        // Check that we have records from both files
        let has_john = records
            .iter()
            .any(|r| r.get("name") == Some(&json::Value::String("John".to_string())));
        let has_jane = records
            .iter()
            .any(|r| r.get("name") == Some(&json::Value::String("Jane".to_string())));
        let has_age_25 = records
            .iter()
            .any(|r| r.get("age") == Some(&json::Value::String("25".to_string())));
        let has_age_30 = records
            .iter()
            .any(|r| r.get("age") == Some(&json::Value::String("30".to_string())));

        assert!(has_john);
        assert!(has_jane);
        assert!(has_age_25);
        assert!(has_age_30);
    }
}
