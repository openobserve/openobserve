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

use std::{
    collections::HashMap,
    sync::{Arc, atomic::Ordering},
};

use anyhow::Result;
use arrow_schema::{Field, Schema};
use common::meta::{authz::Authz, stream::SchemaEvolution};
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, SQL_FULL_TEXT_SEARCH_FIELDS,
    SQL_SECONDARY_INDEX_SEARCH_FIELDS, TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE_ID,
    get_config,
    ider::SnowflakeIdGenerator,
    is_uds_internal_column,
    meta::{
        promql::{
            BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, METADATA_LABEL, NAME_LABEL, QUANTILE_LABEL,
            VALUE_LABEL,
        },
        stream::{StreamSettings, StreamType},
    },
    metrics,
    utils::{
        json,
        schema::{infer_json_schema_from_map, schema_eq},
        schema_ext::SchemaExt,
        time::now_micros,
    },
};
#[cfg(feature = "enterprise")]
use config::{META_ORG_ID, meta::self_reporting::usage::USAGE_STREAM};
use hashbrown::HashSet;
use infra::schema::{
    STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS, SchemaCache,
    unwrap_stream_settings,
};
use ingestion_common::StreamSchemaChk;
use serde_json::{Map, Value};

mod watcher;

pub use watcher::{
    OrganizationProvisioner, SchemaWatcher, create_watcher, set_organization_provisioner,
};

const SCHEMA_CONFORMANCE_FAILED: &str = "schema_conformance_failed";

pub fn get_upto_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        get_config().limit.ingest_allowed_upto
    )
}

pub fn get_future_discard_error() -> anyhow::Error {
    anyhow::anyhow!(
        "Too far data, only future {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_IN_FUTURE=<max_hours>",
        get_config().limit.ingest_allowed_in_future
    )
}

pub fn get_request_columns_limit_error(stream_name: &str, num_fields: usize) -> anyhow::Error {
    anyhow::anyhow!(
        "Got {num_fields} columns for stream {stream_name}, only {} columns accept. Data discarded. You can adjust ingestion columns limit by setting the environment variable ZO_COLS_PER_RECORD_LIMIT=<max_columns>",
        get_config().limit.req_cols_per_record_limit
    )
}

#[derive(Debug)]
pub enum StreamSettingsError {
    StreamDeleting(String),
    BadRequest(String),
    NotFound(String),
}

impl std::fmt::Display for StreamSettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StreamDeleting(message) | Self::BadRequest(message) | Self::NotFound(message) => {
                f.write_str(message)
            }
        }
    }
}

impl std::error::Error for StreamSettingsError {}

pub struct SavedStreamSettings {
    pub settings: StreamSettings,
    pub previous_settings: Option<StreamSettings>,
}

/// Validate, normalize, and persist stream settings stored in schema metadata.
///
/// This is the canonical settings write path for both the stream service and schema
/// auto-evolution. Callers should only publish the returned settings to local caches after this
/// function succeeds.
pub async fn save_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    mut settings: StreamSettings,
) -> std::result::Result<SavedStreamSettings, StreamSettingsError> {
    validate_stream_settings(org_id, stream_name, stream_type, &mut settings)?;
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .map_err(|_| StreamSettingsError::NotFound("stream not found".to_string()))?;
    persist_stream_settings(org_id, stream_name, stream_type, &schema, settings).await
}

async fn save_stream_settings_with_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    mut settings: StreamSettings,
) -> std::result::Result<SavedStreamSettings, StreamSettingsError> {
    validate_stream_settings(org_id, stream_name, stream_type, &mut settings)?;
    persist_stream_settings(org_id, stream_name, stream_type, schema, settings).await
}

/// Settings-level validation that does not need the stored schema. Runs before the schema fetch
/// so invalid settings are rejected as bad-request even when the stream doesn't exist.
fn validate_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    settings: &mut StreamSettings,
) -> std::result::Result<(), StreamSettingsError> {
    if db::compact::retention::is_deleting_stream(org_id, stream_type, stream_name, None) {
        return Err(StreamSettingsError::StreamDeleting(format!(
            "stream [{stream_name}] is being deleted"
        )));
    }

    if !stream_type.support_uds() && !settings.defined_schema_fields.is_empty() {
        return Err(StreamSettingsError::BadRequest(format!(
            "stream type [{stream_type}] don't support user defined schema"
        )));
    }

    if settings.data_retention > 0
        && settings.data_retention < 30
        && settings.storage_type.is_compliance()
    {
        return Err(StreamSettingsError::BadRequest(
            "data_retention must be at least 30 days when storage_type is compliance".to_string(),
        ));
    }

    #[cfg(feature = "enterprise")]
    if org_id == META_ORG_ID && stream_name == USAGE_STREAM && settings.data_retention < 32 {
        settings.data_retention = 0;
    }

    if settings.index_original_data {
        settings.store_original_data = true;
    }
    if settings.index_original_data && settings.index_all_values {
        return Err(StreamSettingsError::BadRequest(
            "index_original_data & index_all_values cannot be true at the same time".to_string(),
        ));
    }

    Ok(())
}

async fn persist_stream_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    mut settings: StreamSettings,
) -> std::result::Result<SavedStreamSettings, StreamSettingsError> {
    let cfg = get_config();
    let schema_fields = schema
        .fields()
        .iter()
        .map(|field| field.name())
        .collect::<HashSet<_>>();
    let previous_settings = unwrap_stream_settings(schema);

    normalize_stream_settings(&mut settings);

    if !settings.defined_schema_fields.is_empty() {
        let fields = check_schema_for_defined_schema_fields(
            stream_type,
            schema,
            std::mem::take(&mut settings.defined_schema_fields),
        );
        let mut fields = fields.into_iter().collect::<Vec<_>>();
        fields.sort_unstable();
        fields.retain(|field| schema_fields.contains(field));
        settings.defined_schema_fields = fields;
    }

    let uds_user_fields = settings
        .defined_schema_fields
        .iter()
        .filter(|field| !is_uds_internal_column(field))
        .count();
    if uds_user_fields > cfg.limit.user_defined_schema_max_fields {
        return Err(StreamSettingsError::BadRequest(format!(
            "user defined schema fields count exceeds the limit: {}",
            cfg.limit.user_defined_schema_max_fields
        )));
    }

    let fts_set = settings
        .full_text_search_keys
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let index_set = settings
        .index_fields
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let bloom_set = settings
        .bloom_filter_fields
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    let pk_set = settings
        .partition_keys
        .iter()
        .map(|partition| partition.field.clone())
        .collect::<HashSet<_>>();

    let strict_reserved = [TIMESTAMP_COL_NAME, cfg.common.column_all.as_str()];
    let no_search_reserved = [ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME];
    for &reserved in strict_reserved.iter().chain(no_search_reserved.iter()) {
        if index_set.contains(reserved) {
            return Err(StreamSettingsError::BadRequest(format!(
                "field [{reserved}] is reserved and cannot be used for secondary index"
            )));
        }
        if bloom_set.contains(reserved) {
            return Err(StreamSettingsError::BadRequest(format!(
                "field [{reserved}] is reserved and cannot be used for bloom filter"
            )));
        }
        if pk_set.contains(reserved) {
            return Err(StreamSettingsError::BadRequest(format!(
                "field [{reserved}] is reserved and cannot be used as partition key"
            )));
        }
    }
    for &reserved in &strict_reserved {
        if fts_set.contains(reserved) {
            return Err(StreamSettingsError::BadRequest(format!(
                "field [{reserved}] is reserved and cannot be used for full text search"
            )));
        }
    }

    if let Some(name) = fts_set.intersection(&index_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "field [{name}] cannot be both full text search and secondary index — choose one"
        )));
    }
    if let Some(name) = fts_set.intersection(&bloom_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "field [{name}] cannot be both full text search and bloom filter"
        )));
    }
    if let Some(name) = bloom_set.difference(&index_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "bloom filter field [{name}] must also be a secondary index field"
        )));
    }
    if let Some(name) = pk_set.intersection(&fts_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "partition key [{name}] cannot also be a full text search field"
        )));
    }
    if let Some(name) = pk_set.intersection(&index_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "partition key [{name}] cannot also be a secondary index field"
        )));
    }
    if let Some(name) = pk_set.intersection(&bloom_set).next() {
        return Err(StreamSettingsError::BadRequest(format!(
            "partition key [{name}] cannot also be a bloom filter field"
        )));
    }

    let mut old_partition_keys = previous_settings
        .as_ref()
        .map(|previous| previous.partition_keys.clone())
        .unwrap_or_default();
    for partition in &mut old_partition_keys {
        partition.disabled = true;
    }
    for partition in &settings.partition_keys {
        if let Some(old_partition) = old_partition_keys
            .iter_mut()
            .find(|old| old.field == partition.field)
        {
            if old_partition.types != partition.types {
                return Err(StreamSettingsError::BadRequest(format!(
                    "field [{}] partition types can't be changed",
                    partition.field
                )));
            }
            old_partition.disabled = partition.disabled;
        } else {
            old_partition_keys.push(partition.clone());
        }
    }
    settings.partition_keys = old_partition_keys;

    if settings
        .extended_retention_days
        .iter()
        .any(|range| range.start > range.end)
    {
        return Err(StreamSettingsError::BadRequest(
            "start day should be less than end day".to_string(),
        ));
    }

    let mut metadata = schema.metadata.clone();
    metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
    if !metadata.contains_key("created_at") {
        metadata.insert("created_at".to_string(), now_micros().to_string());
    }
    db::schema::update_setting(org_id, stream_name, stream_type, metadata)
        .await
        .unwrap();

    Ok(SavedStreamSettings {
        settings,
        previous_settings,
    })
}

/// Make stream settings internally consistent before validation and persistence.
fn normalize_stream_settings(settings: &mut StreamSettings) {
    dedup_preserve_order(&mut settings.full_text_search_keys);
    dedup_preserve_order(&mut settings.index_fields);
    dedup_preserve_order(&mut settings.bloom_filter_fields);
    dedup_preserve_order(&mut settings.defined_schema_fields);

    let mut seen = HashSet::new();
    settings
        .partition_keys
        .retain(|partition| seen.insert(partition.field.clone()));
    seen.clear();
    settings
        .distinct_value_fields
        .retain(|field| seen.insert(field.name.clone()));
    seen.clear();
    settings
        .extended_retention_days
        .retain(|range| seen.insert(range.to_string()));
    seen.clear();
    settings
        .cross_links
        .retain(|link| seen.insert(link.to_string()));

    let missing_index = settings
        .bloom_filter_fields
        .iter()
        .filter(|field| !settings.index_fields.contains(field))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_index.is_empty() {
        let now = now_micros();
        for field in &missing_index {
            settings.index_fields_updated_at.insert(field.clone(), now);
        }
        settings.index_fields.extend(missing_index);
    }

    if !settings.index_fields_updated_at.is_empty() {
        let indexed = settings
            .full_text_search_keys
            .iter()
            .chain(settings.index_fields.iter())
            .cloned()
            .collect::<HashSet<_>>();
        settings
            .index_fields_updated_at
            .retain(|field, _| indexed.contains(field));
    }
}

fn dedup_preserve_order(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
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
    let inferred_schema = infer_json_schema_from_map(stream_name, stream_type, value_iter)?;

    // fast path
    if schema_eq(schema.schema(), &inferred_schema) {
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
                    stream_type,
                    schema,
                    &defined_schema_fields,
                    need_original,
                    index_original_data,
                    index_all_values,
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
pub async fn handle_diff_schema(
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
                    "handle_diff_schema [{org_id}/{stream_type}/{stream_name}] with hash {}, start_dt {record_ts}, error: {e}, retrying...{retries}",
                    inferred_schema.hash_key(),
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
            "handle_diff_schema [{org_id}/{stream_type}/{stream_name}] with hash {}, start_dt {record_ts}, abort after retry {retries} times, error: {e}",
            inferred_schema.hash_key(),
        );
        return Err(e);
    }
    let Some((mut final_schema, field_datatype_delta)) = ret else {
        return Ok(None);
    };

    if is_new {
        db::authz::set_ownership(org_id, stream_type.as_str(), Authz::new(stream_name)).await;
    }

    // check defined_schema_fields
    let mut stream_setting = unwrap_stream_settings(&final_schema).unwrap_or_default();
    let mut defined_schema_fields = stream_setting.defined_schema_fields.clone();

    // Automatically enable User-defined schema when
    // 1. allow_user_defined_schemas is enabled
    // 2. log ingestion
    // 3. user defined schema is not already enabled
    // 4. final schema fields count exceeds schema_max_fields_to_enable_uds
    // Internal columns are implicit in the UDS: never persisted and never
    // occupy slots in the field list (see is_uds_internal_column).
    if cfg.common.allow_user_defined_schemas
        && cfg.limit.schema_max_fields_to_enable_uds > 0
        && stream_type.support_uds()
        && defined_schema_fields.is_empty()
        && final_schema.fields().len() > cfg.limit.schema_max_fields_to_enable_uds
    {
        let mut uds_fields = HashSet::with_capacity(cfg.limit.schema_max_fields_to_enable_uds);

        // Fields that must survive auto-enable
        let mut keep_fields =
            check_schema_for_defined_schema_fields(stream_type, &final_schema, vec![]);
        // add FTS fields (default SQL FTS fields)
        for field in SQL_FULL_TEXT_SEARCH_FIELDS.iter() {
            keep_fields.insert(field.to_string());
        }
        // add secondary index fields (default SQL secondary index fields)
        for field in SQL_SECONDARY_INDEX_SEARCH_FIELDS.iter() {
            keep_fields.insert(field.to_string());
        }
        // add user-configured FTS fields
        for field in stream_setting.full_text_search_keys.iter() {
            keep_fields.insert(field.to_string());
        }
        // add user-configured index fields
        for field in stream_setting.index_fields.iter() {
            keep_fields.insert(field.to_string());
        }

        // Add keep fields first
        for field in keep_fields {
            if !is_uds_internal_column(&field) && final_schema.field_with_name(&field).is_ok() {
                uds_fields.insert(field);
            }
        }

        // Add fields from current schema if available
        if let Some(stream_schema) = stream_schema_map.get(stream_name) {
            for field in stream_schema.schema().fields() {
                let field = field.name();
                if is_uds_internal_column(field) {
                    continue;
                }
                if uds_fields.insert(field.to_string())
                    && uds_fields.len() >= cfg.limit.schema_max_fields_to_enable_uds
                {
                    break;
                }
            }
        }

        // Add remaining fields from final schema
        if uds_fields.len() < cfg.limit.schema_max_fields_to_enable_uds {
            for field in final_schema.fields() {
                let field = field.name();
                if is_uds_internal_column(field) {
                    continue;
                }
                if uds_fields.insert(field.to_string())
                    && uds_fields.len() >= cfg.limit.schema_max_fields_to_enable_uds
                {
                    break;
                }
            }
        }

        let mut candidate_settings = stream_setting.clone();
        candidate_settings.defined_schema_fields = uds_fields.into_iter().collect();
        match save_stream_settings_with_schema(
            org_id,
            stream_name,
            stream_type,
            &final_schema,
            candidate_settings,
        )
        .await
        {
            Ok(saved) => {
                stream_setting = saved.settings;
                defined_schema_fields = stream_setting.defined_schema_fields.clone();
                final_schema.metadata.insert(
                    "settings".to_string(),
                    json::to_string(&stream_setting).unwrap(),
                );
            }
            Err(e) => {
                log::warn!("skip auto UDS settings [{org_id}/{stream_type}/{stream_name}]: {e}");
            }
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
        stream_type,
        &final_schema,
        &defined_schema_fields,
        need_original,
        index_original_data,
        index_all_values,
    );
    stream_schema_map.insert(stream_name.to_string(), final_schema);

    log::debug!(
        "handle_diff_schema end for [{org_id}/{stream_type}/{stream_name}] start_dt: {record_ts}, elapsed: {} ms",
        start.elapsed().as_millis()
    );

    Ok(Some(SchemaEvolution {
        is_schema_changed: true,
        types_delta: Some(field_datatype_delta),
    }))
}

// Generate filtered schema for UDS (User Defined Schema)
// if defined_schema_fields is not empty, and schema fields greater than defined_schema_fields + 10,
// then we will use defined_schema_fields
pub fn generate_schema_for_defined_schema_fields(
    stream_type: StreamType,
    schema: &SchemaCache,
    fields: &[String],
    need_original: bool,
    index_original_data: bool,
    index_all_values: bool,
) -> SchemaCache {
    if fields.is_empty() || schema.fields_map().len() < fields.len() + 10 {
        return schema.clone();
    }

    let cfg = get_config();
    let mut fields =
        check_schema_for_defined_schema_fields(stream_type, schema.schema(), fields.to_vec());
    fields.insert(TIMESTAMP_COL_NAME.to_string());
    fields.insert(cfg.common.column_all.to_string());
    if need_original || index_original_data {
        fields.insert(ID_COL_NAME.to_string());
        fields.insert(ORIGINAL_DATA_COL_NAME.to_string());
    }
    if index_all_values {
        fields.insert(ALL_VALUES_COL_NAME.to_string());
    }

    let mut new_fields = Vec::with_capacity(fields.len());
    for field in fields {
        if let Some(f) = schema.fields_map().get(&field) {
            new_fields.push(schema.schema().fields()[*f].clone());
        }
    }

    // sort the fields by name to make sure the order is consistent
    new_fields.sort_by(|a, b| a.name().cmp(b.name()));

    SchemaCache::new(Schema::new_with_metadata(
        new_fields,
        schema.schema().metadata().clone(),
    ))
}

pub fn check_schema_for_defined_schema_fields(
    stream_type: StreamType,
    schema: &Schema,
    fields: Vec<String>,
) -> HashSet<String> {
    let mut fields: HashSet<String> = fields.into_iter().collect();
    match stream_type {
        StreamType::Logs => {}
        StreamType::Metrics => {
            fields.insert(NAME_LABEL.to_string());
            fields.insert(HASH_LABEL.to_string());
            fields.insert(BUCKET_LABEL.to_string());
            fields.insert(QUANTILE_LABEL.to_string());
            fields.insert(EXEMPLARS_LABEL.to_string());
            fields.insert(VALUE_LABEL.to_string());
            fields.insert("trace_id".to_string());
            fields.insert("span_id".to_string());
        }
        StreamType::Traces => {
            fields.insert("service_name".to_string());
            fields.insert("operation_name".to_string());
            fields.insert("trace_id".to_string());
            fields.insert("span_id".to_string());
            fields.insert("span_kind".to_string());
            fields.insert("span_status".to_string());
            fields.insert("reference_parent_span_id".to_string());
            fields.insert("reference_parent_trace_id".to_string());
            fields.insert("reference_ref_type".to_string());
            fields.insert("start_time".to_string());
            fields.insert("end_time".to_string());
            fields.insert("duration".to_string());
            fields.insert("events".to_string());
            // Automatically include all OTEL Gen-AI and LLM evaluation fields from the schema
            for field in schema.fields() {
                let name = field.name();
                if name.starts_with("gen_ai_")
                    || name.starts_with("llm_")
                    || name == "user_id"
                    || name == "session_id"
                {
                    fields.insert(name.to_string());
                }
            }
        }
        _ => {}
    }
    fields
}

pub fn get_schema_changes(schema: &SchemaCache, inferred_schema: &Schema) -> (bool, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<Field> = vec![];

    let stream_setting = unwrap_stream_settings(schema.schema());
    let defined_schema_fields = stream_setting
        .map(|s| s.defined_schema_fields)
        .unwrap_or_default();

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match schema.fields_map().get(item_name) {
            None => {
                is_schema_changed = true;
            }
            Some(idx) => {
                if !defined_schema_fields.is_empty() && !defined_schema_fields.contains(item_name) {
                    continue;
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
        has_metrics_metadata: false,
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
        schema_chk.has_metrics_metadata = true;
    }
    schema_chk
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use arrow_schema::DataType;

    use super::*;

    #[test]
    fn test_normalize_stream_settings_index_fields_updated_at() {
        let mut settings = StreamSettings {
            index_fields: vec!["a".to_string(), "a".to_string()],
            bloom_filter_fields: vec!["b".to_string(), "b".to_string()],
            ..Default::default()
        };
        settings
            .index_fields_updated_at
            .insert("a".to_string(), 100);
        settings
            .index_fields_updated_at
            .insert("removed".to_string(), 200);

        normalize_stream_settings(&mut settings);

        assert_eq!(settings.index_fields, vec!["a", "b"]);
        assert_eq!(settings.bloom_filter_fields, vec!["b"]);
        assert!(
            settings
                .index_fields_updated_at
                .get("b")
                .is_some_and(|value| *value > 0)
        );
        assert!(!settings.index_fields_updated_at.contains_key("removed"));
        assert_eq!(settings.index_fields_updated_at.get("a"), Some(&100));
    }

    #[test]
    fn test_generate_schema_for_defined_schema_fields_includes_internal_columns() {
        // internal columns must be part of the effective schema even when they
        // are not persisted in defined_schema_fields
        let mut fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, true),
            Field::new(
                get_config().common.column_all.as_str(),
                DataType::Utf8,
                true,
            ),
            Field::new(ID_COL_NAME, DataType::Utf8, true),
            Field::new(ORIGINAL_DATA_COL_NAME, DataType::Utf8, true),
            Field::new(ALL_VALUES_COL_NAME, DataType::Utf8, true),
        ];
        for i in 0..15 {
            fields.push(Field::new(format!("field{i}"), DataType::Utf8, true));
        }
        let schema = SchemaCache::new(Schema::new(fields));
        let defined_fields = vec!["field0".to_string(), "field1".to_string()];

        let result = generate_schema_for_defined_schema_fields(
            StreamType::Logs,
            &schema,
            &defined_fields,
            true,
            false,
            true,
        );
        let names: Vec<_> = result
            .schema()
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();
        assert!(names.contains(&TIMESTAMP_COL_NAME.to_string()));
        assert!(names.contains(&get_config().common.column_all));
        assert!(names.contains(&ID_COL_NAME.to_string()));
        assert!(names.contains(&ORIGINAL_DATA_COL_NAME.to_string()));
        assert!(names.contains(&ALL_VALUES_COL_NAME.to_string()));
        assert!(names.contains(&"field0".to_string()));
        assert!(names.contains(&"field1".to_string()));
        assert!(!names.contains(&"field2".to_string()));
    }

    #[test]
    fn test_check_schema_for_defined_schema_fields_logs() {
        let schema = Schema::new(vec![] as Vec<Field>);
        let input = vec!["level".to_string(), "message".to_string()];
        let result = check_schema_for_defined_schema_fields(StreamType::Logs, &schema, input);
        assert!(result.contains("level"));
        assert!(result.contains("message"));
    }

    #[test]
    fn test_check_schema_for_defined_schema_fields_metrics_adds_labels() {
        let schema = Schema::new(vec![] as Vec<Field>);
        let input = vec!["custom_field".to_string()];
        let result =
            check_schema_for_defined_schema_fields(StreamType::Metrics, &schema, input.clone());
        // Metrics should include the special labels
        assert!(result.contains(NAME_LABEL));
        assert!(result.contains(HASH_LABEL));
        assert!(result.contains(VALUE_LABEL));
        assert!(result.contains("custom_field"));
        assert!(result.contains("trace_id"));
    }

    #[test]
    fn test_check_schema_for_defined_schema_fields_traces_adds_trace_fields() {
        let schema = Schema::new(vec![] as Vec<Field>);
        let input = vec!["my_field".to_string()];
        let result = check_schema_for_defined_schema_fields(StreamType::Traces, &schema, input);
        assert!(result.contains("trace_id"));
        assert!(result.contains("span_id"));
        assert!(result.contains("service_name"));
        assert!(result.contains("duration"));
        assert!(result.contains("my_field"));
    }

    #[test]
    fn test_check_schema_for_defined_schema_fields_traces_includes_gen_ai_fields() {
        let schema = Schema::new(vec![
            Field::new("gen_ai_prompt", DataType::Utf8, true),
            Field::new("llm_model", DataType::Utf8, true),
            Field::new("other_field", DataType::Utf8, true),
        ]);
        let result = check_schema_for_defined_schema_fields(StreamType::Traces, &schema, vec![]);
        assert!(result.contains("gen_ai_prompt"));
        assert!(result.contains("llm_model"));
        // "other_field" has no gen_ai_ or llm_ prefix → not auto-included
        assert!(!result.contains("other_field"));
    }

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
        infer_json_schema_from_map("test", stream_type, value_iter).unwrap();
    }
}
