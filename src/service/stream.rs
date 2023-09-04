// Copyright 2023 Zinc Labs Inc.
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
use std::collections::HashMap;
use std::io::Error;

use crate::common::infra::config::{is_local_disk_storage, CONFIG};
use crate::common::infra::{cache::stats, config::STREAM_SCHEMAS};
use crate::common::meta;
use crate::common::meta::usage::Stats;
use crate::common::meta::{
    http::HttpResponse as MetaHttpResponse,
    prom,
    stream::{PartitionTimeLevel, Stream, StreamProperty, StreamSettings, StreamStats},
    StreamType,
};
use crate::common::utils::{json, stream::SQL_FULL_TEXT_SEARCH_FIELDS};
use crate::service::{db, search as SearchService};

use super::metrics::get_prom_metadata_from_schema;

const LOCAL: &str = "disk";
const S3: &str = "s3";
const SIZE_IN_MB: f64 = 1024.0 * 1024.0;

pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<HttpResponse, Error> {
    let schema = db::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();

    let mut stats = if !CONFIG.common.usage_enabled {
        stats::get_stream_stats(org_id, stream_name, stream_type)
    } else {
        let in_stats = get_stream_stats(org_id, Some(stream_type), Some(stream_name.to_string()))
            .await
            .unwrap_or_default();
        match in_stats.is_empty() {
            true => StreamStats::default(),
            false => *in_stats
                .get(format!("{}/{}", stream_name, stream_type).as_str())
                .unwrap(),
        }
    };

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

    // get all steam stats
    let all_stats = if !CONFIG.common.usage_enabled {
        HashMap::new()
    } else {
        get_stream_stats(org_id, stream_type, None)
            .await
            .unwrap_or_default()
    };

    for stream_loc in indices {
        let mut stats = if !CONFIG.common.usage_enabled {
            stats::get_stream_stats(
                org_id,
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
            )
        } else {
            *all_stats
                .get(format!("{}/{}", stream_loc.stream_name, stream_loc.stream_type).as_str())
                .unwrap_or(&StreamStats::default())
        };
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
    if settings.partition_time_level.unwrap_or_default() == PartitionTimeLevel::Unset {
        settings.partition_time_level = Some(unwrap_partition_time_level(
            settings.partition_time_level,
            stream_type,
        ));
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
    if !CONFIG.common.usage_enabled {
        stats.storage_size /= SIZE_IN_MB;
        stats.compressed_size /= SIZE_IN_MB;
    }
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
        None => match stream_type {
            StreamType::Logs => PartitionTimeLevel::from(CONFIG.limit.logs_file_retention.as_str()),
            StreamType::Metrics => {
                PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str())
            }
            StreamType::Traces => {
                PartitionTimeLevel::from(CONFIG.limit.metrics_file_retention.as_str())
            }
            _ => PartitionTimeLevel::default(),
        },
    }
}

async fn get_stream_stats(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<String>,
) -> Result<HashMap<String, StreamStats>, anyhow::Error> {
    let mut sql = if CONFIG.common.usage_report_compressed_size {
        format!("select min(min_ts) as min_ts  , max(max_ts) as max_ts , max(compressed_size) as compressed_size , max(original_size) as original_size , max(records) as records ,stream_name , org_id , stream_type from  \"stats\" where org_id='{org_id}' ")
    } else {
        format!("select min(min_ts) as min_ts  , max(max_ts) as max_ts , max(original_size) as original_size , max(records) as records ,stream_name , org_id , stream_type from  \"stats\" where org_id='{org_id}'")
    };

    sql = match stream_type {
        Some(stream_type) => {
            format!("{sql } and stream_type='{stream_type}' ")
        }
        None => sql,
    };

    sql = match stream_name {
        Some(stream_name) => format!("{sql} and stream_name='{stream_name}' "),
        None => sql,
    };

    // group by stream_name , org_id , stream_type

    let query = meta::search::Query {
        sql: format!("{sql} group by stream_name , org_id , stream_type"),
        sql_mode: "full".to_owned(),
        size: 100000000,
        ..Default::default()
    };

    let req: meta::search::Request = meta::search::Request {
        query,
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    match SearchService::search(&CONFIG.common.usage_org, meta::StreamType::Logs, &req).await {
        Ok(res) => {
            let mut all_stats = HashMap::new();
            for item in res.hits {
                let stats: Stats = json::from_value(item).unwrap();
                all_stats.insert(
                    format!("{}/{}", stats.stream_name, stats.stream_type),
                    stats.into(),
                );
            }
            Ok(all_stats)
        }
        Err(err) => Err(err.into()),
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
