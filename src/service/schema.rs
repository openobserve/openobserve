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

use std::{
    collections::HashMap,
    sync::{Arc, atomic::Ordering},
};

use anyhow::Result;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, SQL_FULL_TEXT_SEARCH_FIELDS,
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE_ID,
    get_config,
    ider::SnowflakeIdGenerator,
    meta::{promql::METADATA_LABEL, stream::StreamType},
    metrics,
    utils::{json, schema::infer_json_schema_from_map, schema_ext::SchemaExt, time::now_micros},
};
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use hashbrown::HashSet;
use infra::schema::{
    STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS, SchemaCache,
    unwrap_stream_settings,
};
use serde_json::{Map, Value};

use super::logs::bulk::SCHEMA_CONFORMANCE_FAILED;
use crate::{
    common::meta::{authz::Authz, ingestion::StreamSchemaChk, stream::SchemaEvolution},
    service::db,
};

pub(crate) fn get_upto_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        get_config().limit.ingest_allowed_upto
    )
}

pub(crate) fn get_future_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too far data, only future {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_IN_FUTURE=<max_hours>",
        get_config().limit.ingest_allowed_in_future
    )
}

pub(crate) fn get_request_columns_limit_error(
    stream_name: &str,
    num_fields: usize,
) -> anyhow::Error {
    anyhow::anyhow!(
        "Got {num_fields} columns for stream {stream_name}, only {} columns accept. Data discarded. You can adjust ingestion columns limit by setting the environment variable ZO_COLS_PER_RECORD_LIMIT=<max_columns>",
        get_config().limit.req_cols_per_record_limit
    )
}

pub async fn check_for_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    record_vals: Vec<&Map<String, Value>>,
    record_ts: i64,
    is_derived: bool,
) -> Result<(SchemaEvolution, Option<Schema>)> {
    if !stream_schema_map.contains_key(stream_name) {
        let schema = infra::schema::get_cache(org_id, stream_name, stream_type).await?;
        stream_schema_map.insert(stream_name.to_string(), schema);
    }
    let cfg = get_config();
    let schema = stream_schema_map.get(stream_name).unwrap();

    // get infer schema
    let value_iter = record_vals.into_iter();
    let inferred_schema = infer_json_schema_from_map(value_iter, stream_type)?;

    // fast path
    if schema.schema().fields.eq(&inferred_schema.fields) {
        return Ok((
            SchemaEvolution {
                is_schema_changed: false,
                types_delta: None,
            },
            None,
        ));
    }

    if inferred_schema.fields.len() > cfg.limit.req_cols_per_record_limit {
        metrics::INGEST_ERRORS
            .with_label_values(&[
                org_id,
                stream_type.as_str(),
                stream_name,
                SCHEMA_CONFORMANCE_FAILED,
            ])
            .inc();
        return Err(get_request_columns_limit_error(
            &format!("{org_id}/{stream_type}/{stream_name}"),
            inferred_schema.fields.len(),
        ));
    }

    let mut need_insert_new_latest = false;
    let is_new = schema.schema().fields().is_empty();
    if !is_new {
        let (is_schema_changed, field_datatype_delta) =
            get_schema_changes(schema, &inferred_schema);
        if !is_schema_changed {
            // check defined_schema_fields
            let stream_setting = unwrap_stream_settings(schema.schema());
            let (defined_schema_fields, need_original, index_original_data, index_all_values) =
                match stream_setting {
                    Some(s) => (
                        s.defined_schema_fields,
                        s.store_original_data,
                        s.index_original_data,
                        s.index_all_values,
                    ),
                    None => (Vec::new(), false, false, false),
                };
            if !defined_schema_fields.is_empty() {
                let schema = generate_schema_for_defined_schema_fields(
                    schema,
                    &defined_schema_fields,
                    need_original,
                    index_original_data,
                    index_all_values,
                    stream_type,
                );
                stream_schema_map.insert(stream_name.to_string(), schema);
            }
            return Ok((
                SchemaEvolution {
                    is_schema_changed: false,
                    types_delta: Some(field_datatype_delta),
                },
                Some(inferred_schema),
            ));
        }
        if !field_datatype_delta.is_empty() {
            // check if the min_ts < current_version_created_at
            let schema_metadata = schema.schema().metadata();
            if let Some(start_dt) = schema_metadata.get("start_dt") {
                let created_at = start_dt.parse().unwrap_or_default();
                if record_ts <= created_at {
                    need_insert_new_latest = true;
                }
            }
        }
    }

    // slow path
    let ret = handle_diff_schema(
        org_id,
        stream_name,
        stream_type,
        is_new,
        &inferred_schema,
        record_ts,
        stream_schema_map,
        is_derived,
    )
    .await?
    .unwrap_or(SchemaEvolution {
        is_schema_changed: false,
        types_delta: None,
    });

    // if need_insert_new_latest, create a new version with start_dt = now
    if need_insert_new_latest {
        _ = handle_diff_schema(
            org_id,
            stream_name,
            stream_type,
            is_new,
            &inferred_schema,
            now_micros(),
            stream_schema_map,
            is_derived,
        )
        .await?;
    }

    Ok((ret, Some(inferred_schema)))
}

pub async fn get_merged_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    inferred_schema: &Schema,
) -> Option<(Vec<Field>, Schema)> {
    let mut db_schema = infra::schema::get_from_db(org_id, stream_name, stream_type)
        .await
        .unwrap();

    let (is_schema_changed, field_datatype_delta, merged_fields) =
        infra::schema::get_merge_schema_changes(&db_schema, inferred_schema);

    if !is_schema_changed {
        return None;
    }

    let metadata = std::mem::take(&mut db_schema.metadata);
    Some((
        field_datatype_delta,
        Schema::new(merged_fields).with_metadata(metadata),
    ))
}

// handle_diff_schema is a slow path, it acquires a lock to update schema
// steps:
// 1. get schema from db, if schema is empty, set schema and return
// 2. get schema from db for update,
// 3. if db_schema is identical to inferred_schema, return (means another thread has updated schema)
// 4. if db_schema is not identical to inferred_schema, merge schema and update db
#[allow(clippy::too_many_arguments)]
pub(crate) async fn handle_diff_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_new: bool,
    inferred_schema: &Schema,
    record_ts: i64,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    is_derived: bool,
) -> Result<Option<SchemaEvolution>> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    log::debug!(
        "handle_diff_schema start for [{org_id}/{stream_type}/{stream_name}] start_dt: {record_ts}"
    );

    // acquire a local_lock to ensure only one thread can update schema
    let cache_key = format!("{org_id}/{stream_type}/{stream_name}");
    let local_lock = infra::local_lock::lock(&cache_key).await?;
    let _guard = local_lock.lock().await;

    // check if the schema has been updated by another thread
    let read_cache = STREAM_SCHEMAS_LATEST.read().await;
    if let Some(updated_schema) = read_cache.get(&cache_key)
        && let (false, _) = get_schema_changes(updated_schema, inferred_schema)
    {
        return Ok(None);
    }
    drop(read_cache);

    // first update thread cache
    if is_new {
        let mut metadata = HashMap::with_capacity(1);
        metadata.insert("created_at".to_string(), record_ts.to_string());
        if is_derived {
            metadata.insert("is_derived".to_string(), "true".to_string());
        }
        stream_schema_map.insert(
            stream_name.to_string(),
            SchemaCache::new(inferred_schema.clone().with_metadata(metadata)),
        );
    }

    let mut retries = 0;
    let mut err: Option<anyhow::Error> = None;
    let mut ret: Option<_> = None;
    // retry x times for update schema
    while retries < cfg.limit.meta_transaction_retries {
        let schema_for_merge = if is_derived {
            let mut metadata = HashMap::with_capacity(1);
            metadata.insert("is_derived".to_string(), "true".to_string());
            &inferred_schema.clone().with_metadata(metadata)
        } else {
            inferred_schema
        };
        match db::schema::merge(
            org_id,
            stream_name,
            stream_type,
            schema_for_merge,
            Some(record_ts),
        )
        .await
        {
            Err(e) => {
                log::error!(
                    "handle_diff_schema [{}/{}/{}] with hash {}, start_dt {}, error: {}, retrying...{}",
                    org_id,
                    stream_type,
                    stream_name,
                    inferred_schema.hash_key(),
                    record_ts,
                    e,
                    retries
                );
                err = Some(e);
                retries += 1;
                continue;
            }
            Ok(v) => {
                ret = v;
                err = None;
                break;
            }
        };
    }
    if let Some(e) = err {
        log::error!(
            "handle_diff_schema [{}/{}/{}] with hash {}, start_dt {}, abort after retry {} times, error: {}",
            org_id,
            stream_type,
            stream_name,
            inferred_schema.hash_key(),
            record_ts,
            retries,
            e
        );
        return Err(e);
    }
    let Some((mut final_schema, field_datatype_delta)) = ret else {
        return Ok(None);
    };

    if is_new {
        crate::common::utils::auth::set_ownership(
            org_id,
            stream_type.as_str(),
            Authz::new(stream_name),
        )
        .await;
    }

    // check defined_schema_fields
    let mut stream_setting = unwrap_stream_settings(&final_schema).unwrap_or_default();
    let mut defined_schema_fields = stream_setting.defined_schema_fields.clone();

    // Helper function to check if a field is a core system field
    // Core fields should NOT count toward the UDS threshold
    // These are fields that OpenObserve adds or requires for functionality
    let is_core_system_field = |field_name: &str| {
        // Fields with double underscores are system fields
        field_name.starts_with("__") ||
        // Timestamp field is always required
        field_name == TIMESTAMP_COL_NAME ||
        field_name == ID_COL_NAME ||
        field_name == ORIGINAL_DATA_COL_NAME ||
        field_name == ALL_VALUES_COL_NAME ||
        field_name == cfg.common.column_all.as_str()
    };

    // Count only non-core fields for UDS threshold check
    let non_core_field_count = final_schema
        .fields()
        .iter()
        .filter(|f| !is_core_system_field(f.name()))
        .count();

    log::info!(
        "[UDS DEBUG] Checking auto-enable for {}/{}, stream_type={:?}, total_fields={}, non_core_fields={}",
        org_id,
        stream_name,
        stream_type,
        final_schema.fields().len(),
        non_core_field_count
    );

    // Automatically enable User-defined schema when
    // 1. allow_user_defined_schemas is enabled
    // 2. log/metrics/traces ingestion
    // 3. user defined schema is not already enabled
    // 4. NON-CORE schema fields count exceeds the respective threshold
    // Core fields (with __ prefix or _timestamp) are always included and don't count toward
    // threshold

    // Check which threshold to use based on stream type
    let (should_enable_uds, uds_max_fields) = match stream_type {
        StreamType::Logs => (
            cfg.common.allow_user_defined_schemas
                && cfg.limit.schema_max_fields_to_enable_uds > 0
                && defined_schema_fields.is_empty()
                && non_core_field_count > cfg.limit.schema_max_fields_to_enable_uds,
            cfg.limit.schema_max_fields_to_enable_uds,
        ),
        StreamType::Metrics => {
            let allow_uds = cfg.common.allow_user_defined_schemas;
            let threshold_set = cfg.limit.schema_max_fields_to_enable_uds_metrics > 0;
            let fields_empty = defined_schema_fields.is_empty();
            let exceeds_threshold =
                non_core_field_count > cfg.limit.schema_max_fields_to_enable_uds_metrics;

            log::info!(
                "[UDS METRICS AUTO-ENABLE CHECK] allow_uds={}, threshold={}>0={}, non_core_field_count={}, threshold_value={}, exceeds={}, fields_empty={}, will_enable={}",
                allow_uds,
                cfg.limit.schema_max_fields_to_enable_uds_metrics,
                threshold_set,
                non_core_field_count,
                cfg.limit.schema_max_fields_to_enable_uds_metrics,
                exceeds_threshold,
                fields_empty,
                allow_uds && threshold_set && fields_empty && exceeds_threshold
            );
            (
                allow_uds && threshold_set && fields_empty && exceeds_threshold,
                cfg.limit.schema_max_fields_to_enable_uds_metrics,
            )
        }
        StreamType::Traces => {
            log::debug!(
                "[UDS] Traces auto-enable check: allow_uds={}, threshold={}, non_core_field_count={}, defined_fields_empty={}",
                cfg.common.allow_user_defined_schemas,
                cfg.limit.schema_max_fields_to_enable_uds_traces,
                non_core_field_count,
                defined_schema_fields.is_empty()
            );
            (
                cfg.common.allow_user_defined_schemas
                    && cfg.limit.schema_max_fields_to_enable_uds_traces > 0
                    && defined_schema_fields.is_empty()
                    && non_core_field_count > cfg.limit.schema_max_fields_to_enable_uds_traces,
                cfg.limit.schema_max_fields_to_enable_uds_traces,
            )
        }
        _ => (false, 0),
    };

    if should_enable_uds {
        log::info!(
            "[UDS AUTO-ENABLE] Enabling UDS for {}/{}/{}, total_fields={}, non_core_fields={}, max_fields={}",
            org_id,
            stream_type,
            stream_name,
            final_schema.fields().len(),
            non_core_field_count,
            uds_max_fields
        );

        let mut uds_fields = HashSet::with_capacity(uds_max_fields);

        // Helper to check if a field should be skipped
        // Core system fields should NOT be added to the UDS field list
        // They are always included regardless of UDS configuration
        let should_skip_common = |field_name: &str| {
            // Fields with double underscores are system fields (e.g., __name__, __type__, __hash__)
            field_name.starts_with("__")
                || field_name == TIMESTAMP_COL_NAME
                || field_name == ID_COL_NAME
                || field_name == ORIGINAL_DATA_COL_NAME
                || field_name == ALL_VALUES_COL_NAME
                || field_name == cfg.common.column_all
        };

        match stream_type {
            StreamType::Logs => {
                // For logs: prioritize FTS fields first
                for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
                    if final_schema.field_with_name(field).is_ok()
                        && !should_skip_common(field)
                        && uds_fields.insert(field.to_string())
                        && uds_fields.len() >= uds_max_fields
                    {
                        break;
                    }
                }

                // Add fields from current schema if available
                if let Some(stream_schema) = stream_schema_map.get(stream_name) {
                    for field in stream_schema.schema().fields() {
                        let field = field.name();
                        if !should_skip_common(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }

                // Add remaining fields from final schema
                if uds_fields.len() < uds_max_fields {
                    for field in final_schema.fields() {
                        let field = field.name();
                        if !should_skip_common(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }
            }
            StreamType::Metrics => {
                use config::meta::promql::{
                    BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, NAME_LABEL, QUANTILE_LABEL,
                    TYPE_LABEL, VALUE_LABEL,
                };

                // For metrics: skip core metric fields (they're always included)
                let should_skip_metric = |field_name: &str| {
                    should_skip_common(field_name)
                        || field_name == NAME_LABEL
                        || field_name == TYPE_LABEL
                        || field_name == HASH_LABEL
                        || field_name == VALUE_LABEL
                        || field_name == BUCKET_LABEL
                        || field_name == QUANTILE_LABEL
                        || field_name == EXEMPLARS_LABEL
                };

                // Add common important labels first
                const IMPORTANT_METRIC_LABELS: &[&str] = &["service_name", "job", "instance"];
                for label in IMPORTANT_METRIC_LABELS {
                    if final_schema.field_with_name(label).is_ok()
                        && !should_skip_metric(label)
                        && uds_fields.insert(label.to_string())
                        && uds_fields.len() >= uds_max_fields
                    {
                        break;
                    }
                }

                // Add FTS fields if configured
                if uds_fields.len() < uds_max_fields {
                    for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
                        if final_schema.field_with_name(field).is_ok()
                            && !should_skip_metric(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }

                // Add remaining labels from schema
                if uds_fields.len() < uds_max_fields {
                    for field in final_schema.fields() {
                        let field = field.name();
                        if !should_skip_metric(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }
            }
            StreamType::Traces => {
                // For traces: skip core trace fields (they're always included)
                const CORE_TRACE_FIELDS: &[&str] = &[
                    "trace_id",
                    "span_id",
                    "parent_span_id",
                    "start_time",
                    "end_time",
                    "duration",
                    "service_name",
                    "operation_name",
                    "span_kind",
                    "span_status",
                    "flags",
                    "events",
                    "links",
                    "reference",
                ];
                let should_skip_trace = |field_name: &str| {
                    should_skip_common(field_name) || CORE_TRACE_FIELDS.contains(&field_name)
                };

                // Add semantic convention attributes (HTTP, DB, RPC)
                // Note: OTLP normalizes dots to underscores, so we use underscored names
                const SEMANTIC_ATTRS: &[&str] = &[
                    "http_method",
                    "http_status_code",
                    "http_target",
                    "http_route",
                    "db_system",
                    "db_statement",
                    "db_name",
                    "rpc_method",
                    "rpc_service",
                ];
                for attr in SEMANTIC_ATTRS {
                    if final_schema.field_with_name(attr).is_ok()
                        && !should_skip_trace(attr)
                        && uds_fields.insert(attr.to_string())
                        && uds_fields.len() >= uds_max_fields
                    {
                        break;
                    }
                }

                // Add FTS fields if configured
                if uds_fields.len() < uds_max_fields {
                    for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
                        if final_schema.field_with_name(field).is_ok()
                            && !should_skip_trace(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }

                // Add remaining attributes from schema
                if uds_fields.len() < uds_max_fields {
                    for field in final_schema.fields() {
                        let field = field.name();
                        if !should_skip_trace(field)
                            && uds_fields.insert(field.to_string())
                            && uds_fields.len() >= uds_max_fields
                        {
                            break;
                        }
                    }
                }
            }
            _ => {}
        }

        defined_schema_fields = uds_fields.into_iter().collect::<Vec<_>>();
        stream_setting.defined_schema_fields = defined_schema_fields.clone();

        // CRITICAL: Add _all to full_text_search_keys when UDS is enabled
        // This allows queries on non-UDS fields to search inside the _all JSON column
        let cfg = get_config();
        if !stream_setting
            .full_text_search_keys
            .contains(&cfg.common.column_all)
        {
            stream_setting
                .full_text_search_keys
                .push(cfg.common.column_all.clone());
            log::info!(
                "[UDS AUTO-ENABLE] Added _all to full_text_search_keys for {}/{}/{}",
                org_id,
                stream_type,
                stream_name
            );
        }

        final_schema.metadata.insert(
            "settings".to_string(),
            json::to_string(&stream_setting).unwrap(),
        );

        log::info!(
            "[UDS AUTO-ENABLE] Selected {} fields for UDS: {:?}",
            defined_schema_fields.len(),
            defined_schema_fields.iter().take(10).collect::<Vec<_>>()
        );

        // save the new settings
        if let Err(e) = super::stream::save_stream_settings(
            org_id,
            stream_name,
            stream_type,
            stream_setting.clone(),
        )
        .await
        {
            log::error!("save_stream_settings [{org_id}/{stream_type}/{stream_name}] error: {e}");
        } else {
            log::info!(
                "[UDS AUTO-ENABLE] Successfully saved UDS settings for {}/{}/{}",
                org_id,
                stream_type,
                stream_name
            );
        }
    }

    // update node cache
    let final_schema = SchemaCache::new(final_schema);
    let mut w = STREAM_SCHEMAS_LATEST.write().await;
    w.insert(cache_key.clone(), final_schema.clone());
    drop(w);
    let need_original = stream_setting.store_original_data;
    let index_original_data = stream_setting.index_original_data;
    let index_all_values = stream_setting.index_all_values;
    if (need_original || index_original_data)
        && let dashmap::Entry::Vacant(entry) = STREAM_RECORD_ID_GENERATOR.entry(cache_key.clone())
    {
        entry.insert(SnowflakeIdGenerator::new(
            LOCAL_NODE_ID.load(Ordering::Relaxed),
        ));
    }
    let mut w = STREAM_SETTINGS.write().await;
    w.insert(cache_key.clone(), stream_setting);
    infra::schema::set_stream_settings_atomic(w.clone());
    drop(w);

    // update thread cache
    let final_schema = generate_schema_for_defined_schema_fields(
        &final_schema,
        &defined_schema_fields,
        need_original,
        index_original_data,
        index_all_values,
        stream_type,
    );
    stream_schema_map.insert(stream_name.to_string(), final_schema);

    log::debug!(
        "handle_diff_schema end for [{}/{}/{}] start_dt: {}, elapsed: {} ms",
        org_id,
        stream_type,
        stream_name,
        record_ts,
        start.elapsed().as_millis()
    );

    Ok(Some(SchemaEvolution {
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    }))
}

// Apply user-defined schema filtering regardless of field count
// This ensures UDS works even with small schemas (2-3 fields)
pub fn generate_schema_for_defined_schema_fields(
    schema: &SchemaCache,
    fields: &[String],
    need_original: bool,
    index_original_data: bool,
    index_all_values: bool,
    stream_type: StreamType,
) -> SchemaCache {
    // Only skip if no UDS fields are defined
    if fields.is_empty() {
        return schema.clone();
    }

    let cfg = get_config();
    let timestamp_col = TIMESTAMP_COL_NAME.to_string();
    let o2_id_col = ID_COL_NAME.to_string();
    let original_col = ORIGINAL_DATA_COL_NAME.to_string();
    let all_values_col = ALL_VALUES_COL_NAME.to_string();

    // Convert to Vec of owned Strings so we can add core fields
    let mut all_fields: Vec<String> = fields.to_vec();

    // Always include timestamp
    if !all_fields.contains(&timestamp_col) {
        all_fields.push(timestamp_col.clone());
    }

    // Always include _all column for UDS
    if !all_fields.contains(&cfg.common.column_all) {
        all_fields.push(cfg.common.column_all.to_string());
    }

    // Add core fields based on stream type
    // These fields are ALWAYS required for the stream to function correctly
    // We add them unconditionally - they'll be created with default types if missing from schema
    match stream_type {
        StreamType::Traces => {
            // Core trace fields from CORE_TRACE_FIELDS in traces/uds.rs
            // Note: These must match the CORE_TRACE_FIELDS constant in src/service/traces/uds.rs
            let core_trace_fields = [
                "trace_id",
                "span_id",
                "reference.parent_span_id",
                "reference.parent_trace_id",
                "reference.ref_type",
                "start_time",
                "end_time",
                "duration",
                "service_name",
                "operation_name",
                "span_kind",
                "span_status",
                "flags",
                "events",
                "links",
            ];
            for core_field in &core_trace_fields {
                if !all_fields.contains(&core_field.to_string()) {
                    all_fields.push(core_field.to_string());
                }
            }
        }
        StreamType::Metrics => {
            // Core metric fields from CORE_METRIC_FIELDS in metrics/uds.rs
            let core_metric_fields = [
                "__name__",
                "__type__",
                "__hash__",
                "value",
                "le",
                "quantile",
                "exemplars",
            ];
            for core_field in &core_metric_fields {
                if !all_fields.contains(&core_field.to_string()) {
                    all_fields.push(core_field.to_string());
                }
            }
        }
        _ => {
            // For logs and other types, no special core fields needed beyond timestamp
        }
    }

    if need_original || index_original_data {
        if !all_fields.contains(&o2_id_col) {
            all_fields.push(o2_id_col.clone());
        }
        if !all_fields.contains(&original_col) {
            all_fields.push(original_col.clone());
        }
    }
    if index_all_values && !all_fields.contains(&all_values_col) {
        all_fields.push(all_values_col.clone());
    }

    let mut new_fields = Vec::with_capacity(all_fields.len());
    let mut missing_core_fields = Vec::new();

    for field in &all_fields {
        if let Some(f) = schema.fields_map().get(field) {
            new_fields.push(schema.schema().fields()[*f].clone());
        } else {
            // Field requested but not in current schema
            // Check if this is a missing core field that we should add with default type
            let field_name = field.as_str();
            let is_core_field_missing = match stream_type {
                StreamType::Traces => {
                    matches!(
                        field_name,
                        "trace_id"
                            | "span_id"
                            | "reference.parent_span_id"
                            | "reference.parent_trace_id"
                            | "reference.ref_type"
                            | "start_time"
                            | "end_time"
                            | "duration"
                            | "service_name"
                            | "operation_name"
                            | "span_kind"
                            | "span_status"
                            | "flags"
                            | "events"
                            | "links"
                    )
                }
                StreamType::Metrics => {
                    matches!(
                        field_name,
                        "__name__"
                            | "__type__"
                            | "__hash__"
                            | "value"
                            | "le"
                            | "quantile"
                            | "exemplars"
                    )
                }
                _ => false,
            };

            if is_core_field_missing {
                // Add missing core field with string type (most common/safe default)
                missing_core_fields.push(field.clone());
                new_fields.push(Field::new(field, DataType::Utf8, true).into());
            }
        }
    }

    if !missing_core_fields.is_empty() {
        log::warn!(
            "Added {} missing core fields to schema (stream_type: {})",
            missing_core_fields.len(),
            stream_type
        );
    }

    // sort the fields by name to make sure the order is consistent
    new_fields.sort_by(|a, b| a.name().cmp(b.name()));

    SchemaCache::new(Schema::new_with_metadata(
        new_fields,
        schema.schema().metadata().clone(),
    ))
}

pub fn get_schema_changes(schema: &SchemaCache, inferred_schema: &Schema) -> (bool, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<Field> = vec![];

    let stream_setting = unwrap_stream_settings(schema.schema());
    let defined_schema_fields = stream_setting
        .map(|s| s.defined_schema_fields)
        .unwrap_or_default();

    // Define core fields for each stream type
    let trace_core_fields = [
        "trace_id",
        "span_id",
        "reference.parent_span_id",
        "reference.parent_trace_id",
        "reference.ref_type",
        "start_time",
        "end_time",
        "duration",
        "service_name",
        "operation_name",
        "span_kind",
        "span_status",
        "flags",
        "events",
        "links",
    ];
    let metric_core_fields = [
        "__name__",
        "__type__",
        "__hash__",
        "value",
        "le",
        "quantile",
        "exemplars",
    ];

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match schema.fields_map().get(item_name) {
            None => {
                is_schema_changed = true;
                log::info!("[SCHEMA DEBUG] New field detected: {}", item_name);
            }
            Some(idx) => {
                // When UDS is enabled, skip fields that are not in the UDS list
                // BUT: Never skip core fields - they must always be checked
                if !defined_schema_fields.is_empty() && !defined_schema_fields.contains(item_name) {
                    // Check if this is a core field that should never be skipped
                    let cfg = get_config();
                    let is_trace_core = trace_core_fields.contains(&item_name.as_str());
                    let is_metric_core = metric_core_fields.contains(&item_name.as_str());
                    let is_generic_core = item_name == "_timestamp"
                        || item_name == cfg.common.column_all.as_str()
                        || item_name == ID_COL_NAME
                        || item_name == ORIGINAL_DATA_COL_NAME
                        || item_name == ALL_VALUES_COL_NAME;

                    let is_core_field = is_trace_core || is_metric_core || is_generic_core;

                    if !is_core_field {
                        log::debug!("[SCHEMA DEBUG] Skipping non-UDS field: {}", item_name);
                        continue;
                    }

                    log::info!(
                        "[SCHEMA DEBUG] NOT skipping core field: {} (trace={}, metric={}, generic={})",
                        item_name,
                        is_trace_core,
                        is_metric_core,
                        is_generic_core
                    );
                }
                let existing_field: Arc<Field> = schema.schema().fields()[*idx].clone();
                if existing_field.data_type() != item_data_type {
                    if infra::schema::is_widening_conversion(
                        existing_field.data_type(),
                        item_data_type,
                    ) {
                        is_schema_changed = true;
                        field_datatype_delta.push((**item).clone());
                    } else {
                        let mut meta = existing_field.metadata().clone();
                        meta.insert("zo_cast".to_owned(), true.to_string());
                        field_datatype_delta
                            .push(existing_field.as_ref().clone().with_metadata(meta));
                    }
                }
            }
        }
    }

    (is_schema_changed, field_datatype_delta)
}

pub async fn stream_schema_exists(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> StreamSchemaChk {
    let mut schema_chk = StreamSchemaChk {
        conforms: true,
        has_fields: false,
        has_partition_keys: false,
        has_metadata: false,
    };
    let schema = match stream_schema_map.get(stream_name) {
        Some(schema) => schema.schema().clone(),
        None => {
            let schema_cache = infra::schema::get_cache(org_id, stream_name, stream_type)
                .await
                .unwrap();
            let db_schema = schema_cache.schema().clone();
            stream_schema_map.insert(stream_name.to_string(), schema_cache);
            db_schema
        }
    };
    if !schema.fields().is_empty() {
        schema_chk.has_fields = true;
    }

    let settings = unwrap_stream_settings(&schema);
    if let Some(stream_setting) = settings
        && !stream_setting.partition_keys.is_empty()
    {
        schema_chk.has_partition_keys = true;
    }
    if schema.metadata().contains_key(METADATA_LABEL) {
        schema_chk.has_metadata = true;
    }
    schema_chk
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use datafusion::arrow::datatypes::DataType;

    use super::*;

    #[tokio::test]
    async fn test_check_for_schema() {
        let stream_name = "Sample";
        let org_name = "nexus";
        let record: json::Value =
            json::from_str(r#"{"Year": 1896, "City": "Athens", "_timestamp": 1234234234234}"#)
                .unwrap();

        let schema = Schema::new(vec![
            Field::new("Year", DataType::Int64, false),
            Field::new("City", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]);
        let mut map: HashMap<String, SchemaCache> = HashMap::new();

        map.insert(stream_name.to_string(), SchemaCache::new(schema));
        let (result, _) = check_for_schema(
            org_name,
            stream_name,
            StreamType::Logs,
            &mut map,
            vec![record.as_object().unwrap()],
            1234234234234,
            false,
        )
        .await
        .unwrap();
        assert!(!result.is_schema_changed);
    }

    #[tokio::test]
    async fn test_infer_schema() {
        let mut record_val: Vec<&Map<String, Value>> = vec![];

        let record1: serde_json::Value = serde_json::Value::from_str(
            r#"{"Year": 1896.99, "City": "Athens", "_timestamp": 1234234234234}"#,
        )
        .unwrap();
        record_val.push(record1.as_object().unwrap());

        let record: serde_json::Value = serde_json::Value::from_str(
            r#"{"Year": 1896, "City": "Athens", "_timestamp": 1234234234234}"#,
        )
        .unwrap();
        record_val.push(record.as_object().unwrap());
        let stream_type = StreamType::Logs;
        let value_iter = record_val.into_iter();
        infer_json_schema_from_map(value_iter, stream_type).unwrap();
    }
}
