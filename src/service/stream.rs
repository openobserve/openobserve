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

use std::io::Error;

use actix_web::{HttpResponse, http, http::StatusCode};
use config::{
    SIZE_IN_MB, SQL_FULL_TEXT_SEARCH_FIELDS, TIMESTAMP_COL_NAME, get_config, is_local_disk_storage,
    meta::{
        promql,
        stream::{
            DistinctField, StreamField, StreamParams, StreamSettings, StreamStats, StreamType,
            UpdateStreamSettings,
        },
    },
    utils::{flatten::format_label_name, json, time::now_micros},
};
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::stats,
    schema::{
        STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
        get_stream_setting_fts_fields, unwrap_partition_time_level, unwrap_stream_created_at,
        unwrap_stream_is_derived, unwrap_stream_settings,
    },
    table::distinct_values::{DistinctFieldRecord, OriginType, check_field_use},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::re_patterns::PATTERN_MANAGER;

use super::db::enrichment_table;
#[cfg(feature = "enterprise")]
use crate::service::db::re_pattern::process_association_changes;
use crate::{
    common::meta::{
        authz::Authz,
        http::HttpResponse as MetaHttpResponse,
        stream::{FieldUpdate, Stream, StreamCreate},
    },
    handler::http::router::ERROR_HEADER,
    service::{
        db::{self, distinct_values},
        metrics::get_prom_metadata_from_schema,
    },
};

const LOCAL: &str = "disk";
const S3: &str = "s3";

pub async fn get_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Option<Stream> {
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .unwrap();

    if schema != Schema::empty() {
        let mut stats = stats::get_stream_stats(org_id, stream_name, stream_type);
        transform_stats(&mut stats, org_id, stream_name, stream_type).await;
        Some(stream_res(
            org_id,
            stream_name,
            stream_type,
            schema,
            Some(stats),
        ))
    } else {
        None
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
        let s_type = match s_type {
            StreamType::EnrichmentTables => "enrichment_table",
            _ => s_type.as_str(),
        };
        match permitted_streams {
            Some(permitted_streams) => {
                if permitted_streams.contains(&format!("{s_type}:_all_{org_id}")) {
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
        if stats.eq(&StreamStats::default())
            && stream_loc.stream_type != StreamType::EnrichmentTables
        {
            indices_res.push(stream_res(
                org_id,
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
                stream_loc.schema,
                None,
            ));
        } else {
            transform_stats(
                &mut stats,
                org_id,
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
            )
            .await;
            indices_res.push(stream_res(
                org_id,
                stream_loc.stream_name.as_str(),
                stream_loc.stream_type,
                stream_loc.schema,
                Some(stats),
            ));
        }
    }
    indices_res
}

// org_id is only for pattern associations, which is ent only
pub fn stream_res(
    _org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: Schema,
    stats: Option<StreamStats>,
) -> Stream {
    let storage_type = if is_local_disk_storage() { LOCAL } else { S3 };
    let mappings = schema
        .fields()
        .iter()
        .map(|field| StreamField {
            r#type: field.data_type().to_string(),
            name: field.name().to_string(),
        })
        .collect::<Vec<_>>();

    let mut stats = stats.unwrap_or_default();
    stats.created_at = unwrap_stream_created_at(&schema).unwrap_or_default();

    let metrics_meta = if stream_type == StreamType::Metrics {
        let mut meta = get_prom_metadata_from_schema(&schema).unwrap_or(promql::Metadata {
            metric_type: promql::MetricType::Empty,
            metric_family_name: stream_name.to_string(),
            help: stream_name.to_string(),
            unit: "".to_string(),
        });
        if meta.metric_type == promql::MetricType::Empty
            && (stream_name.ends_with("_bucket")
                || stream_name.ends_with("_sum")
                || stream_name.ends_with("_count"))
        {
            meta.metric_type = promql::MetricType::Counter;
        }
        Some(meta)
    } else {
        None
    };

    let mut settings = unwrap_stream_settings(&schema).unwrap_or_default();
    if settings == StreamSettings::default() {
        settings.approx_partition = get_config()
            .common
            .use_stream_settings_for_partitions_enabled;
    }

    settings.partition_time_level = Some(unwrap_partition_time_level(
        settings.partition_time_level,
        stream_type,
    ));

    #[cfg(not(feature = "enterprise"))]
    let pattern_associations = vec![];
    // because this fn cannot be async, we cannot await on initializing the pattern
    // manager. So instead we do it in best-effort-way, where if it is already initialized,
    // we get the patterns, otherwise report them as empty
    #[cfg(feature = "enterprise")]
    let pattern_associations = match PATTERN_MANAGER.get() {
        Some(m) => m.get_associations(_org_id, stream_type, stream_name),
        None => vec![],
    };
    let is_derived = unwrap_stream_is_derived(&schema);

    Stream {
        name: stream_name.to_string(),
        storage_type: storage_type.to_string(),
        stream_type,
        total_fields: mappings.len(),
        schema: mappings,
        uds_schema: vec![],
        stats,
        settings,
        metrics_meta,
        pattern_associations,
        is_derived,
    }
}

pub async fn create_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut stream: StreamCreate,
) -> Result<HttpResponse, Error> {
    // check if the stream already exists
    let schema = match infra::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(e) => {
            return Ok(HttpResponse::InternalServerError()
                .append_header((ERROR_HEADER, format!("error in getting schema: {e}")))
                .json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("error in getting schema: {e}"),
                )));
        }
    };
    if !schema.fields().is_empty() {
        return Ok(HttpResponse::BadRequest()
            .append_header((ERROR_HEADER, "stream already exists"))
            .json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "stream already exists",
            )));
    }

    // create the stream
    let mut fields = Vec::with_capacity(stream.fields.len() + 1);
    let schema = std::mem::take(&mut stream.fields);
    let mut has_timestamp = false;
    for f in schema {
        let Ok(data_type) = f.r#type.parse::<DataType>() else {
            return Ok(HttpResponse::BadRequest()
                .append_header((ERROR_HEADER, format!("invalid data type: {}", f.r#type)))
                .json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST,
                    format!("invalid data type: {}", f.r#type),
                )));
        };
        let name = format_label_name(&f.name);
        if name == TIMESTAMP_COL_NAME {
            has_timestamp = true;
        }
        fields.push(arrow_schema::Field::new(name, data_type, true));
    }
    // add timestamp field if not exists
    if !has_timestamp {
        fields.push(arrow_schema::Field::new(
            TIMESTAMP_COL_NAME,
            DataType::Int64,
            false,
        ));
    }
    let schema = Schema::new(fields);
    let min_ts = now_micros();
    let new_schema =
        match infra::schema::merge(org_id, stream_name, stream_type, &schema, Some(min_ts)).await {
            Ok(Some((s, _))) => s,
            Ok(None) => {
                return Ok(HttpResponse::InternalServerError()
                    .append_header((
                        ERROR_HEADER,
                        "error in creating stream: created schema is empty",
                    ))
                    .json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        "error in creating stream: created schema is empty",
                    )));
            }
            Err(e) => {
                return Ok(HttpResponse::InternalServerError()
                    .append_header((ERROR_HEADER, format!("error in creating stream: {e}")))
                    .json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("error in creating stream: {e}"),
                    )));
            }
        };

    // check if UDS is enabled, then need add the fields to UDS
    let cfg = get_config();
    if cfg.common.allow_user_defined_schemas {
        stream.settings.defined_schema_fields.extend(
            new_schema
                .fields()
                .iter()
                .filter_map(|f| {
                    if f.name() == TIMESTAMP_COL_NAME {
                        None
                    } else {
                        Some(f.name().to_string())
                    }
                })
                .collect::<Vec<_>>(),
        );
    }
    stream.settings.defined_schema_fields.sort();
    stream.settings.defined_schema_fields.dedup();

    // create the stream settings
    let resp = save_stream_settings(org_id, stream_name, stream_type, stream.settings).await?;
    if resp.status() == http::StatusCode::OK {
        Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK,
            "stream created",
        )))
    } else {
        Ok(resp)
    }
}

#[tracing::instrument(skip(settings))]
pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut settings: StreamSettings,
) -> Result<HttpResponse, Error> {
    let cfg = config::get_config();
    // check if we are allowed to ingest
    if db::compact::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
        return Ok(HttpResponse::BadRequest()
            .append_header((
                ERROR_HEADER,
                format!("stream [{stream_name}] is being deleted"),
            ))
            .json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("stream [{stream_name}] is being deleted"),
            )));
    }

    // only allow setting user defined schema for logs stream
    if stream_type != StreamType::Logs && !settings.defined_schema_fields.is_empty() {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "only logs stream can have user defined schema",
        )));
    }

    // _all field can't setting for inverted index & index field
    for key in settings.full_text_search_keys.iter() {
        if key == &cfg.common.column_all {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("field [{key}] can't be used for full text search"),
            )));
        }
    }
    for key in settings.index_fields.iter() {
        if key == &cfg.common.column_all {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("field [{key}] can't be used for secondary index"),
            )));
        }
    }

    for key in settings.partition_keys.iter() {
        if SQL_FULL_TEXT_SEARCH_FIELDS.contains(&key.field) || key.field == cfg.common.column_all {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("field [{}] can't be used for partition key", key.field),
            )));
        }
    }

    // get schema
    let schema = match infra::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(e) => {
            return Ok(HttpResponse::InternalServerError()
                .append_header((ERROR_HEADER, format!("error in getting schema : {e}")))
                .json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("error in getting schema : {e}"),
                )));
        }
    };
    let schema_fields = schema
        .fields()
        .iter()
        .map(|f| (f.name(), f))
        .collect::<HashMap<_, _>>();

    // check the full text search keys must be text field
    for key in settings.full_text_search_keys.iter() {
        let Some(field) = schema_fields.get(key) else {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("field [{key}] not found in schema"),
            )));
        };
        if field.data_type() != &DataType::Utf8 && field.data_type() != &DataType::LargeUtf8 {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("full text search field [{key}] must be text field"),
            )));
        }
    }

    // we need to keep the old partition information, because the hash bucket num can't be changed
    // get old settings and then update partition_keys
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
                    http::StatusCode::BAD_REQUEST,
                    format!("field [{}] partition types can't be changed", v.field),
                )));
            }
            old_field.disabled = v.disabled;
        } else {
            old_partition_keys.push(v.clone());
        }
    }
    settings.partition_keys = old_partition_keys;

    for range in settings.extended_retention_days.iter() {
        if range.start > range.end {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "start day should be less than end day",
            )));
        }
    }

    let mut metadata = schema.metadata.clone();
    metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
    if !metadata.contains_key("created_at") {
        metadata.insert("created_at".to_string(), now_micros().to_string());
    }
    db::schema::update_setting(org_id, stream_name, stream_type, metadata)
        .await
        .unwrap();

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(http::StatusCode::OK, "")))
}

#[tracing::instrument(skip(new_settings))]
pub async fn update_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut new_settings: UpdateStreamSettings,
) -> Result<HttpResponse, Error> {
    let Ok(mut schema) = infra::schema::get(org_id, stream_name, stream_type).await else {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND,
            "stream not found",
        )));
    };
    let Some(mut settings) = infra::schema::get_settings(org_id, stream_name, stream_type).await
    else {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND,
            "stream not found",
        )));
    };

    // process new fields first
    let new_fields = std::mem::take(&mut new_settings.fields);
    if !new_fields.add.is_empty() {
        // create new schema and then merge to the existing schema
        let mut fields = Vec::with_capacity(new_fields.add.len());
        for f in new_fields.add {
            let Ok(data_type) = f.r#type.parse::<DataType>() else {
                return Err(Error::other(format!("invalid data type: {}", f.r#type)));
            };
            let name = format_label_name(&f.name);
            fields.push(arrow_schema::Field::new(name, data_type, true));
        }
        let new_schema = Schema::new(fields);
        schema =
            match infra::schema::merge(org_id, stream_name, stream_type, &new_schema, None).await {
                Ok(Some((s, _))) => s,
                Ok(None) => {
                    return Err(Error::other(
                        "error in update stream settings: update schema is empty".to_string(),
                    ));
                }
                Err(e) => {
                    return Err(Error::other(format!(
                        "error in update stream settings: {e}"
                    )));
                }
            };
    }

    let cfg = config::get_config();
    if let Some(max_query_range) = new_settings.max_query_range {
        settings.max_query_range = max_query_range;
    }
    if let Some(store_original_data) = new_settings.store_original_data {
        settings.store_original_data = store_original_data;
    }
    if let Some(approx_partition) = new_settings.approx_partition {
        settings.approx_partition = approx_partition;
    }

    if let Some(flatten_level) = new_settings.flatten_level {
        settings.flatten_level = Some(flatten_level);
    }

    if let Some(data_retention) = new_settings.data_retention {
        settings.data_retention = data_retention;
    }

    if let Some(index_original_data) = new_settings.index_original_data {
        settings.index_original_data = index_original_data;
    }

    if let Some(index_all_values) = new_settings.index_all_values {
        settings.index_all_values = index_all_values;
    }

    // if index_original_data is true, store_original_data must be true
    if settings.index_original_data {
        settings.store_original_data = true;
    }

    // index_original_data & index_all_values only can open one at a time
    if settings.index_original_data && settings.index_all_values {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            "index_original_data & index_all_values cannot be true at the same time",
        )));
    }

    // check for user defined schema
    if !new_settings.defined_schema_fields.add.is_empty() {
        if !cfg.common.allow_user_defined_schemas {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST,
                        "user defined schema is not allowed, you need to set ZO_ALLOW_USER_DEFINED_SCHEMAS=true",
                    )));
        }
        settings
            .defined_schema_fields
            .extend(new_settings.defined_schema_fields.add);
        settings.defined_schema_fields.sort();
        settings.defined_schema_fields.dedup();
        // remove the fields that are not in the new schema
        let schema_fields = schema
            .fields()
            .iter()
            .map(|f| f.name())
            .collect::<HashSet<_>>();
        settings
            .defined_schema_fields
            .retain(|field| schema_fields.contains(field));
    }
    if !new_settings.defined_schema_fields.remove.is_empty() {
        settings
            .defined_schema_fields
            .retain(|field| !new_settings.defined_schema_fields.remove.contains(field));
    }
    if settings.defined_schema_fields.len() > cfg.limit.user_defined_schema_max_fields {
        return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
            http::StatusCode::BAD_REQUEST,
            format!(
                "user defined schema fields count exceeds the limit: {}",
                cfg.limit.user_defined_schema_max_fields
            ),
        )));
    }

    // check for bloom filter fields
    if !new_settings.bloom_filter_fields.add.is_empty() {
        settings
            .bloom_filter_fields
            .extend(new_settings.bloom_filter_fields.add);
    }
    if !new_settings.bloom_filter_fields.remove.is_empty() {
        settings
            .bloom_filter_fields
            .retain(|field| !new_settings.bloom_filter_fields.remove.contains(field));
    }

    // check for index fields
    if !new_settings.index_fields.add.is_empty() {
        settings.index_fields.extend(new_settings.index_fields.add);
        settings.index_updated_at = now_micros();
    }
    if !new_settings.index_fields.remove.is_empty() {
        settings
            .index_fields
            .retain(|field| !new_settings.index_fields.remove.contains(field));
    }

    if !new_settings.extended_retention_days.add.is_empty() {
        settings
            .extended_retention_days
            .extend(new_settings.extended_retention_days.add);
    }

    if !new_settings.extended_retention_days.remove.is_empty() {
        settings
            .extended_retention_days
            .retain(|range| !new_settings.extended_retention_days.remove.contains(range));
    }

    let _fts = get_stream_setting_fts_fields(&Some(settings.clone()));

    if !new_settings.distinct_value_fields.add.is_empty() {
        for f in &new_settings.distinct_value_fields.add {
            if f == "count" || f == TIMESTAMP_COL_NAME {
                return Ok(
                    HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                        http::StatusCode::BAD_REQUEST,
                        format!(
                            "count and {TIMESTAMP_COL_NAME} are reserved fields and cannot be added"
                        ),
                    )),
                );
            }
            // we ignore full text search fields
            if _fts.contains(f) || new_settings.full_text_search_keys.add.contains(f) {
                continue;
            }
            let record = DistinctFieldRecord::new(
                OriginType::Stream,
                stream_name,
                org_id,
                stream_name,
                stream_type.to_string(),
                f,
            );
            if let Err(e) = distinct_values::add(record).await {
                return Ok(HttpResponse::InternalServerError()
                    .append_header((ERROR_HEADER, format!("error in updating settings : {e}")))
                    .json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("error in updating settings : {e}"),
                    )));
            }
            // we cannot allow duplicate entries here
            let temp = DistinctField {
                name: f.to_owned(),
                added_ts: now_micros(),
            };
            if !settings.distinct_value_fields.contains(&temp) {
                settings.distinct_value_fields.push(temp);
            }
        }
    }

    if !new_settings.distinct_value_fields.remove.is_empty() {
        for f in &new_settings.distinct_value_fields.remove {
            let usage = match check_field_use(org_id, stream_name, stream_type.as_str(), f).await {
                Ok(entry) => entry,
                Err(e) => {
                    return Ok(HttpResponse::InternalServerError()
                        .append_header((ERROR_HEADER, format!("error in updating settings : {e}")))
                        .json(MetaHttpResponse::error(
                            http::StatusCode::INTERNAL_SERVER_ERROR,
                            format!("error in updating settings : {e}"),
                        )));
                }
            };
            // if there are multiple uses, we cannot allow it to be removed
            if usage.len() > 1 {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST,
                    format!(
                        "error in removing distinct field : field {f} if used in dashboards/reports"
                    ),
                )));
            }
            // here we can be sure that usage is at most 1 record
            if let Some(entry) = usage.first()
                && entry.origin != OriginType::Stream
            {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST,
                    format!(
                        "error in removing distinct field : field {f} if used in dashboards/reports"
                    ),
                )));
            }
        }
        // here we are sure that all fields to be removed can be removed,
        // so we bulk filter
        settings.distinct_value_fields.retain(|field| {
            !new_settings
                .distinct_value_fields
                .remove
                .contains(&field.name)
        });
    }

    if let Some(enable_distinct_fields) = new_settings.enable_distinct_fields {
        // Only reset timestamps when transitioning from disabled to enabled
        let was_enabled = settings.enable_distinct_fields;
        settings.enable_distinct_fields = enable_distinct_fields;
        if !was_enabled && enable_distinct_fields {
            let current_time = now_micros();
            settings.distinct_value_fields.iter_mut().for_each(|f| {
                f.added_ts = current_time;
            });
            log::info!(
                "Re-enabling distinct fields for stream {}/{}/{}. Resetting timestamps for {:?} fields.",
                org_id,
                stream_type,
                stream_name,
                settings.distinct_value_fields
            );
        }
    }

    if let Some(enable_log_patterns_extraction) = new_settings.enable_log_patterns_extraction {
        settings.enable_log_patterns_extraction = enable_log_patterns_extraction;
    }

    if !new_settings.full_text_search_keys.add.is_empty() {
        settings
            .full_text_search_keys
            .extend(new_settings.full_text_search_keys.add);
        settings.index_updated_at = now_micros();
    }

    if !new_settings.full_text_search_keys.remove.is_empty() {
        settings
            .full_text_search_keys
            .retain(|field| !new_settings.full_text_search_keys.remove.contains(field));
    }

    if !new_settings.partition_keys.add.is_empty() {
        settings
            .partition_keys
            .extend(new_settings.partition_keys.add);
    }

    if !new_settings.partition_keys.remove.is_empty() {
        settings
            .partition_keys
            .retain(|field| !new_settings.partition_keys.remove.contains(field));
    }

    if let Some(partition_time_level) = new_settings.partition_time_level {
        settings.partition_time_level = Some(partition_time_level);
    }

    #[cfg(feature = "enterprise")]
    {
        if let Err(e) = process_association_changes(
            org_id,
            stream_name,
            stream_type,
            new_settings.pattern_associations,
        )
        .await
        {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal server error while updating pattern associations {e}",),
                )),
            );
        }
    }

    save_stream_settings(org_id, stream_name, stream_type, settings).await
}

#[tracing::instrument]
pub async fn delete_stream(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    del_related_feature_resources: bool,
) -> Result<HttpResponse, Error> {
    let schema = infra::schema::get_versions(org_id, stream_name, stream_type, None)
        .await
        .unwrap();
    if schema.is_empty() {
        return Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND,
            "stream not found",
        )));
    }

    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        return Ok(HttpResponse::InternalServerError()
            .append_header((ERROR_HEADER, format!("failed to delete stream schema: {e}")))
            .json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream schema: {e}"),
            )));
    }

    // delete associated feature resources, i.e. pipelines, alerts
    if del_related_feature_resources {
        if let Some(pipeline) =
            db::pipeline::get_by_stream(&StreamParams::new(org_id, stream_name, stream_type)).await
            && let Err(e) = db::pipeline::delete(&pipeline.id).await
        {
            return Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!(
                        "Error: failed to delete the associated pipeline \"{}\": {e}",
                        pipeline.name
                    ),
                )),
            );
        }

        if let Ok(alerts) =
            db::alerts::alert::list(org_id, Some(stream_type), Some(stream_name)).await
        {
            for alert in alerts {
                if let Err(e) =
                    db::alerts::alert::delete_by_name(org_id, stream_type, stream_name, &alert.name)
                        .await
                {
                    return Ok(
                        HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!(
                                "Error: failed to delete the associated alert \"{}\": {e}",
                                alert.name
                            ),
                        )),
                    );
                }
            }
        }
    }

    // create delete for compactor
    if let Err(e) =
        db::compact::retention::delete_stream(org_id, stream_type, stream_name, None).await
    {
        log::error!(
            "Failed to create retention job for stream: {org_id}/{stream_type}/{stream_name}, error: {e}"
        );
        return Ok(HttpResponse::InternalServerError()
            .append_header((ERROR_HEADER, format!("failed to delete stream: {e}")))
            .json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream: {e}"),
            )));
    }

    // delete related resource
    if let Err(e) = stream_delete_inner(org_id, stream_type, stream_name).await {
        return Ok(HttpResponse::InternalServerError()
            .append_header((ERROR_HEADER, format!("failed to delete stream: {e}")))
            .json(MetaHttpResponse::error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream: {e}"),
            )));
    }

    // enrichment table cleanup

    if stream_type == StreamType::EnrichmentTables {
        crate::service::enrichment_table::cleanup_enrichment_table_resources(
            org_id,
            stream_name,
            stream_type,
        )
        .await;
    }

    // delete ownership
    crate::common::utils::auth::remove_ownership(
        org_id,
        stream_type.as_str(),
        Authz::new(stream_name),
    )
    .await;

    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(StatusCode::OK, "stream deleted")))
}

pub async fn stream_delete_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        use super::db::re_pattern::remove_stream_associations_after_deletion;
        remove_stream_associations_after_deletion(org_id, stream_name, stream_type).await?;
    }

    // delete stream schema cache
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    log::warn!("Deleting schema cache for key: {key}");
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

    // delete stream record id generator cache
    {
        STREAM_RECORD_ID_GENERATOR.remove(&key);
    }

    // delete stream compaction offset
    if let Err(e) = db::compact::files::del_offset(org_id, stream_type, stream_name).await {
        log::error!(
            "Failed to delete stream compact offset for stream: {org_id}/{stream_type}/{stream_name}, error: {e}"
        );
        return Err(e);
    }

    Ok(())
}

async fn transform_stats(
    stats: &mut StreamStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) {
    stats.storage_size /= SIZE_IN_MB;
    stats.compressed_size /= SIZE_IN_MB;
    stats.index_size /= SIZE_IN_MB;
    if stream_type == StreamType::EnrichmentTables
        && let Some(meta) = enrichment_table::get_meta_table_stats(org_id, stream_name).await
    {
        stats.doc_time_min = meta.start_time;
        stats.doc_time_max = meta.end_time;
    }
}

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
    fields: &[String],
) -> Result<(), anyhow::Error> {
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

pub fn parse_data_type(s: &str) -> Option<DataType> {
    use DataType::*;
    match s.to_lowercase().as_str() {
        "utf8" => Some(Utf8),
        "largeutf8" | "large_utf8" => Some(LargeUtf8),
        "bool" | "boolean" => Some(Boolean),
        "int64" => Some(Int64),
        "uint64" => Some(UInt64),
        "float64" => Some(Float64),
        _ => None,
    }
}

pub async fn update_fields_type(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
    field_updates: &[FieldUpdate],
) -> Result<(), anyhow::Error> {
    if field_updates.is_empty() {
        return Ok(());
    }

    // Build HashMap of field_name -> (DataType, nullable)
    let mut updates = HashMap::with_capacity(field_updates.len());
    for field_update in field_updates {
        let dt = parse_data_type(&field_update.data_type).ok_or_else(|| {
            anyhow::anyhow!(format!(
                "Unsupported data_type '{}' for field '{}'",
                field_update.data_type, field_update.name
            ))
        })?;
        updates.insert(field_update.name.clone(), (dt, field_update.nullable));
    }

    // create a new schema with updated field types
    let new_schema = Schema::new(
        updates
            .into_iter()
            .map(|(name, (data_type, nullable))| {
                Field::new(name, data_type.clone(), nullable.unwrap_or(true))
            })
            .collect::<Vec<_>>(),
    );

    // update schema in db
    let min_ts = now_micros();
    let mut schema_map = std::collections::HashMap::new();
    super::schema::handle_diff_schema(
        org_id,
        stream_name,
        stream_type.unwrap_or_default(),
        false,
        &new_schema,
        min_ts,
        &mut schema_map,
        false,
    )
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use datafusion::arrow::datatypes::{DataType, Field};

    use super::*;

    #[test]
    fn test_stream_res() {
        let stats = StreamStats::default();
        let schema = Schema::new(vec![Field::new("f.c", DataType::Int32, false)]);
        let res = stream_res(
            "default",
            "Test",
            StreamType::Logs,
            schema,
            Some(stats.clone()),
        );
        assert_eq!(res.stats, stats);
    }

    #[test]
    fn test_stream_res_different_types() {
        let schema = Schema::new(vec![
            Field::new("timestamp", DataType::Int64, false),
            Field::new("message", DataType::Utf8, true),
            Field::new("level", DataType::Utf8, true),
        ]);

        // Test Logs stream
        let logs_stream = stream_res("org1", "app-logs", StreamType::Logs, schema.clone(), None);
        assert_eq!(logs_stream.name, "app-logs");
        assert_eq!(logs_stream.stream_type, StreamType::Logs);
        assert_eq!(logs_stream.total_fields, 3);

        // Test Metrics stream
        let metrics_stream = stream_res(
            "org1",
            "cpu_usage",
            StreamType::Metrics,
            schema.clone(),
            None,
        );
        assert_eq!(metrics_stream.stream_type, StreamType::Metrics);
        assert!(metrics_stream.metrics_meta.is_some());

        // Test EnrichmentTables stream
        let enrichment_stream = stream_res(
            "org1",
            "user_data",
            StreamType::EnrichmentTables,
            schema.clone(),
            None,
        );
        assert_eq!(enrichment_stream.stream_type, StreamType::EnrichmentTables);
    }

    #[test]
    fn test_stream_res_with_storage_type() {
        let schema = Schema::new(vec![Field::new("data", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // Storage type should be based on configuration
        assert!(stream.storage_type == LOCAL || stream.storage_type == S3);
    }

    #[test]
    fn test_stream_res_with_metrics_suffixes() {
        let schema = Schema::new(vec![Field::new("value", DataType::Float64, false)]);

        // Test _bucket suffix
        let bucket_stream = stream_res(
            "org1",
            "http_requests_bucket",
            StreamType::Metrics,
            schema.clone(),
            None,
        );
        if let Some(meta) = bucket_stream.metrics_meta {
            assert_eq!(meta.metric_type, config::meta::promql::MetricType::Counter);
        }

        // Test _sum suffix
        let sum_stream = stream_res(
            "org1",
            "http_duration_sum",
            StreamType::Metrics,
            schema.clone(),
            None,
        );
        if let Some(meta) = sum_stream.metrics_meta {
            assert_eq!(meta.metric_type, config::meta::promql::MetricType::Counter);
        }

        // Test _count suffix
        let count_stream = stream_res(
            "org1",
            "http_requests_count",
            StreamType::Metrics,
            schema,
            None,
        );
        if let Some(meta) = count_stream.metrics_meta {
            assert_eq!(meta.metric_type, config::meta::promql::MetricType::Counter);
        }
    }

    #[test]
    fn test_stream_res_with_stats() {
        let stats = StreamStats {
            doc_num: 1000,
            storage_size: 5000000.0,    // 5MB
            compressed_size: 2500000.0, // 2.5MB
            ..Default::default()
        };

        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res(
            "org1",
            "test",
            StreamType::Logs,
            schema,
            Some(stats.clone()),
        );

        assert_eq!(stream.stats.doc_num, 1000);
        assert_eq!(stream.stats.storage_size, 5000000.0);
    }

    #[test]
    fn test_stream_res_schema_mapping() {
        let schema = Schema::new(vec![
            Field::new("string_field", DataType::Utf8, true),
            Field::new("int_field", DataType::Int64, false),
            Field::new("float_field", DataType::Float64, true),
            Field::new("bool_field", DataType::Boolean, false),
        ]);

        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        assert_eq!(stream.schema.len(), 4);

        let string_field = &stream.schema[0];
        assert_eq!(string_field.name, "string_field");
        assert_eq!(string_field.r#type, "Utf8");

        let int_field = &stream.schema[1];
        assert_eq!(int_field.name, "int_field");
        assert_eq!(int_field.r#type, "Int64");
    }

    #[tokio::test]
    async fn test_transform_stats() {
        let mut stats = StreamStats {
            storage_size: 10.0 * 1024.0 * 1024.0,   // 10MB in bytes
            compressed_size: 5.0 * 1024.0 * 1024.0, // 5MB in bytes
            index_size: 2.0 * 1024.0 * 1024.0,      // 2MB in bytes
            ..Default::default()
        };

        transform_stats(&mut stats, "org1", "test", StreamType::Logs).await;

        // Sizes should be converted from bytes to MB
        assert_eq!(stats.storage_size, 10.0);
        assert_eq!(stats.compressed_size, 5.0);
        assert_eq!(stats.index_size, 2.0);
    }

    #[tokio::test]
    async fn test_transform_stats_enrichment_table() {
        let mut stats = StreamStats {
            storage_size: 1024.0 * 1024.0, // 1MB
            ..Default::default()
        };

        transform_stats(&mut stats, "org1", "test", StreamType::EnrichmentTables).await;

        assert_eq!(stats.storage_size, 1.0);
    }

    #[tokio::test]
    async fn test_delete_fields_empty() {
        let result = delete_fields("org1", "stream1", Some(StreamType::Logs), &[]).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_stream_res_pattern_associations() {
        let schema = Schema::new(vec![Field::new("message", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // Pattern associations should be empty in non-enterprise mode or when not initialized
        assert!(stream.pattern_associations.is_empty());
    }

    #[test]
    fn test_stream_res_with_settings_metadata() {
        let mut metadata = HashMap::new();
        let settings = StreamSettings {
            full_text_search_keys: vec!["message".to_string()],
            index_fields: vec!["level".to_string()],
            data_retention: 365,
            max_query_range: 3600,
            ..Default::default()
        };
        metadata.insert(
            "settings".to_string(),
            serde_json::to_string(&settings).unwrap(),
        );
        metadata.insert("created_at".to_string(), "1640995200000000".to_string());

        let schema =
            Schema::new_with_metadata(vec![Field::new("message", DataType::Utf8, true)], metadata);

        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        assert_eq!(stream.settings.data_retention, 365);
        assert_eq!(stream.settings.max_query_range, 3600);
        assert!(
            stream
                .settings
                .full_text_search_keys
                .contains(&"message".to_string())
        );
    }

    #[test]
    fn test_stream_res_default_settings() {
        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // Should have default settings when no metadata is provided
        let default_settings = StreamSettings::default();
        assert_eq!(
            stream.settings.data_retention,
            default_settings.data_retention
        );
    }

    #[test]
    fn test_stream_res_is_derived_flag() {
        let mut metadata = HashMap::new();
        metadata.insert("is_derived".to_string(), "true".to_string());

        let schema =
            Schema::new_with_metadata(vec![Field::new("field1", DataType::Utf8, true)], metadata);

        let stream = stream_res("org1", "derived_stream", StreamType::Logs, schema, None);
        assert_eq!(stream.is_derived, Some(true));
    }

    #[test]
    fn test_stream_res_partition_time_level() {
        let settings = StreamSettings {
            partition_time_level: Some(config::meta::stream::PartitionTimeLevel::Hourly),
            ..Default::default()
        };

        let mut metadata = HashMap::new();
        metadata.insert(
            "settings".to_string(),
            serde_json::to_string(&settings).unwrap(),
        );

        let schema =
            Schema::new_with_metadata(vec![Field::new("field1", DataType::Utf8, true)], metadata);

        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);
        assert!(stream.settings.partition_time_level.is_some());
    }

    #[test]
    fn test_stream_field_mapping_types() {
        let schema = Schema::new(vec![
            Field::new("binary_field", DataType::Binary, true),
            Field::new("date32_field", DataType::Date32, true),
            Field::new(
                "timestamp_micros",
                DataType::Timestamp(arrow_schema::TimeUnit::Microsecond, None),
                false,
            ),
            Field::new(
                "list_field",
                DataType::List(std::sync::Arc::new(Field::new(
                    "item",
                    DataType::Utf8,
                    true,
                ))),
                true,
            ),
        ]);

        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        assert_eq!(stream.schema.len(), 4);

        // Check that all data types are properly converted to strings
        let binary_field = stream
            .schema
            .iter()
            .find(|f| f.name == "binary_field")
            .unwrap();
        assert_eq!(binary_field.r#type, "Binary");

        let date_field = stream
            .schema
            .iter()
            .find(|f| f.name == "date32_field")
            .unwrap();
        assert_eq!(date_field.r#type, "Date32");
    }

    #[test]
    fn test_metrics_meta_for_non_metrics_stream() {
        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        assert!(stream.metrics_meta.is_none());
    }

    #[test]
    fn test_uds_schema_always_empty() {
        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // UDS schema should always be empty in stream_res
        assert!(stream.uds_schema.is_empty());
    }

    #[test]
    fn test_stream_res_with_created_at_from_stats() {
        let stats = StreamStats {
            created_at: 1640995200000000,
            ..Default::default()
        };

        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, Some(stats));

        // The created_at from schema metadata overrides the stats value
        // Since no metadata is provided, it should be 0 (default)
        assert_eq!(stream.stats.created_at, 0);
    }

    #[test]
    fn test_stream_res_with_created_at_from_metadata() {
        let mut metadata = HashMap::new();
        metadata.insert("created_at".to_string(), "1640995200000000".to_string());

        let schema =
            Schema::new_with_metadata(vec![Field::new("field1", DataType::Utf8, true)], metadata);

        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);
        assert_eq!(stream.stats.created_at, 1640995200000000);
    }

    #[test]
    fn test_stream_res_approx_partition_setting() {
        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // Check that approx_partition is set based on configuration
        assert_eq!(
            stream.settings.approx_partition,
            get_config()
                .common
                .use_stream_settings_for_partitions_enabled
        );
    }

    #[test]
    fn test_stream_res_empty_schema_handling() {
        let empty_schema = Schema::empty();
        let stream = stream_res("org1", "empty", StreamType::Logs, empty_schema, None);

        assert_eq!(stream.total_fields, 0);
        assert!(stream.schema.is_empty());
    }

    #[test]
    fn test_stream_res_with_null_stats() {
        let schema = Schema::new(vec![Field::new("field1", DataType::Utf8, true)]);
        let stream = stream_res("org1", "test", StreamType::Logs, schema, None);

        // Should have default stats when None is passed
        assert_eq!(stream.stats, StreamStats::default());
    }

    #[test]
    fn test_stream_res_metrics_empty_type() {
        let schema = Schema::new(vec![Field::new("value", DataType::Float64, false)]);
        let stream = stream_res("org1", "normal_metric", StreamType::Metrics, schema, None);

        if let Some(meta) = stream.metrics_meta {
            // Should have metric family name same as stream name
            assert_eq!(meta.metric_family_name, "normal_metric");
            assert_eq!(meta.help, "normal_metric");
        }
    }
}
