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

use actix_web::{http, http::StatusCode, HttpResponse};
use datafusion::arrow::datatypes::Schema;
use std::io::Error;

use crate::common::infra::config::CONFIG;
use crate::common::infra::{cache::stats, config::STREAM_SCHEMAS};
use crate::common::meta::{
    http::HttpResponse as MetaHttpResponse,
    prom,
    stream::{PartitionTimeLevel, Stream, StreamProperty, StreamSettings, StreamStats},
    StreamType,
};
use crate::common::{json, stream::SQL_FULL_TEXT_SEARCH_FIELDS, utils::is_local_disk_storage};
use crate::service::db;

use super::metrics::get_prom_metadata_from_schema;

const SIZE_IN_MB: f64 = 1024.0 * 1024.0;
const LOCAL: &str = "disk";
const S3: &str = "s3";

#[tracing::instrument]
pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<HttpResponse, Error> {
    let schema = db::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();
    let mut stats = stats::get_stream_stats(org_id, stream_name, stream_type);
    stats = transform_stats(&mut stats);
    if schema != Schema::empty() {
        let stream = stream_res(stream_name, stream_type, schema, Some(stats));
        Ok(HttpResponse::Ok().json(stream))
    } else {
        Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            "stream not found".to_string(),
        )))
    }
}

pub async fn get_streams(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Vec<Stream> {
    let indices = db::schema::list(org_id, stream_type, fetch_schema)
        .await
        .unwrap();
    let mut indices_res = Vec::with_capacity(indices.len());
    for stream_loc in indices {
        let mut stats = stats::get_stream_stats(
            org_id,
            stream_loc.stream_name.as_str(),
            stream_loc.stream_type,
        );
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

pub fn stream_res(
    stream_name: &str,
    stream_type: StreamType,
    schema: Schema,
    stats: Option<StreamStats>,
) -> Stream {
    let storage_type = if is_local_disk_storage() { LOCAL } else { S3 };
    let mappings = schema
        .fields()
        .iter()
        .map(|field| StreamProperty {
            prop_type: field.data_type().to_string(),
            name: field.name().to_string(),
        })
        .collect::<Vec<_>>();

    let mut stats = match stats {
        Some(v) => v,
        None => StreamStats::default(),
    };
    stats.created_at = stream_created(&schema).unwrap_or_default();

    let metrics_meta = if stream_type == StreamType::Metrics {
        let mut meta = get_prom_metadata_from_schema(&schema).unwrap_or(prom::Metadata {
            metric_type: prom::MetricType::Empty,
            metric_family_name: stream_name.to_string(),
            help: stream_name.to_string(),
            unit: "".to_string(),
        });
        if meta.metric_type == prom::MetricType::Empty
            && (stream_name.ends_with("_bucket")
                || stream_name.ends_with("_sum")
                || stream_name.ends_with("_count"))
        {
            meta.metric_type = prom::MetricType::Counter;
        }
        Some(meta)
    } else {
        None
    };

    let mut settings = stream_settings(&schema).unwrap_or_default();
    // special handling for metrics streams
    if settings.partition_time_level.unwrap_or_default() == PartitionTimeLevel::Unset
        && stream_type.eq(&StreamType::Metrics)
    {
        settings.partition_time_level =
            Some(CONFIG.limit.metric_file_max_retention.as_str().into());
    }

    Stream {
        name: stream_name.to_string(),
        storage_type: storage_type.to_string(),
        stream_type,
        schema: mappings,
        stats,
        settings,
        metrics_meta,
    }
}

#[tracing::instrument(skip(setting))]
pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    setting: StreamSettings,
) -> Result<HttpResponse, Error> {
    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_name, stream_type, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("stream [{stream_name}] is being deleted"),
            )),
        );
    }

    for key in setting.partition_keys.iter() {
        if SQL_FULL_TEXT_SEARCH_FIELDS.contains(&key.as_str()) {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("field [{key}] can't be used for partition key"),
            )));
        }
    }

    let schema = db::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();
    let mut metadata = schema.metadata.clone();
    metadata.insert("settings".to_string(), json::to_string(&setting).unwrap());
    if !metadata.contains_key("created_at") {
        metadata.insert(
            "created_at".to_string(),
            chrono::Utc::now().timestamp_micros().to_string(),
        );
    }
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &schema.clone().with_metadata(metadata),
        None,
        false,
    )
    .await
    .unwrap();

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "".to_string(),
    )))
}

#[tracing::instrument]
pub async fn delete_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<HttpResponse, Error> {
    let schema = db::schema::get_versions(org_id, stream_name, stream_type)
        .await
        .unwrap();
    if schema.is_empty() {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            "stream not found".to_string(),
        )));
    }

    // create delete for compactor
    if let Err(e) =
        db::compact::retention::delete_stream(org_id, stream_name, stream_type, None).await
    {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("failed to delete stream: {e}"),
            )),
        );
    }

    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("failed to delete stream: {e}"),
            )),
        );
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STREAM_SCHEMAS.remove(&key);

    // delete stream stats cache
    stats::remove_stream_stats(org_id, stream_name, stream_type);

    // delete stream compaction offset
    if let Err(e) = db::compact::files::del_offset(org_id, stream_name, stream_type).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("failed to delete stream: {e}"),
            )),
        );
    };

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "stream deleted".to_string(),
    )))
}

pub fn get_stream_setting_fts_fields(schema: &Schema) -> Result<Vec<String>, anyhow::Error> {
    match stream_settings(schema) {
        Some(setting) => Ok(setting.full_text_search_keys),
        None => Ok(vec![]),
    }
}

fn transform_stats(stats: &mut StreamStats) -> StreamStats {
    stats.storage_size /= SIZE_IN_MB;
    stats.compressed_size /= SIZE_IN_MB;
    stats.storage_size = (stats.storage_size * 100.0).round() / 100.0;
    stats.compressed_size = (stats.compressed_size * 100.0).round() / 100.0;
    *stats
}

pub fn stream_created(schema: &Schema) -> Option<i64> {
    schema
        .metadata()
        .get("created_at")
        .map(|v| v.parse().unwrap())
}

pub fn stream_settings(schema: &Schema) -> Option<StreamSettings> {
    if schema.metadata().is_empty() {
        return None;
    }
    schema
        .metadata()
        .get("settings")
        .map(|v| StreamSettings::from(v.as_str()))
}

pub fn unwrap_partition_time_level(
    level: Option<PartitionTimeLevel>,
    stream_type: StreamType,
) -> PartitionTimeLevel {
    match level {
        Some(l) => l,
        None => {
            if stream_type == StreamType::Metrics {
                PartitionTimeLevel::from(CONFIG.limit.metric_file_max_retention.as_str())
            } else {
                PartitionTimeLevel::default()
            }
        }
    }
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
