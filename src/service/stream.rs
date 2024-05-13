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

use std::io::Error;

use actix_web::{http, http::StatusCode, HttpResponse};
use config::{
    is_local_disk_storage,
    meta::stream::{StreamSettings, StreamStats, StreamType},
    utils::json,
    CONFIG, SIZE_IN_MB, SQL_FULL_TEXT_SEARCH_FIELDS,
};
use datafusion::arrow::datatypes::Schema;
use infra::{
    cache::stats,
    schema::{
        unwrap_partition_time_level, unwrap_stream_settings, STREAM_SCHEMAS,
        STREAM_SCHEMAS_COMPRESSED, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
    },
};

use crate::{
    common::meta::{
        authz::Authz,
        http::HttpResponse as MetaHttpResponse,
        prom,
        stream::{Stream, StreamProperty},
    },
    service::{db, metrics::get_prom_metadata_from_schema},
};

const LOCAL: &str = "disk";
const S3: &str = "s3";

pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<HttpResponse, Error> {
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();

    let mut stats = stats::get_stream_stats(org_id, stream_name, stream_type);
    transform_stats(&mut stats);
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
    permitted_streams: Option<Vec<String>>,
) -> Vec<Stream> {
    let indices = db::schema::list(org_id, stream_type, fetch_schema)
        .await
        .unwrap_or_default();

    let filtered_indices = if let Some(s_type) = stream_type {
        match permitted_streams {
            Some(permitted_streams) => {
                if permitted_streams.contains(&format!("{}:_all_{}", s_type, org_id)) {
                    indices
                } else {
                    indices
                        .into_iter()
                        .filter(|stream_loc| {
                            permitted_streams
                                .contains(&format!("{}:{}", s_type, stream_loc.stream_name))
                        })
                        .collect::<Vec<_>>()
                }
            }
            None => indices,
        }
    } else {
        indices
    };
    let mut indices_res = Vec::with_capacity(filtered_indices.len());
    for stream_loc in filtered_indices {
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
            transform_stats(&mut stats);
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

    let mut settings = unwrap_stream_settings(&schema).unwrap_or_default();
    settings.partition_time_level = Some(unwrap_partition_time_level(
        settings.partition_time_level,
        stream_type,
    ));

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

#[tracing::instrument(skip(settings))]
pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut settings: StreamSettings,
) -> Result<HttpResponse, Error> {
    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("stream [{stream_name}] is being deleted"),
            )),
        );
    }

    for key in settings.partition_keys.iter() {
        if SQL_FULL_TEXT_SEARCH_FIELDS.contains(&key.field) {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("field [{}] can't be used for partition key", key.field),
            )));
        }
    }

    // we need to keep the old partition information, because the hash bucket num can't be changed
    // get old settings and then update partition_keys
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();
    let mut old_partition_keys = unwrap_stream_settings(&schema)
        .unwrap_or_default()
        .partition_keys;
    // first disable all old partition keys
    for v in old_partition_keys.iter_mut() {
        v.disabled = true;
    }
    // then update new partition keys
    for v in settings.partition_keys.iter() {
        if let Some(old_field) = old_partition_keys.iter_mut().find(|k| k.field == v.field) {
            if old_field.types != v.types {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    format!("field [{}] partition types can't be changed", v.field),
                )));
            }
            old_field.disabled = v.disabled;
        } else {
            old_partition_keys.push(v.clone());
        }
    }
    settings.partition_keys = old_partition_keys;

    let mut metadata = schema.metadata.clone();
    metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
    if !metadata.contains_key("created_at") {
        metadata.insert(
            "created_at".to_string(),
            chrono::Utc::now().timestamp_micros().to_string(),
        );
    }
    db::schema::update_setting(org_id, stream_name, stream_type, metadata)
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
    let schema = infra::schema::get_versions(org_id, stream_name, stream_type, None)
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
        db::compact::retention::delete_stream(org_id, stream_type, stream_name, None).await
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

    // delete stream compaction offset
    if let Err(e) = db::compact::files::del_offset(org_id, stream_type, stream_name).await {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR.into(),
                format!("failed to delete stream: {e}"),
            )),
        );
    };

    crate::common::utils::auth::remove_ownership(
        org_id,
        &stream_type.to_string(),
        Authz::new(stream_name),
    )
    .await;

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        StatusCode::OK.into(),
        "stream deleted".to_string(),
    )))
}

fn transform_stats(stats: &mut StreamStats) {
    stats.storage_size /= SIZE_IN_MB;
    stats.compressed_size /= SIZE_IN_MB;
    stats.storage_size = (stats.storage_size * 100.0).round() / 100.0;
    stats.compressed_size = (stats.compressed_size * 100.0).round() / 100.0;
}

pub fn stream_created(schema: &Schema) -> Option<i64> {
    schema
        .metadata()
        .get("created_at")
        .map(|v| v.parse().unwrap())
}

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
    fields: &[String],
) -> Result<(), anyhow::Error> {
    if !CONFIG.common.widening_schema_evolution {
        return Err(anyhow::anyhow!(
            "widening schema evolution is disabled, can't delete fields"
        ));
    }
    if fields.is_empty() {
        return Ok(());
    }
    db::schema::delete_fields(
        org_id,
        stream_name,
        stream_type.unwrap_or_default(),
        fields.to_vec(),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::datatypes::{DataType, Field};

    use super::*;

    #[test]
    fn test_stream_res() {
        let stats = StreamStats::default();
        let schema = Schema::new(vec![Field::new("f.c", DataType::Int32, false)]);
        let res = stream_res("Test", StreamType::Logs, schema, Some(stats));
        assert_eq!(res.stats, stats);
    }
}
