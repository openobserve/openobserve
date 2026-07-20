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

use std::io::Error;

use axum::{
    Json, http,
    response::{IntoResponse, Response as HttpResponse},
};
use chrono::{TimeZone, Timelike, Utc};
// Reserved self-reporting stream guards are a Cloud-only concern (Cloud manages
// these streams for billing); OSS / self-hosted must not block user streams.
#[cfg(feature = "cloud")]
use config::meta::self_reporting::usage::is_reserved_self_reporting_stream;
use config::{
    ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME, SIZE_IN_MB, TIMESTAMP_COL_NAME, get_config,
    is_local_disk_storage,
    meta::{
        promql,
        stream::{
            DistinctField, PartitionTimeLevel, StreamField, StreamParams, StreamSettings,
            StreamStats, StreamType, TimeRange, UpdateStreamSettings,
        },
    },
    utils::{flatten::format_label_name, json, time::now_micros, util::get_distinct_stream_name},
};
#[cfg(feature = "enterprise")]
use config::{META_ORG_ID, meta::self_reporting::usage::USAGE_STREAM};
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::stats,
    schema::{
        STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
        get_partition_time_level, unwrap_stream_created_at, unwrap_stream_is_derived,
        unwrap_stream_settings,
    },
    table::distinct_values::{DistinctFieldRecord, OriginType, check_field_use},
};
use itertools::chain;
#[cfg(feature = "vectorscan")]
use o2_enterprise::enterprise::re_patterns::PATTERN_MANAGER;

use super::db::enrichment_table;
#[cfg(feature = "vectorscan")]
use crate::service::db::re_pattern::process_association_changes;
use crate::{
    common::meta::{
        authz::Authz,
        http::{ERROR_HEADER, HttpResponse as MetaHttpResponse},
        stream::{FieldUpdate, Stream, StreamCreate},
    },
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

    #[cfg(not(feature = "vectorscan"))]
    let pattern_associations = vec![];
    // because this fn cannot be async, we cannot await on initializing the pattern
    // manager. So instead we do it in best-effort-way, where if it is already initialized,
    // we get the patterns, otherwise report them as empty
    #[cfg(feature = "vectorscan")]
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
    // Reserved self-reporting streams (usage/stats/triggers/errors/...) are
    // managed internally by Cloud and must not be user-created — doing so would
    // corrupt billing/usage accounting. The internal self-reporting job creates
    // its schema directly (not via create_stream), so blocking here is safe.
    // Cloud-only: OSS / self-hosted may legitimately use these stream names.
    #[cfg(feature = "cloud")]
    if is_reserved_self_reporting_stream(stream_name) {
        return Ok((
            http::StatusCode::BAD_REQUEST,
            [(ERROR_HEADER, "stream name is reserved")],
            Json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("stream name '{stream_name}' is reserved and cannot be created"),
            )),
        )
            .into_response());
    }

    // check if the stream already exists
    let schema = match infra::schema::get(org_id, stream_name, stream_type).await {
        Ok(schema) => schema,
        Err(e) => {
            return Ok((
                http::StatusCode::INTERNAL_SERVER_ERROR,
                [(ERROR_HEADER, format!("error in getting schema: {e}"))],
                Json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    format!("error in getting schema: {e}"),
                )),
            )
                .into_response());
        }
    };
    if !schema.fields().is_empty() {
        return Ok((
            http::StatusCode::BAD_REQUEST,
            [(ERROR_HEADER, "stream already exists")],
            Json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "stream already exists",
            )),
        )
            .into_response());
    }

    // create the stream
    let mut fields = Vec::with_capacity(stream.fields.len() + 1);
    let schema = std::mem::take(&mut stream.fields);
    let mut has_timestamp = false;
    for f in schema {
        let Ok(data_type) = f.r#type.parse::<DataType>() else {
            return Ok((
                http::StatusCode::BAD_REQUEST,
                [(ERROR_HEADER, format!("invalid data type: {}", f.r#type))],
                Json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST,
                    format!("invalid data type: {}", f.r#type),
                )),
            )
                .into_response());
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
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(
                        ERROR_HEADER,
                        "error in creating stream: created schema is empty",
                    )],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        "error in creating stream: created schema is empty",
                    )),
                )
                    .into_response());
            }
            Err(e) => {
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(ERROR_HEADER, format!("error in creating stream: {e}"))],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("error in creating stream: {e}"),
                    )),
                )
                    .into_response());
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

    // create the stream settings
    let resp = save_stream_settings(org_id, stream_name, stream_type, stream.settings).await?;
    if resp.status() == http::StatusCode::OK {
        Ok(MetaHttpResponse::ok("stream created"))
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
    if openobserve_catalog::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
        return Ok((
            http::StatusCode::BAD_REQUEST,
            [(
                ERROR_HEADER,
                format!("stream [{stream_name}] is being deleted"),
            )],
            Json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("stream [{stream_name}] is being deleted"),
            )),
        )
            .into_response());
    }

    // only allow setting user defined schema for supported stream
    if !stream_type.support_uds() && !settings.defined_schema_fields.is_empty() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "stream type [{stream_type}] don't support user defined schema"
        )));
    }

    // check stroage type is compliance
    if settings.data_retention > 0
        && settings.data_retention < 30
        && settings.storage_type.is_compliance()
    {
        return Ok(MetaHttpResponse::bad_request(
            "data_retention must be at least 30 days when storage_type is compliance",
        ));
    }
    #[cfg(feature = "enterprise")]
    if org_id == META_ORG_ID && stream_name == USAGE_STREAM && settings.data_retention < 32 {
        // _meta org, usage stream can't be set to less than 32 days
        settings.data_retention = 0;
    }

    // if index_original_data is true, store_original_data must be true
    if settings.index_original_data {
        settings.store_original_data = true;
    }

    // index_original_data & index_all_values only can open one at a time
    if settings.index_original_data && settings.index_all_values {
        return Ok(MetaHttpResponse::bad_request(
            "index_original_data & index_all_values cannot be true at the same time",
        ));
    }

    let Ok(schema) = infra::schema::get(org_id, stream_name, stream_type).await else {
        return Ok(MetaHttpResponse::not_found("stream not found"));
    };
    let schema_fields = schema
        .fields()
        .iter()
        .map(|f| (f.name(), f))
        .collect::<HashMap<_, _>>();

    // Dedup + fold bloom into index. Single place where the stored shape gets
    // normalized; both direct-save callers and the update path (via this
    // function at the end) flow through here.
    normalize_stream_settings(&mut settings);

    // check for user defined schema
    if !settings.defined_schema_fields.is_empty() {
        // check fields with stream type
        let fields = super::schema::check_schema_for_defined_schema_fields(
            stream_type,
            &schema,
            settings.defined_schema_fields.to_vec(),
        );
        // remove the fields that are not in the new schema
        let mut fields: Vec<_> = fields.into_iter().collect();
        fields.sort();
        fields.dedup();
        fields.retain(|field| schema_fields.contains_key(field));
        settings.defined_schema_fields = fields;
    }
    if settings.defined_schema_fields.len() > cfg.limit.user_defined_schema_max_fields {
        return Ok(MetaHttpResponse::bad_request(format!(
            "user defined schema fields count exceeds the limit: {}",
            cfg.limit.user_defined_schema_max_fields
        )));
    }

    // Check the fields are not reserved
    let fts_set: HashSet<_> = settings.full_text_search_keys.iter().cloned().collect();
    let index_set: HashSet<_> = settings.index_fields.iter().cloned().collect();
    let bloom_set: HashSet<_> = settings.bloom_filter_fields.iter().cloned().collect();
    let pk_set: HashSet<_> = settings
        .partition_keys
        .iter()
        .map(|p| p.field.clone())
        .collect();

    // ---- 1. Reserved columns (raw lists) ----
    let strict_reserved: [&str; 2] = [TIMESTAMP_COL_NAME, cfg.common.column_all.as_str()];
    let no_search_reserved: [&str; 2] = [ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME];
    for &r in chain(strict_reserved.iter(), no_search_reserved.iter()) {
        if index_set.contains(r) {
            return Ok(MetaHttpResponse::bad_request(format!(
                "field [{r}] is reserved and cannot be used for secondary index"
            )));
        }
        if bloom_set.contains(r) {
            return Ok(MetaHttpResponse::bad_request(format!(
                "field [{r}] is reserved and cannot be used for bloom filter"
            )));
        }
        if pk_set.contains(r) {
            return Ok(MetaHttpResponse::bad_request(format!(
                "field [{r}] is reserved and cannot be used as partition key"
            )));
        }
    }
    for &r in &strict_reserved {
        // FTS is explicitly allowed for these — they hold human-readable content.
        if fts_set.contains(r) {
            return Ok(MetaHttpResponse::bad_request(format!(
                "field [{r}] is reserved and cannot be used for full text search"
            )));
        }
    }

    // ---- 2. FTS ∩ Index = ∅ (resolved) ----
    if let Some(name) = fts_set.intersection(&index_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "field [{name}] cannot be both full text search and secondary index — choose one"
        )));
    }
    // ---- 3. FTS ∩ Bloom = ∅ (resolved) ----
    if let Some(name) = fts_set.intersection(&bloom_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "field [{name}] cannot be both full text search and bloom filter"
        )));
    }
    // ---- 4. Bloom ⊆ Index (raw) ----
    if let Some(name) = bloom_set.difference(&index_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "bloom filter field [{name}] must also be a secondary index field"
        )));
    }
    // ---- 5. Partition keys disjoint from FTS / Index / Bloom (resolved) ----
    if let Some(name) = pk_set.intersection(&fts_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "partition key [{name}] cannot also be a full text search field"
        )));
    }
    if let Some(name) = pk_set.intersection(&index_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "partition key [{name}] cannot also be a secondary index field"
        )));
    }
    if let Some(name) = pk_set.intersection(&bloom_set).next() {
        return Ok(MetaHttpResponse::bad_request(format!(
            "partition key [{name}] cannot also be a bloom filter field"
        )));
    }

    // check if the partition key is a full text search field
    for key in settings.partition_keys.iter() {
        if fts_set.contains(&key.field) {
            return Ok(MetaHttpResponse::bad_request(format!(
                "field [{}] can't be used for partition key",
                key.field
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
                return Ok(MetaHttpResponse::bad_request(format!(
                    "field [{}] partition types can't be changed",
                    v.field
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
            return Ok(MetaHttpResponse::bad_request(
                "start day should be less than end day",
            ));
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

    // skip metadata, as we should never do distinct values stream for
    // metadata streams
    if matches!(stream_type, StreamType::Logs | StreamType::Traces)
        && let Some(original_settings) = unwrap_stream_settings(&schema)
    {
        let existing = original_settings.data_retention;
        let new = settings.data_retention;
        if existing != new {
            let distinct_stream = get_distinct_stream_name(stream_type, stream_name);

            match infra::schema::get(org_id, &distinct_stream, StreamType::Metadata).await {
                Ok(distinct_schema) => {
                    let mut distinct_settings =
                        unwrap_stream_settings(&distinct_schema).unwrap_or_default();
                    distinct_settings.data_retention = new;

                    let mut metadata = distinct_schema.metadata.clone();
                    metadata.insert(
                        "settings".to_string(),
                        json::to_string(&distinct_settings).unwrap(),
                    );
                    if !metadata.contains_key("created_at") {
                        metadata.insert("created_at".to_string(), now_micros().to_string());
                    }

                    if let Err(e) = db::schema::update_setting(
                        org_id,
                        &distinct_stream,
                        StreamType::Metadata,
                        metadata,
                    )
                    .await
                    {
                        log::warn!(
                            "error in updating retention setting for distinct stream : {org_id}/{distinct_stream} : {e}"
                        );
                    }
                }
                Err(e) => {
                    // We have already updated the main stream settings, and this is just for
                    // retention, so no point in failing the api call if this fails.
                    log::warn!(
                        "error getting schema for distinct stream {org_id}/{distinct_stream} : {e}"
                    );
                }
            }
        }
    }

    Ok(MetaHttpResponse::ok(""))
}

#[tracing::instrument(skip(new_settings))]
pub async fn update_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut new_settings: UpdateStreamSettings,
) -> Result<HttpResponse, Error> {
    let Some(mut settings) = infra::schema::get_settings(org_id, stream_name, stream_type).await
    else {
        return Ok(MetaHttpResponse::not_found("stream not found"));
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
        match infra::schema::merge(org_id, stream_name, stream_type, &new_schema, None).await {
            Ok(Some(_)) => {}
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

    if let Some(v) = new_settings.storage_type {
        settings.storage_type = v;
    }
    if let Some(v) = new_settings.data_retention {
        settings.data_retention = v;
    }
    if let Some(v) = new_settings.flatten_level {
        settings.flatten_level = Some(v);
    }
    if let Some(v) = new_settings.max_query_range {
        settings.max_query_range = v;
    }
    if let Some(v) = new_settings.store_original_data {
        settings.store_original_data = v;
    }
    if let Some(v) = new_settings.approx_partition {
        settings.approx_partition = v;
    }
    if let Some(v) = new_settings.index_original_data {
        settings.index_original_data = v;
    }
    if let Some(v) = new_settings.index_all_values {
        settings.index_all_values = v;
    }
    if let Some(v) = new_settings.enable_log_patterns_extraction {
        settings.enable_log_patterns_extraction = v;
    }
    if let Some(v) = new_settings.is_llm_stream {
        settings.is_llm_stream = v;
    }

    // partition_keys: remove-then-add, dedup (by `field`) deferred to normalize.
    if !new_settings.partition_keys.remove.is_empty() {
        settings.partition_keys.retain(|p| {
            !new_settings
                .partition_keys
                .remove
                .iter()
                .any(|r| r.field == p.field)
        });
    }
    if !new_settings.partition_keys.add.is_empty() {
        settings
            .partition_keys
            .extend(new_settings.partition_keys.add);
    }

    // full_text_search_keys: remove first, then add
    if !new_settings.full_text_search_keys.remove.is_empty() {
        settings
            .full_text_search_keys
            .retain(|f| !new_settings.full_text_search_keys.remove.contains(f));
    }
    if !new_settings.full_text_search_keys.add.is_empty() {
        let now = now_micros();
        for field in new_settings.full_text_search_keys.add.iter() {
            if !settings.full_text_search_keys.contains(field) {
                settings.index_fields_updated_at.insert(field.clone(), now);
            }
        }
        settings
            .full_text_search_keys
            .extend(new_settings.full_text_search_keys.add);
    }

    // index_fields: remove first, then add
    if !new_settings.index_fields.remove.is_empty() {
        settings
            .index_fields
            .retain(|f| !new_settings.index_fields.remove.contains(f));
    }
    if !new_settings.index_fields.add.is_empty() {
        let now = now_micros();
        for field in new_settings.index_fields.add.iter() {
            if !settings.index_fields.contains(field) {
                settings.index_fields_updated_at.insert(field.clone(), now);
            }
        }
        settings.index_fields.extend(new_settings.index_fields.add);
    }

    // bloom_filter_fields: remove first, then add
    if !new_settings.bloom_filter_fields.remove.is_empty() {
        settings
            .bloom_filter_fields
            .retain(|f| !new_settings.bloom_filter_fields.remove.contains(f));
    }
    if !new_settings.bloom_filter_fields.add.is_empty() {
        settings
            .bloom_filter_fields
            .extend(new_settings.bloom_filter_fields.add);
    }

    // check for user defined schema
    if !new_settings.defined_schema_fields.remove.is_empty() {
        settings
            .defined_schema_fields
            .retain(|field| !new_settings.defined_schema_fields.remove.contains(field));
    }
    if !new_settings.defined_schema_fields.add.is_empty() {
        settings
            .defined_schema_fields
            .extend(new_settings.defined_schema_fields.add);
    }

    // extended_retention_days: remove first, then add
    if !new_settings.extended_retention_days.remove.is_empty() {
        settings
            .extended_retention_days
            .retain(|range| !new_settings.extended_retention_days.remove.contains(range));
    }
    if !new_settings.extended_retention_days.add.is_empty() {
        settings
            .extended_retention_days
            .extend(new_settings.extended_retention_days.add);
    }

    // distinct_value_fields: remove first, then add

    if !new_settings.distinct_value_fields.remove.is_empty() {
        for f in &new_settings.distinct_value_fields.remove {
            let usage = match check_field_use(org_id, stream_name, stream_type.as_str(), f).await {
                Ok(entry) => entry,
                Err(e) => {
                    return Ok((
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        [(ERROR_HEADER, format!("error in updating settings : {e}"))],
                        Json(MetaHttpResponse::error(
                            http::StatusCode::INTERNAL_SERVER_ERROR,
                            format!("error in updating settings : {e}"),
                        )),
                    )
                        .into_response());
                }
            };
            // if there are multiple uses, we cannot allow it to be removed
            if usage.len() > 1 {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "error in removing distinct field : field {f} if used in dashboards/reports"
                )));
            }
            // here we can be sure that usage is at most 1 record
            if let Some(entry) = usage.first()
                && entry.origin != OriginType::Stream
            {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "error in removing distinct field : field {f} if used in dashboards/reports"
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
    if !new_settings.distinct_value_fields.add.is_empty() {
        for f in &new_settings.distinct_value_fields.add {
            if f == "count" || f == TIMESTAMP_COL_NAME {
                return Ok(MetaHttpResponse::bad_request(format!(
                    "count and {TIMESTAMP_COL_NAME} are reserved fields and cannot be added"
                )));
            }
            // we ignore full text search fields
            if settings.full_text_search_keys.contains(f) {
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
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(ERROR_HEADER, format!("error in updating settings : {e}"))],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!("error in updating settings : {e}"),
                    )),
                )
                    .into_response());
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

    // Handle cross_links updates
    if !new_settings.cross_links.add.is_empty() || !new_settings.cross_links.remove.is_empty() {
        // Remove links by name
        for link_to_remove in &new_settings.cross_links.remove {
            settings
                .cross_links
                .retain(|l| l.name != link_to_remove.name);
        }

        // Validate and add new links
        for link_to_add in new_settings.cross_links.add {
            if link_to_add.name.is_empty() || link_to_add.url.is_empty() {
                return Ok(MetaHttpResponse::bad_request(
                    "Cross-link name and URL are required",
                ));
            }
            if link_to_add.name.len() > 256 {
                return Ok(MetaHttpResponse::bad_request(
                    "Cross-link name must be 256 characters or less",
                ));
            }
            if !settings
                .cross_links
                .iter()
                .any(|l| l.name == link_to_add.name)
            {
                settings.cross_links.push(link_to_add);
            }
        }

        // Enforce max limit
    }

    #[cfg(feature = "vectorscan")]
    {
        if let Err(e) = process_association_changes(
            org_id,
            stream_name,
            stream_type,
            new_settings.pattern_associations,
        )
        .await
        {
            return Ok(MetaHttpResponse::internal_error(format!(
                "Internal server error while updating pattern associations {e}",
            )));
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
    // Reserved self-reporting streams (usage/stats/triggers/errors/...) are
    // managed internally by Cloud and must not be user-deleted — retention/
    // compaction uses a separate internal path, so blocking this user-facing
    // delete is safe and preserves billing/usage accounting. Cloud-only.
    #[cfg(feature = "cloud")]
    if is_reserved_self_reporting_stream(stream_name) {
        return Ok((
            http::StatusCode::BAD_REQUEST,
            [(ERROR_HEADER, "stream name is reserved")],
            Json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                format!("stream '{stream_name}' is reserved and cannot be deleted"),
            )),
        )
            .into_response());
    }

    let schema = infra::schema::get_versions(org_id, stream_name, stream_type, None)
        .await
        .unwrap();
    if schema.is_empty() {
        // If stream schema doesn't exist, check if this is an enrichment table with a URL job
        if stream_type == StreamType::EnrichmentTables
            && let Ok(Some(_job)) = db::enrichment_table::get_url_job(org_id, stream_name).await
        {
            // URL job exists - delete it and return success
            if let Err(e) = db::enrichment_table::delete_url_job(org_id, stream_name).await {
                return Ok(MetaHttpResponse::internal_error(format!(
                    "failed to delete URL job: {e}"
                )));
            }

            log::info!(
                "Deleted URL job for enrichment table: {}/{}",
                org_id,
                stream_name
            );

            return Ok(MetaHttpResponse::ok(
                "URL job deleted successfully".to_string(),
            ));
        }

        // No schema and no URL job - stream not found
        return Ok(MetaHttpResponse::not_found("stream not found"));
    }

    // delete stream schema
    if let Err(e) = db::schema::delete(org_id, stream_name, Some(stream_type)).await {
        return Ok((
            http::StatusCode::INTERNAL_SERVER_ERROR,
            [(ERROR_HEADER, format!("failed to delete stream schema: {e}"))],
            Json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream schema: {e}"),
            )),
        )
            .into_response());
    }

    // delete associated feature resources, i.e. pipelines, alerts
    if del_related_feature_resources {
        for pipeline in
            db::pipeline::get_by_stream(&StreamParams::new(org_id, stream_name, stream_type)).await
        {
            if let Err(e) = db::pipeline::delete(&pipeline.id).await {
                return Ok((
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    [(ERROR_HEADER, format!("failed to delete stream: {e}"))],
                    Json(MetaHttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        format!(
                            "Error: failed to delete the associated pipeline \"{}\": {e}",
                            pipeline.name
                        ),
                    )),
                )
                    .into_response());
            }
        }

        if let Ok(alerts) =
            db::alerts::alert::list(org_id, Some(stream_type), Some(stream_name)).await
        {
            for alert in alerts {
                if let Err(e) =
                    db::alerts::alert::delete_by_name(org_id, stream_type, stream_name, &alert.name)
                        .await
                {
                    return Ok((
                        http::StatusCode::INTERNAL_SERVER_ERROR,
                        [(ERROR_HEADER, format!("failed to delete alert: {e}"))],
                        Json(MetaHttpResponse::error(
                            http::StatusCode::INTERNAL_SERVER_ERROR,
                            format!(
                                "Error: failed to delete the associated alert \"{}\": {e}",
                                alert.name
                            ),
                        )),
                    )
                        .into_response());
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
        return Ok((
            http::StatusCode::INTERNAL_SERVER_ERROR,
            [(ERROR_HEADER, format!("failed to delete stream: {e}"))],
            Json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream: {e}"),
            )),
        )
            .into_response());
    }

    // delete related resource
    if let Err(e) = stream_delete_inner(org_id, stream_type, stream_name).await {
        return Ok((
            http::StatusCode::INTERNAL_SERVER_ERROR,
            [(ERROR_HEADER, format!("failed to delete stream: {e}"))],
            Json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("failed to delete stream: {e}"),
            )),
        )
            .into_response());
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

    Ok(MetaHttpResponse::ok("stream deleted"))
}

pub async fn stream_delete_inner(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    #[cfg(feature = "vectorscan")]
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

pub async fn delete_stream_data_by_time_range(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: TimeRange,
) -> Result<String, infra::errors::Error> {
    if time_range.start > time_range.end {
        return Err(infra::errors::Error::Message(
            "Start time must be less than end time".to_string(),
        ));
    }

    // Convert the time range to RFC3339 format
    // we need check the date is hour or day, user can't delete data with minute and second
    let partition_time_level = get_partition_time_level(stream_type);
    let start_time = Utc.timestamp_nanos(time_range.start * 1000);
    let end_time = Utc.timestamp_nanos(time_range.end * 1000);
    let (start_time, end_time) = if partition_time_level == PartitionTimeLevel::Daily {
        if start_time.hour() != 0 || start_time.minute() != 0 || start_time.second() != 0 {
            return Err(infra::errors::Error::Message(
                "Start time must be with zero hour, minute and second".to_string(),
            ));
        }
        if end_time.hour() != 0 || end_time.minute() != 0 || end_time.second() != 0 {
            return Err(infra::errors::Error::Message(
                "End time must be with zero hour, minute and second".to_string(),
            ));
        }
        (
            start_time.format("%Y-%m-%d").to_string(),
            end_time.format("%Y-%m-%d").to_string(),
        )
    } else {
        if start_time.minute() != 0 || start_time.second() != 0 {
            return Err(infra::errors::Error::Message(
                "Start time must be with zero minute and second".to_string(),
            ));
        }
        if end_time.minute() != 0 || end_time.second() != 0 {
            return Err(infra::errors::Error::Message(
                "End time must be with zero minute and second".to_string(),
            ));
        }
        (
            start_time.format("%Y-%m-%dT%H:00:00Z").to_string(),
            end_time.format("%Y-%m-%dT%H:00:00Z").to_string(),
        )
    };

    // Create a job to delete the data by the time range
    let (key, _created) = match crate::service::db::compact::retention::delete_stream(
        org_id,
        stream_type,
        stream_name,
        Some((start_time.as_str(), end_time.as_str())),
    )
    .await
    {
        Ok(key) => key,
        Err(e) => {
            return Err(infra::errors::Error::Message(e.to_string()));
        }
    };

    // Create a job in the compact manual jobs table
    let job = infra::table::compactor_manual_jobs::CompactorManualJob {
        id: config::ider::uuid(),
        key,
        status: infra::table::compactor_manual_jobs::Status::Pending,
        created_at: Utc::now().timestamp_micros(),
        ended_at: 0,
    };
    crate::service::db::compact::compactor_manual_jobs::add_job(job).await
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

/// Make `settings` internally consistent before validation / persistence.
/// Three normalizations, all in-place:
///
/// 1. **Dedup** each of `full_text_search_keys`, `index_fields`, `bloom_filter_fields`, and
///    `partition_keys`, preserving first-occurrence order. Matches the silent dedup the update path
///    has always done on `.add` lists, so a user re-adding the same field is a no-op rather than an
///    error.
/// 2. **Enforce `bloom ⊆ index`** by folding any bloom-only field into `index_fields` (and bumping
///    `index_updated_at` plus the per-field timestamps if anything was added). Bloom is built by
///    walking the tantivy term dict, so a bloom field that isn't in `index_fields` would silently
///    produce no `.bf`; auto-folding here keeps the stored shape consistent with the runtime
///    invariant.
/// 3. **Prune `index_fields_updated_at`** to fields still present in `full_text_search_keys` or
///    `index_fields`, so removed fields don't leave stale timestamps behind (a later re-add must
///    stamp a fresh time, because files written in the gap lack that field's index).
///
/// Called by [`save_stream_settings`] just before [`validate_stream_settings`],
/// and by [`validate_update_pre_flight`] on its simulated state so both paths
/// validate the same normalized shape.
fn normalize_stream_settings(settings: &mut StreamSettings) {
    // 1. dedup
    dedup_preserve_order(&mut settings.full_text_search_keys);
    dedup_preserve_order(&mut settings.index_fields);
    dedup_preserve_order(&mut settings.bloom_filter_fields);
    dedup_preserve_order(&mut settings.defined_schema_fields);
    let mut seen: HashSet<String> = HashSet::new();
    settings
        .partition_keys
        .retain(|p| seen.insert(p.field.clone()));
    seen.clear();
    settings
        .distinct_value_fields
        .retain(|d| seen.insert(d.name.clone()));
    seen.clear();
    settings
        .extended_retention_days
        .retain(|r| seen.insert(r.to_string()));
    seen.clear();
    settings.cross_links.retain(|c| seen.insert(c.to_string()));

    // 2. bloom ⊆ index
    let missing_index: Vec<String> = settings
        .bloom_filter_fields
        .iter()
        .filter(|f| !settings.index_fields.contains(f))
        .cloned()
        .collect();
    if !missing_index.is_empty() {
        let now = now_micros();
        for field in missing_index.iter() {
            settings.index_fields_updated_at.insert(field.clone(), now);
        }
        settings.index_fields.extend(missing_index);
    }

    // 3. prune per-field timestamps of fields no longer indexed
    if !settings.index_fields_updated_at.is_empty() {
        let indexed: HashSet<String> = settings
            .full_text_search_keys
            .iter()
            .chain(settings.index_fields.iter())
            .cloned()
            .collect();
        settings
            .index_fields_updated_at
            .retain(|field, _| indexed.contains(field));
    }
}

fn dedup_preserve_order(v: &mut Vec<String>) {
    let mut seen: HashSet<String> = HashSet::new();
    v.retain(|s| seen.insert(s.clone()));
}

pub async fn get_stream_retention(
    org_id: &str,
    stream_type: StreamType,
    stream: &str,
) -> Option<i64> {
    if let Some(s) = infra::schema::get_settings(org_id, stream, stream_type).await {
        Some(s.data_retention)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use datafusion::arrow::datatypes::{DataType, Field};

    use super::*;

    #[test]
    fn test_normalize_stream_settings_index_fields_updated_at() {
        let mut settings = StreamSettings {
            index_fields: vec!["a".to_string()],
            bloom_filter_fields: vec!["b".to_string()],
            ..Default::default()
        };
        settings
            .index_fields_updated_at
            .insert("a".to_string(), 100);
        settings
            .index_fields_updated_at
            .insert("removed".to_string(), 200);

        normalize_stream_settings(&mut settings);

        // bloom-only field folded into index_fields and stamped
        assert!(settings.index_fields.contains(&"b".to_string()));
        assert!(
            settings
                .index_fields_updated_at
                .get("b")
                .is_some_and(|v| *v > 0)
        );
        // entry of a field no longer indexed is pruned
        assert!(!settings.index_fields_updated_at.contains_key("removed"));
        // entry of a still-indexed field is preserved
        assert_eq!(settings.index_fields_updated_at.get("a"), Some(&100));
    }

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

    /// The `/streams` response is what the family join is built from, and it is served from the
    /// stored schema -- which, for every metric ingested before the writer was fixed, holds a
    /// JSON-quoted family name. The quotes must not reach the client.
    #[test]
    fn test_stream_res_metrics_family_name_served_unquoted_for_a_stored_quoted_schema() {
        let schema = Schema::new(vec![Field::new("value", DataType::Float64, false)])
            .with_metadata(
                [(
                    config::meta::promql::METADATA_LABEL.to_string(),
                    r#"{"metric_type":"Histogram","metric_family_name":"\"http_requests\"","help":"h","unit":"s"}"#
                        .to_string(),
                )]
                .into_iter()
                .collect(),
            );

        let stream = stream_res("org1", "http_requests", StreamType::Metrics, schema, None);
        let meta = stream.metrics_meta.unwrap();

        assert_eq!(meta.metric_family_name, "http_requests");
        assert_eq!(meta.metric_type, promql::MetricType::Histogram);
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

    #[test]
    fn test_parse_data_type_all_variants() {
        assert_eq!(parse_data_type("utf8"), Some(DataType::Utf8));
        assert_eq!(parse_data_type("UTF8"), Some(DataType::Utf8));
        assert_eq!(parse_data_type("largeutf8"), Some(DataType::LargeUtf8));
        assert_eq!(parse_data_type("large_utf8"), Some(DataType::LargeUtf8));
        assert_eq!(parse_data_type("LARGE_UTF8"), Some(DataType::LargeUtf8));
        assert_eq!(parse_data_type("bool"), Some(DataType::Boolean));
        assert_eq!(parse_data_type("boolean"), Some(DataType::Boolean));
        assert_eq!(parse_data_type("BOOLEAN"), Some(DataType::Boolean));
        assert_eq!(parse_data_type("int64"), Some(DataType::Int64));
        assert_eq!(parse_data_type("INT64"), Some(DataType::Int64));
        assert_eq!(parse_data_type("uint64"), Some(DataType::UInt64));
        assert_eq!(parse_data_type("float64"), Some(DataType::Float64));
        assert_eq!(parse_data_type("FLOAT64"), Some(DataType::Float64));
        // unknown → None
        assert_eq!(parse_data_type("text"), None);
        assert_eq!(parse_data_type(""), None);
        assert_eq!(parse_data_type("int32"), None);
    }
}
