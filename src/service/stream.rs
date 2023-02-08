use actix_web::http;
use actix_web::{http::StatusCode, HttpResponse};
use datafusion::arrow::datatypes::Schema;
use serde_json::Value;
use std::io::Error;
use tracing::info_span;

use crate::common::json;
use crate::common::utils::is_local_disk_storage;
use crate::meta::http::HttpResponse as MetaHttpResponse;
use crate::meta::stream::{ListStream, Stream, StreamProperty, StreamSettings, StreamStats};
use crate::meta::StreamType;
use crate::service::db;

const SIZE_IN_MB: f64 = 1024.0 * 1024.0;
const LOCAL: &str = "disk";
const S3: &str = "s3";

pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:streams:get_stream");
    let _guard = loc_span.enter();
    let schema = db::schema::get(org_id, stream_name, Some(stream_type))
        .await
        .unwrap();
    let mut stats = db::get_stream_stats(org_id, stream_name, &stream_type.to_string())
        .await
        .unwrap();
    stats = transform_stats(&mut stats);
    if schema != Schema::empty() {
        let stream = stream_res(stream_name, stream_type, schema, Some(stats));
        Ok(HttpResponse::Ok().json(stream))
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some("stream not found".to_owned()),
        )))
    }
}

pub async fn list_streams(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:streams:list_streams");
    let _guard = loc_span.enter();
    let indices_res = get_streams(org_id, stream_type, fetch_schema).await;
    Ok(HttpResponse::Ok().json(ListStream { list: indices_res }))
}

pub async fn get_streams(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Vec<Stream> {
    let indices = db::schema::list(org_id, stream_type, fetch_schema)
        .await
        .unwrap();
    let mut indices_res = Vec::new();
    for stream_loc in indices {
        let mut stats = db::get_stream_stats(
            org_id,
            stream_loc.stream_name.as_str(),
            &stream_loc.stream_type.to_string(),
        )
        .await
        .unwrap();
        if stats.eq(&StreamStats::default()) {
            indices_res.push(stream_res(
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
                stream_loc.schema,
                None,
            ));
        } else {
            stats = transform_stats(&mut stats);
            indices_res.push(stream_res(
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
                stream_loc.schema,
                Some(stats),
            ));
        }
    }
    indices_res
}

fn stream_res(
    stream_name: &str,
    stream_type: StreamType,
    schema: Schema,
    stats: Option<StreamStats>,
) -> Stream {
    let fields = schema.fields();
    let mut meta = schema.metadata().clone();
    let mut mappings = Vec::new();
    for field in fields {
        let stream_prop = StreamProperty {
            prop_type: field.data_type().to_string(),
            name: field.name().to_string(),
        };
        mappings.push(stream_prop);
    }
    meta.remove("created_at");
    let mut partition_keys = Vec::new();
    let mut full_text_search_keys = vec![];
    let stream_settings = meta.get("settings");

    if let Some(value) = stream_settings {
        let settings: Value = json::from_slice(value.as_bytes()).unwrap();
        let keys = settings.get("partition_keys");

        if let Some(value) = keys {
            let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
            v.sort_by(|a, b| a.0.cmp(b.0));
            for (_, value) in v {
                partition_keys.push(value.as_str().unwrap().to_string());
            }
        }
        let fts = settings.get("full_text_search_keys");
        if let Some(value) = fts {
            let v: Vec<_> = value.as_array().unwrap().iter().collect();
            for item in v {
                full_text_search_keys.push(item.as_str().unwrap().to_string())
            }
        }
    }

    let storage_type = if is_local_disk_storage() { LOCAL } else { S3 };
    let stats = match stats {
        Some(v) => v,
        None => StreamStats::default(),
    };

    Stream {
        name: stream_name.to_string(),
        stream_type,
        storage_type: storage_type.to_string(),
        schema: mappings,
        stats,
        settings: StreamSettings {
            partition_keys,
            full_text_search_keys,
        },
    }
}

pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    setting: StreamSettings,
) -> Result<HttpResponse, Error> {
    let loc_span = info_span!("service:streams:set_partition_keys");
    let _guard = loc_span.enter();
    let schema = db::schema::get(org_id, stream_name, Some(stream_type))
        .await
        .unwrap();

    let mut meta = schema.metadata.clone();

    meta.insert("settings".to_string(), json::to_string(&setting).unwrap());
    log::info!("Saving setting for schema {:?}", stream_name);
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &schema.clone().with_metadata(meta),
        None,
    )
    .await
    .unwrap();

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "".to_string(),
    )))
}

pub fn get_stream_setting_fts_fields(schema: &Schema) -> Result<Vec<String>, anyhow::Error> {
    let mut full_text_search_keys = vec![];
    let settings = schema.metadata.get("settings");
    if settings.is_none() {
        return Ok(full_text_search_keys);
    }
    let settings = settings.unwrap();
    let settings: Value = json::from_slice(settings.as_bytes()).unwrap();
    let fts = settings.get("full_text_search_keys");
    if fts.is_none() {
        return Ok(full_text_search_keys);
    }
    let v: Vec<_> = fts.unwrap().as_array().unwrap().iter().collect();
    for item in v {
        full_text_search_keys.push(item.as_str().unwrap().to_string())
    }
    Ok(full_text_search_keys)
}

fn transform_stats(stats: &mut StreamStats) -> StreamStats {
    stats.storage_size /= SIZE_IN_MB;
    stats.compressed_size /= SIZE_IN_MB;
    stats.storage_size = (stats.storage_size * 100.0).round() / 100.0;
    stats.compressed_size = (stats.compressed_size * 100.0).round() / 100.0;
    *stats
}

#[cfg(test)]
mod test {
    use super::*;
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    #[test]
    fn test_transform_stats() {
        let mut stats = StreamStats::default();
        let res = transform_stats(&mut stats);
        assert_eq!(stats, res);
    }
    #[test]
    fn test_stream_res() {
        let stats = StreamStats::default();
        let schema = Schema::new(vec![Field::new("f.c", DataType::Int32, false)]);
        let res = stream_res("Test", StreamType::Logs, schema, Some(stats));
        assert_eq!(res.stats, stats);
    }
    #[test]
    fn test_get_stream_setting_fts_fields() {
        let sch = Schema::new(vec![Field::new("f.c", DataType::Int32, false)]);
        let res = get_stream_setting_fts_fields(&sch);
        assert!(res.is_ok());
    }
}
