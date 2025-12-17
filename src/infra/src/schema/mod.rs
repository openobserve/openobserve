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

use std::{collections::HashMap, sync::Arc};

use arc_swap::ArcSwap;
use chrono::Utc;
use config::{
    ALL_VALUES_COL_NAME, BLOOM_FILTER_DEFAULT_FIELDS, ORIGINAL_DATA_COL_NAME, RwAHashMap,
    RwHashMap, RwHashSet, SQL_FULL_TEXT_SEARCH_FIELDS, SQL_SECONDARY_INDEX_SEARCH_FIELDS,
    get_config,
    ider::SnowflakeIdGenerator,
    meta::stream::{PartitionTimeLevel, StreamSettings, StreamType},
    utils::{json, schema_ext::SchemaExt, time::now_micros},
};
use datafusion::arrow::datatypes::{DataType, Field, FieldRef, Schema, SchemaRef};
use once_cell::sync::Lazy;
use serde::Serialize;

use crate::{
    db as infra_db,
    errors::{DbError, Error, Result},
};

pub mod history;

pub static STREAM_SCHEMAS: Lazy<RwAHashMap<String, Vec<(i64, Schema)>>> =
    Lazy::new(Default::default);
pub static STREAM_SCHEMAS_LATEST: Lazy<RwAHashMap<String, SchemaCache>> =
    Lazy::new(Default::default);
pub static STREAM_SETTINGS: Lazy<RwAHashMap<String, StreamSettings>> = Lazy::new(Default::default);
/// Used for filtering records when a stream is configured to store original unflattened records
/// use a RwHashMap instead of RwAHashMap because of high write ratio as
/// SnowflakeIdGenerator::generate() requires a &mut
pub static STREAM_RECORD_ID_GENERATOR: Lazy<RwHashMap<String, SnowflakeIdGenerator>> =
    Lazy::new(Default::default);
/// Cache if the stream stats exist, used for calculating stats
pub static STREAM_STATS_EXISTS: Lazy<RwHashSet<String>> = Lazy::new(Default::default);

// atomic version of cache
type StreamSettingsCache = hashbrown::HashMap<String, StreamSettings>;
static STREAM_SETTINGS_ATOMIC: Lazy<ArcSwap<StreamSettingsCache>> =
    Lazy::new(|| ArcSwap::from(Arc::new(hashbrown::HashMap::new())));

pub const SCHEMA_KEY: &str = "/schema/";

pub async fn init() -> Result<()> {
    history::init().await?;
    Ok(())
}

pub fn get_stream_settings_atomic(key: &str) -> Option<StreamSettings> {
    STREAM_SETTINGS_ATOMIC.load().get(key).cloned()
}

pub fn set_stream_settings_atomic(settings: StreamSettingsCache) {
    STREAM_SETTINGS_ATOMIC.store(Arc::new(settings));
}

pub async fn get_stream_schema_from_cache(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Option<Schema> {
    let key = mk_key(org_id, stream_type, stream_name);
    let cache_key = key.strip_prefix(SCHEMA_KEY).unwrap();
    STREAM_SCHEMAS_LATEST
        .read()
        .await
        .get(cache_key)
        .map(|schema| schema.schema().as_ref().clone())
}

pub fn mk_key(org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    format!("{SCHEMA_KEY}{org_id}/{stream_type}/{stream_name}")
}

pub async fn get(org_id: &str, stream_name: &str, stream_type: StreamType) -> Result<Schema> {
    let schema = get_cache(org_id, stream_name, stream_type).await?;
    Ok(schema.schema().as_ref().clone())
}

pub async fn get_cache(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<SchemaCache> {
    let key = mk_key(org_id, stream_type, stream_name);
    let cache_key = key.strip_prefix(SCHEMA_KEY).unwrap();
    if let Some(schema) = STREAM_SCHEMAS_LATEST.read().await.get(cache_key).cloned() {
        return Ok(schema);
    }

    // Get from DB without holding any locks
    let db_schema = get_from_db(org_id, stream_name, stream_type).await?;
    // if the schema is empty, return an empty schema , Don't write to cache
    if db_schema.fields().is_empty() && db_schema.metadata().is_empty() {
        return Ok(SchemaCache::new(db_schema));
    }
    let schema = SchemaCache::new(db_schema);

    // Only acquire write lock after DB read is complete
    let mut write_guard = STREAM_SCHEMAS_LATEST.write().await;
    // Check again before inserting in case another thread updated while we were reading DB
    if let Some(schema) = write_guard.get(cache_key) {
        Ok(schema.clone())
    } else {
        write_guard.insert(cache_key.to_string(), schema.clone());
        Ok(schema)
    }
}

pub async fn get_from_db(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<Schema> {
    let key = mk_key(org_id, stream_type, stream_name);
    let db = infra_db::get_db().await;
    Ok(match db.get(&key).await {
        Err(e) => {
            if let Error::DbError(DbError::KeyNotExists(_)) = e {
                Schema::empty()
            } else {
                return Err(Error::Message(format!("Error getting schema: {e}")));
            }
        }
        Ok(v) => {
            let schemas: Result<Vec<Schema>> = json::from_slice(&v).map_err(|e| e.into());
            if let Ok(mut schemas) = schemas {
                if schemas.is_empty() {
                    Schema::empty()
                } else {
                    schemas.remove(schemas.len() - 1)
                }
            } else {
                json::from_slice(&v)?
            }
        }
    })
}

#[tracing::instrument(name = "infra:schema:get_versions", skip_all)]
pub async fn get_versions(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<Schema>> {
    let key = mk_key(org_id, stream_type, stream_name);
    let cache_key = key.strip_prefix(SCHEMA_KEY).unwrap();

    let (min_ts, max_ts) = time_range.unwrap_or_default();
    let mut last_schema_index = None;
    let r = STREAM_SCHEMAS.read().await;
    if let Some(versions) = r.get(cache_key) {
        let mut schemas = Vec::new();

        for (index, (start_dt, data)) in versions.iter().enumerate() {
            if *start_dt >= min_ts && (max_ts == 0 || *start_dt <= max_ts) {
                schemas.push(data.clone());
                if last_schema_index.is_none() {
                    last_schema_index = Some(index);
                }
            }
        }

        if let Some(last_index) = last_schema_index {
            if last_index > 0
                && let Some((_, data)) = versions.get(last_index - 1)
            {
                // older version of schema before start_dt should be added in start
                schemas.insert(0, data.clone());
            }
        } else {
            // this is latest version of schema hence added in end
            schemas.push(versions.last().unwrap().1.clone());
        }

        return Ok(schemas);
    }
    drop(r);

    log::warn!("get_versions: cache missing and get from db for key: {cache_key}");

    let db = infra_db::get_db().await;
    let ret = match db.get(&key).await {
        Err(e) => {
            if let Error::DbError(DbError::KeyNotExists(_)) = e {
                vec![]
            } else {
                return Err(Error::Message(format!(
                    "Error getting schema versions: {e}",
                )));
            }
        }
        Ok(v) => {
            let schemas: Result<Vec<Schema>> = json::from_slice(&v).map_err(|e| e.into());
            if let Ok(schemas) = schemas {
                schemas
            } else {
                vec![json::from_slice(&v)?]
            }
        }
    };
    if ret.is_empty() {
        return Ok(vec![]);
    }

    log::warn!("get_versions: got from db and cache for key: {cache_key}");

    // cache the latest versions
    let latest_schema = ret.last().cloned().unwrap();
    let start_dt = unwrap_stream_start_dt(&latest_schema).unwrap_or(now_micros());
    let schema_versions = vec![(start_dt, latest_schema)];
    let mut w = STREAM_SCHEMAS.write().await;
    w.entry(cache_key.to_string())
        .and_modify(|existing_vec| {
            existing_vec.retain(|(v, _)| schema_versions.iter().all(|(v1, _)| v1 != v));
            existing_vec.extend(schema_versions.clone())
        })
        .or_insert(schema_versions);
    drop(w);

    Ok(ret)
}

pub async fn get_settings(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Option<StreamSettings> {
    let key = format!("{org_id}/{stream_type}/{stream_name}");

    // Try to get from read lock first
    if let Some(settings) = get_stream_settings_atomic(&key) {
        return Some(settings);
    }

    // Get from DB without holding any locks
    let settings = get(org_id, stream_name, stream_type)
        .await
        .ok()
        .as_ref()
        .and_then(unwrap_stream_settings);

    // Only acquire write lock if we have settings to update
    if let Some(ref s) = settings {
        // Check cache again before updating as another thread might updated while we reading DB
        let mut w = STREAM_SETTINGS.write().await;
        if !w.contains_key(&key) {
            w.insert(key, s.clone());
        }
        set_stream_settings_atomic(w.clone());
        drop(w);
    }

    settings
}

pub async fn get_flatten_level(org_id: &str, stream_name: &str, stream_type: StreamType) -> u32 {
    if let Some(settings) = get_settings(org_id, stream_name, stream_type).await
        && let Some(level) = settings.flatten_level
        && level > 0
    {
        return level as u32;
    }
    get_config().limit.ingest_flatten_level
}

pub fn unwrap_stream_settings(schema: &Schema) -> Option<StreamSettings> {
    if schema.metadata().is_empty() {
        return None;
    }
    schema
        .metadata()
        .get("settings")
        .map(|v| StreamSettings::from(v.as_str()))
}

pub fn unwrap_stream_created_at(schema: &Schema) -> Option<i64> {
    schema
        .metadata()
        .get("created_at")
        .and_then(|v| v.parse().ok())
}

pub fn unwrap_stream_start_dt(schema: &Schema) -> Option<i64> {
    schema
        .metadata()
        .get("start_dt")
        .and_then(|v| v.parse().ok())
}

pub fn unwrap_stream_is_derived(schema: &Schema) -> Option<bool> {
    schema
        .metadata()
        .get("is_derived")
        .and_then(|v| v.parse().ok())
}

pub fn unwrap_partition_time_level(
    level: Option<PartitionTimeLevel>,
    stream_type: StreamType,
) -> PartitionTimeLevel {
    let level = level.unwrap_or_default();
    if level != PartitionTimeLevel::Unset {
        level
    } else {
        let cfg = get_config();
        match stream_type {
            StreamType::Logs => PartitionTimeLevel::from(cfg.limit.logs_file_retention.as_str()),
            StreamType::Metrics => {
                PartitionTimeLevel::from(cfg.limit.metrics_file_retention.as_str())
            }
            StreamType::Traces => {
                PartitionTimeLevel::from(cfg.limit.traces_file_retention.as_str())
            }
            // for file list dump streams, we want to compact by day
            StreamType::Filelist => PartitionTimeLevel::Daily,
            _ => PartitionTimeLevel::default(),
        }
    }
}

pub fn get_stream_setting_defined_schema_fields(settings: &Option<StreamSettings>) -> Vec<String> {
    settings
        .as_ref()
        .map(|settings| settings.defined_schema_fields.clone())
        .unwrap_or_default()
}

pub fn get_stream_setting_fts_fields(settings: &Option<StreamSettings>) -> Vec<String> {
    let default_fields = SQL_FULL_TEXT_SEARCH_FIELDS.clone();
    match settings {
        Some(settings) => {
            let mut fields = settings.full_text_search_keys.clone();
            fields.extend(default_fields);
            if settings.index_original_data {
                fields.push(ORIGINAL_DATA_COL_NAME.to_string());
            }
            if settings.index_all_values {
                fields.push(ALL_VALUES_COL_NAME.to_string());
            }
            fields.sort();
            fields.dedup();
            fields
        }
        None => default_fields,
    }
}

pub fn get_stream_setting_index_fields(settings: &Option<StreamSettings>) -> Vec<String> {
    let default_fields = SQL_SECONDARY_INDEX_SEARCH_FIELDS.clone();
    match settings {
        Some(settings) => {
            let mut fields = settings.index_fields.clone();
            fields.extend(default_fields);
            fields.sort();
            fields.dedup();
            fields
        }
        None => default_fields,
    }
}

pub fn get_stream_setting_bloom_filter_fields(settings: &Option<StreamSettings>) -> Vec<String> {
    let default_fields = BLOOM_FILTER_DEFAULT_FIELDS.clone();
    match settings {
        Some(settings) => {
            let mut fields = settings.bloom_filter_fields.clone();
            fields.extend(default_fields);
            fields.sort();
            fields.dedup();
            fields
        }
        None => default_fields,
    }
}

pub fn get_stream_setting_log_patterns_enabled(settings: &Option<StreamSettings>) -> bool {
    settings
        .as_ref()
        .map(|s| s.enable_log_patterns_extraction)
        .unwrap_or(false)
}

pub fn get_stream_setting_index_updated_at(
    settings: &Option<StreamSettings>,
    created_at: Option<i64>,
) -> i64 {
    let created_at = match created_at {
        Some(created_at) => created_at,
        None => {
            log::warn!("created_at not found in schema metadata");
            Utc::now().timestamp_micros()
        }
    };
    match settings {
        Some(settings) => {
            if settings.index_updated_at > 0 {
                settings.index_updated_at
            } else {
                created_at
            }
        }
        None => created_at,
    }
}

pub async fn merge(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
) -> Result<Option<(Schema, Vec<Field>)>> {
    let stream_name = stream_name.trim();
    if stream_name.is_empty() {
        return Ok(None);
    }
    let start_dt = min_ts;
    let key = mk_key(org_id, stream_type, stream_name);
    let inferred_schema = schema.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            match value {
                None => Ok(Some((
                    None,
                    Some((
                        key,
                        json::to_vec(&vec![{
                            // there is no schema, just set the new schema
                            let schema_metadata = inferred_schema.metadata();
                            let inferred_schema = if schema_metadata.contains_key("created_at")
                                && schema_metadata.contains_key("start_dt")
                            {
                                inferred_schema
                            } else {
                                let start_dt =
                                    start_dt.unwrap_or_else(|| Utc::now().timestamp_micros());
                                let mut schema_metadata = inferred_schema.metadata().clone();
                                if !schema_metadata.contains_key("created_at") {
                                    schema_metadata
                                        .insert("created_at".to_string(), start_dt.to_string());
                                }
                                if !schema_metadata.contains_key("start_dt") {
                                    schema_metadata
                                        .insert("start_dt".to_string(), start_dt.to_string());
                                }
                                inferred_schema.with_metadata(schema_metadata)
                            };
                            tx.send(Some((inferred_schema.clone(), vec![]))).unwrap();
                            inferred_schema
                        }])
                        .unwrap()
                        .into(),
                        start_dt,
                    )),
                ))),
                Some(value) => {
                    // there is schema, merge the schema
                    // parse latest schema
                    let mut schemas: Vec<Schema> = json::from_slice(&value)?;
                    let latest_schema = match schemas.last_mut() {
                        Some(s) => s,
                        None => {
                            return Err(Error::Message(format!(
                                "Error parsing latest schema for schema: {key}"
                            )));
                        }
                    };
                    // merge schema
                    let (is_schema_changed, field_datatype_delta, merged_fields) =
                        get_merge_schema_changes(latest_schema, &inferred_schema);

                    if !is_schema_changed {
                        tx.send(Some((latest_schema.clone(), field_datatype_delta)))
                            .unwrap();
                        return Ok(None); // no change, return
                    }
                    let metadata = latest_schema.metadata().clone();
                    let final_schema = Schema::new(merged_fields).with_metadata(metadata);

                    // Casting of data to existing schema isnt new version, we remove records
                    // with zo_cast metadata
                    let schema_version_changes = field_datatype_delta
                        .iter()
                        .filter(|f| f.metadata().get("zo_cast").is_none())
                        .collect::<Vec<_>>();
                    let need_new_version = !schema_version_changes.is_empty();

                    if need_new_version && let Some(start_dt) = start_dt {
                        // update old version end_dt
                        let mut metadata = latest_schema.metadata().clone();
                        metadata.insert("end_dt".to_string(), start_dt.to_string());
                        let prev_schema = vec![latest_schema.clone().with_metadata(metadata)];
                        let mut new_metadata = latest_schema.metadata().clone();
                        new_metadata.insert("start_dt".to_string(), start_dt.to_string());
                        let new_schema = vec![final_schema.clone().with_metadata(new_metadata)];
                        tx.send(Some((final_schema, field_datatype_delta))).unwrap();
                        Ok(Some((
                            Some(json::to_vec(&prev_schema).unwrap().into()),
                            Some((
                                key,
                                json::to_vec(&new_schema).unwrap().into(),
                                Some(start_dt),
                            )),
                        )))
                    } else {
                        // just update the latest schema
                        tx.send(Some((final_schema.clone(), field_datatype_delta)))
                            .unwrap();
                        Ok(Some((
                            Some(json::to_vec(&vec![final_schema]).unwrap().into()),
                            None,
                        )))
                    }
                }
            }
        }),
    )
    .await?;
    rx.await.map_err(|e| Error::Message(e.to_string()))
}

pub async fn update_setting(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    metadata: std::collections::HashMap<String, String>,
) -> Result<()> {
    let stream_name = stream_name.trim();
    if stream_name.is_empty() {
        return Ok(());
    }
    let key = mk_key(org_id, stream_type, stream_name);
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            let (latest_schema, not_exists) = match value {
                None => (Schema::empty(), true),
                Some(value) => {
                    let mut schemas: Vec<Schema> = json::from_slice(&value)?;
                    if schemas.is_empty() {
                        (Schema::empty(), false)
                    } else {
                        (schemas.remove(schemas.len() - 1), false)
                    }
                }
            };
            let mut schema_metadata = latest_schema.metadata().clone();
            for (k, v) in metadata.iter() {
                schema_metadata.insert(k.clone(), v.clone());
            }
            let start_dt = match schema_metadata.get("created_at") {
                Some(v) => v.parse().unwrap(),
                None => Utc::now().timestamp_micros(),
            };
            if !schema_metadata.contains_key("created_at") {
                schema_metadata.insert("created_at".to_string(), start_dt.to_string());
            }
            if !schema_metadata.contains_key("start_dt") {
                schema_metadata.insert("start_dt".to_string(), start_dt.to_string());
            }
            let new_schema = vec![latest_schema.with_metadata(schema_metadata)];
            if not_exists {
                Ok(Some((
                    None,
                    Some((
                        key,
                        json::to_vec(&new_schema).unwrap().into(),
                        Some(start_dt),
                    )),
                )))
            } else {
                Ok(Some((
                    Some(json::to_vec(&new_schema).unwrap().into()),
                    None,
                )))
            }
        }),
    )
    .await?;

    Ok(())
}

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    deleted_fields: Vec<String>,
) -> Result<()> {
    let key = mk_key(org_id, stream_type, stream_name);
    let db = infra_db::get_db().await;
    db.get_for_update(
        &key.clone(),
        infra_db::NEED_WATCH,
        None,
        Box::new(move |value| {
            let Some(value) = value else {
                return Ok(None);
            };
            let mut schemas: Vec<Schema> = json::from_slice(&value)?;
            let latest_schema = if schemas.is_empty() {
                return Ok(None);
            } else {
                schemas.remove(schemas.len() - 1)
            };
            let start_dt = Utc::now().timestamp_micros();
            // update previous version schema
            let mut latest_metadata = latest_schema.metadata().clone();
            latest_metadata.insert("end_dt".to_string(), start_dt.to_string());
            let prev_schema = vec![latest_schema.clone().with_metadata(latest_metadata)];
            // new version schema
            let mut new_metadata = latest_schema.metadata().clone();
            new_metadata.insert("start_dt".to_string(), start_dt.to_string());
            let fields = latest_schema
                .fields()
                .iter()
                .filter_map(|f| {
                    if deleted_fields.contains(&f.name().to_string()) {
                        None
                    } else {
                        Some(f.clone())
                    }
                })
                .collect::<Vec<_>>();

            let mut settings = unwrap_stream_settings(&latest_schema).unwrap_or_default();

            settings
                .defined_schema_fields
                .retain(|f| !deleted_fields.contains(f));

            new_metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
            let new_schema = vec![Schema::new_with_metadata(fields, new_metadata)];
            Ok(Some((
                Some(json::to_vec(&prev_schema).unwrap().into()),
                Some((
                    key,
                    json::to_vec(&new_schema).unwrap().into(),
                    Some(start_dt),
                )),
            )))
        }),
    )
    .await?;

    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    start_dt: Option<i64>,
) -> Result<()> {
    let key = format!("{SCHEMA_KEY}{org_id}/{stream_type}/{stream_name}");
    let db = infra_db::get_db().await;
    match db.delete(&key, false, infra_db::NEED_WATCH, start_dt).await {
        Ok(_) => {}
        Err(e) => {
            log::error!("Error deleting schema: {e}");
            return Err(Error::Message(format!("Error deleting schema: {e}")));
        }
    }
    Ok(())
}

pub fn get_merge_schema_changes(
    schema: &Schema,
    inferred_schema: &Schema,
) -> (bool, Vec<Field>, Vec<Field>) {
    let mut is_schema_changed = false;
    let mut field_datatype_delta: Vec<_> = vec![];

    let mut merged_fields = schema.fields().iter().collect::<Vec<_>>();
    let mut merged_fields_chk = hashbrown::HashMap::with_capacity(merged_fields.len());
    for (i, f) in merged_fields.iter().enumerate() {
        merged_fields_chk.insert(f.name(), i);
    }

    for item in inferred_schema.fields.iter() {
        let item_name = item.name();
        let item_data_type = item.data_type();

        match merged_fields_chk.get(item_name) {
            None => {
                is_schema_changed = true;
                merged_fields.push(item);
                merged_fields_chk.insert(item_name, merged_fields.len() - 1);
            }
            Some(idx) => {
                let existing_field = &merged_fields[*idx];
                if existing_field.data_type() != item_data_type {
                    if is_widening_conversion(existing_field.data_type(), item_data_type) {
                        is_schema_changed = true;
                        merged_fields[*idx] = item;
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
    if !is_schema_changed {
        (false, field_datatype_delta, vec![])
    } else {
        let mut merged_fields = merged_fields
            .into_iter()
            .map(|f| f.as_ref().clone())
            .collect::<Vec<_>>();
        merged_fields.sort_by(|a, b| a.name().cmp(b.name()));
        (true, field_datatype_delta, merged_fields)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SchemaCache {
    schema: SchemaRef,
    fields_map: HashMap<String, usize>,
    hash_key: String,
    is_derived: bool,
}

impl SchemaCache {
    pub fn new(schema: Schema) -> Self {
        Self::new_from_arc(Arc::new(schema))
    }

    pub fn new_from_arc(schema: Arc<Schema>) -> Self {
        let hash_key = schema.hash_key();
        let fields_map = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, f)| (f.name().to_owned(), i))
            .collect();
        Self {
            schema,
            fields_map,
            hash_key,
            is_derived: false,
        }
    }

    pub fn hash_key(&self) -> &str {
        &self.hash_key
    }

    pub fn schema(&self) -> &Arc<Schema> {
        &self.schema
    }

    pub fn fields_map(&self) -> &HashMap<String, usize> {
        &self.fields_map
    }

    pub fn contains_field(&self, field_name: &str) -> bool {
        self.fields_map.contains_key(field_name)
    }

    pub fn field_with_name(&self, field_name: &str) -> Option<&FieldRef> {
        self.fields_map
            .get(field_name)
            .and_then(|i| self.schema.fields().get(*i))
    }

    pub fn size(&self) -> usize {
        let mut size = std::mem::size_of::<SchemaRef>() + self.schema.size();
        size += std::mem::size_of::<HashMap<String, usize>>();
        for (key, _val) in self.fields_map.iter() {
            size += std::mem::size_of::<String>() + key.len();
            size += std::mem::size_of::<usize>();
        }
        size += std::mem::size_of::<String>() + self.hash_key.len();
        size
    }
}

pub fn is_widening_conversion(from: &DataType, to: &DataType) -> bool {
    let allowed_type = match from {
        DataType::Boolean => vec![DataType::Utf8, DataType::LargeUtf8],
        DataType::Int8 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::Int16,
            DataType::Int32,
            DataType::Int64,
            DataType::Float16,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int16 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::Int32,
            DataType::Int64,
            DataType::Float16,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int32 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::Int64,
            DataType::UInt32,
            DataType::UInt64,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Int64 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::UInt64,
            DataType::Float64,
        ],
        DataType::UInt8 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::UInt16,
            DataType::UInt32,
            DataType::UInt64,
        ],
        DataType::UInt16 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::UInt32,
            DataType::UInt64,
        ],
        DataType::UInt32 => vec![DataType::Utf8, DataType::LargeUtf8, DataType::UInt64],
        DataType::UInt64 => vec![DataType::Utf8, DataType::LargeUtf8],
        DataType::Float16 => vec![
            DataType::Utf8,
            DataType::LargeUtf8,
            DataType::Float32,
            DataType::Float64,
        ],
        DataType::Float32 => vec![DataType::Utf8, DataType::LargeUtf8, DataType::Float64],
        DataType::Float64 => vec![DataType::Utf8, DataType::LargeUtf8],
        DataType::Utf8 => vec![DataType::LargeUtf8],
        DataType::LargeUtf8 => vec![DataType::LargeUtf8],
        _ => vec![DataType::Utf8],
    };
    allowed_type.contains(to)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_widening_conversion() {
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int32));
    }

    #[test]
    fn test_get_stream_setting_fts_fields() {
        let schema = Schema::new(vec![Field::new("f.c", DataType::Int32, false)]);
        let settings = unwrap_stream_settings(&schema);
        let res = get_stream_setting_fts_fields(&settings);
        assert!(!res.is_empty());
    }

    #[test]
    fn test_mk_key() {
        let key = mk_key("test_org", StreamType::Logs, "test_stream");
        assert_eq!(key, "/schema/test_org/logs/test_stream");

        let key = mk_key("org123", StreamType::Metrics, "metrics_stream");
        assert_eq!(key, "/schema/org123/metrics/metrics_stream");

        let key = mk_key("org_id", StreamType::Traces, "trace_data");
        assert_eq!(key, "/schema/org_id/traces/trace_data");
    }

    #[test]
    fn test_unwrap_stream_settings() {
        // Test with empty metadata
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let settings = unwrap_stream_settings(&schema);
        assert!(settings.is_none());

        // Test with settings in metadata
        let mut metadata = HashMap::new();
        let stream_settings = StreamSettings::default();
        metadata.insert(
            "settings".to_string(),
            json::to_string(&stream_settings).unwrap(),
        );
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let settings = unwrap_stream_settings(&schema);
        assert!(settings.is_some());
    }

    #[test]
    fn test_unwrap_stream_created_at() {
        // Test with created_at in metadata
        let mut metadata = HashMap::new();
        metadata.insert("created_at".to_string(), "1234567890".to_string());
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let created_at = unwrap_stream_created_at(&schema);
        assert_eq!(created_at, Some(1234567890));

        // Test without created_at
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let created_at = unwrap_stream_created_at(&schema);
        assert!(created_at.is_none());

        // Test with invalid created_at
        let mut metadata = HashMap::new();
        metadata.insert("created_at".to_string(), "invalid".to_string());
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let created_at = unwrap_stream_created_at(&schema);
        assert!(created_at.is_none());
    }

    #[test]
    fn test_unwrap_stream_start_dt() {
        // Test with start_dt in metadata
        let mut metadata = HashMap::new();
        metadata.insert("start_dt".to_string(), "9876543210".to_string());
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let start_dt = unwrap_stream_start_dt(&schema);
        assert_eq!(start_dt, Some(9876543210));

        // Test without start_dt
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let start_dt = unwrap_stream_start_dt(&schema);
        assert!(start_dt.is_none());
    }

    #[test]
    fn test_unwrap_stream_is_derived() {
        // Test with is_derived = true
        let mut metadata = HashMap::new();
        metadata.insert("is_derived".to_string(), "true".to_string());
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let is_derived = unwrap_stream_is_derived(&schema);
        assert_eq!(is_derived, Some(true));

        // Test with is_derived = false
        let mut metadata = HashMap::new();
        metadata.insert("is_derived".to_string(), "false".to_string());
        let schema =
            Schema::new(vec![Field::new("field1", DataType::Int32, false)]).with_metadata(metadata);
        let is_derived = unwrap_stream_is_derived(&schema);
        assert_eq!(is_derived, Some(false));

        // Test without is_derived
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let is_derived = unwrap_stream_is_derived(&schema);
        assert!(is_derived.is_none());
    }

    #[test]
    fn test_unwrap_partition_time_level() {
        // Test with specific level
        let level = unwrap_partition_time_level(Some(PartitionTimeLevel::Hourly), StreamType::Logs);
        assert_eq!(level, PartitionTimeLevel::Hourly);

        // Test with Unset - should use stream type default
        let level = unwrap_partition_time_level(Some(PartitionTimeLevel::Unset), StreamType::Logs);
        assert_ne!(level, PartitionTimeLevel::Unset);

        // Test with None - should use stream type default
        let level = unwrap_partition_time_level(None, StreamType::Metrics);
        assert_ne!(level, PartitionTimeLevel::Unset);

        // Test Filelist stream type
        let level = unwrap_partition_time_level(None, StreamType::Filelist);
        assert_eq!(level, PartitionTimeLevel::Daily);
    }

    #[test]
    fn test_get_stream_setting_defined_schema_fields() {
        // Test with None
        let fields = get_stream_setting_defined_schema_fields(&None);
        assert!(fields.is_empty());

        // Test with Some settings
        let mut settings = StreamSettings::default();
        settings.defined_schema_fields = vec!["field1".to_string(), "field2".to_string()];
        let fields = get_stream_setting_defined_schema_fields(&Some(settings));
        assert_eq!(fields.len(), 2);
        assert!(fields.contains(&"field1".to_string()));
        assert!(fields.contains(&"field2".to_string()));
    }

    #[test]
    fn test_get_stream_setting_fts_fields_with_settings() {
        // Test with custom FTS fields
        let mut settings = StreamSettings::default();
        settings.full_text_search_keys = vec!["custom_field".to_string()];
        settings.index_original_data = true;
        settings.index_all_values = true;

        let fields = get_stream_setting_fts_fields(&Some(settings));
        assert!(fields.contains(&"custom_field".to_string()));
        assert!(fields.contains(&ORIGINAL_DATA_COL_NAME.to_string()));
        assert!(fields.contains(&ALL_VALUES_COL_NAME.to_string()));

        // Verify no duplicates
        let unique_count = fields.iter().collect::<hashbrown::HashSet<_>>().len();
        assert_eq!(unique_count, fields.len());
    }

    #[test]
    fn test_get_stream_setting_index_fields() {
        // Test with None
        let fields = get_stream_setting_index_fields(&None);
        assert!(!fields.is_empty()); // Should have default fields

        // Test with custom index fields
        let mut settings = StreamSettings::default();
        settings.index_fields = vec!["index_field1".to_string(), "index_field2".to_string()];
        let fields = get_stream_setting_index_fields(&Some(settings));
        assert!(fields.contains(&"index_field1".to_string()));
        assert!(fields.contains(&"index_field2".to_string()));

        // Verify no duplicates
        let unique_count = fields.iter().collect::<hashbrown::HashSet<_>>().len();
        assert_eq!(unique_count, fields.len());
    }

    #[test]
    fn test_get_stream_setting_bloom_filter_fields() {
        // Test with None
        let fields = get_stream_setting_bloom_filter_fields(&None);
        assert!(!fields.is_empty()); // Should have default fields

        // Test with custom bloom filter fields
        let mut settings = StreamSettings::default();
        settings.bloom_filter_fields = vec!["bloom_field".to_string()];
        let fields = get_stream_setting_bloom_filter_fields(&Some(settings));
        assert!(fields.contains(&"bloom_field".to_string()));

        // Verify no duplicates
        let unique_count = fields.iter().collect::<hashbrown::HashSet<_>>().len();
        assert_eq!(unique_count, fields.len());
    }

    #[test]
    fn test_get_stream_setting_log_patterns_enabled() {
        // Test with None
        assert!(!get_stream_setting_log_patterns_enabled(&None));

        // Test with disabled
        let mut settings = StreamSettings::default();
        settings.enable_log_patterns_extraction = false;
        assert!(!get_stream_setting_log_patterns_enabled(&Some(settings)));

        // Test with enabled
        let mut settings = StreamSettings::default();
        settings.enable_log_patterns_extraction = true;
        assert!(get_stream_setting_log_patterns_enabled(&Some(settings)));
    }

    #[test]
    fn test_get_stream_setting_index_updated_at() {
        // Test with None settings and created_at
        let created_at = 1234567890;
        let result = get_stream_setting_index_updated_at(&None, Some(created_at));
        assert_eq!(result, created_at);

        // Test with None settings and None created_at
        let result = get_stream_setting_index_updated_at(&None, None);
        assert!(result > 0); // Should return current time

        // Test with settings that have index_updated_at
        let mut settings = StreamSettings::default();
        settings.index_updated_at = 9999999999;
        let result = get_stream_setting_index_updated_at(&Some(settings), Some(created_at));
        assert_eq!(result, 9999999999);

        // Test with settings that have index_updated_at = 0
        let mut settings = StreamSettings::default();
        settings.index_updated_at = 0;
        let result = get_stream_setting_index_updated_at(&Some(settings), Some(created_at));
        assert_eq!(result, created_at);
    }

    #[test]
    fn test_get_merge_schema_changes_no_changes() {
        // Test when schemas are identical
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);
        let inferred_schema = schema.clone();

        let (is_changed, delta, merged) = get_merge_schema_changes(&schema, &inferred_schema);
        assert!(!is_changed);
        assert!(delta.is_empty());
        assert!(merged.is_empty());
    }

    #[test]
    fn test_get_merge_schema_changes_new_field() {
        // Test when new field is added
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let inferred_schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);

        let (is_changed, delta, merged) = get_merge_schema_changes(&schema, &inferred_schema);
        assert!(is_changed);
        assert!(delta.is_empty()); // No type changes, just new field
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn test_get_merge_schema_changes_widening_conversion() {
        // Test widening conversion (Int32 -> Int64)
        let schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let inferred_schema = Schema::new(vec![Field::new("field1", DataType::Int64, false)]);

        let (is_changed, delta, merged) = get_merge_schema_changes(&schema, &inferred_schema);
        assert!(is_changed);
        assert_eq!(delta.len(), 1);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].data_type(), &DataType::Int64);
    }

    #[test]
    fn test_get_merge_schema_changes_narrowing_conversion() {
        // Test narrowing conversion (Int64 -> Int32) - should add zo_cast
        let schema = Schema::new(vec![Field::new("field1", DataType::Int64, false)]);
        let inferred_schema = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);

        let (is_changed, delta, merged) = get_merge_schema_changes(&schema, &inferred_schema);
        assert!(!is_changed); // No actual schema change
        assert_eq!(delta.len(), 1);
        assert!(delta[0].metadata().contains_key("zo_cast"));
        assert!(merged.is_empty());
    }

    #[test]
    fn test_is_widening_conversion_comprehensive() {
        // Test Boolean conversions
        assert!(is_widening_conversion(&DataType::Boolean, &DataType::Utf8));
        assert!(is_widening_conversion(
            &DataType::Boolean,
            &DataType::LargeUtf8
        ));

        // Test Int8 conversions
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int16));
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int32));
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Int64));
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Float32));
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Float64));
        assert!(is_widening_conversion(&DataType::Int8, &DataType::Utf8));

        // Test Int32 conversions
        assert!(is_widening_conversion(&DataType::Int32, &DataType::Int64));
        assert!(is_widening_conversion(&DataType::Int32, &DataType::UInt32));
        assert!(is_widening_conversion(&DataType::Int32, &DataType::UInt64));
        assert!(is_widening_conversion(&DataType::Int32, &DataType::Float64));
        assert!(!is_widening_conversion(&DataType::Int32, &DataType::Int16));

        // Test Float conversions
        assert!(is_widening_conversion(
            &DataType::Float32,
            &DataType::Float64
        ));
        assert!(!is_widening_conversion(
            &DataType::Float64,
            &DataType::Float32
        ));

        // Test UInt conversions
        assert!(is_widening_conversion(&DataType::UInt8, &DataType::UInt16));
        assert!(is_widening_conversion(&DataType::UInt16, &DataType::UInt32));
        assert!(is_widening_conversion(&DataType::UInt32, &DataType::UInt64));
        assert!(!is_widening_conversion(
            &DataType::UInt64,
            &DataType::UInt32
        ));

        // Test Utf8 conversions
        assert!(is_widening_conversion(
            &DataType::Utf8,
            &DataType::LargeUtf8
        ));
        assert!(!is_widening_conversion(
            &DataType::LargeUtf8,
            &DataType::Utf8
        ));
    }

    #[test]
    fn test_schema_cache_new() {
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);

        let cache = SchemaCache::new(schema.clone());
        assert_eq!(cache.schema().fields().len(), 2);
        assert_eq!(cache.fields_map().len(), 2);
        assert!(!cache.hash_key().is_empty());
    }

    #[test]
    fn test_schema_cache_contains_field() {
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);

        let cache = SchemaCache::new(schema);
        assert!(cache.contains_field("field1"));
        assert!(cache.contains_field("field2"));
        assert!(!cache.contains_field("field3"));
    }

    #[test]
    fn test_schema_cache_field_with_name() {
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);

        let cache = SchemaCache::new(schema);
        let field = cache.field_with_name("field1");
        assert!(field.is_some());
        assert_eq!(field.unwrap().name(), "field1");

        let field = cache.field_with_name("nonexistent");
        assert!(field.is_none());
    }

    #[test]
    fn test_schema_cache_size() {
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
        ]);

        let cache = SchemaCache::new(schema);
        let size = cache.size();
        assert!(size > 0);
    }

    #[test]
    fn test_schema_cache_hash_key() {
        let schema1 = Schema::new(vec![Field::new("field1", DataType::Int32, false)]);
        let schema2 = Schema::new(vec![Field::new("field2", DataType::Utf8, false)]);

        let cache1 = SchemaCache::new(schema1.clone());
        let cache2 = SchemaCache::new(schema2);
        let cache3 = SchemaCache::new(schema1.clone());

        // Different schemas should have different hash keys
        assert_ne!(cache1.hash_key(), cache2.hash_key());
        // Same schema should have same hash key
        assert_eq!(cache1.hash_key(), cache3.hash_key());
    }

    #[test]
    fn test_get_merge_schema_changes_multiple_fields() {
        // Test with multiple fields and mixed changes
        let schema = Schema::new(vec![
            Field::new("field1", DataType::Int32, false),
            Field::new("field2", DataType::Utf8, false),
            Field::new("field3", DataType::Float32, false),
        ]);

        let inferred_schema = Schema::new(vec![
            Field::new("field1", DataType::Int64, false), // Widening
            Field::new("field2", DataType::Utf8, false),  // No change
            Field::new("field3", DataType::Float64, false), // Widening
            Field::new("field4", DataType::Boolean, false), // New field
        ]);

        let (is_changed, delta, merged) = get_merge_schema_changes(&schema, &inferred_schema);
        assert!(is_changed);
        assert_eq!(delta.len(), 2); // Two widening conversions
        assert_eq!(merged.len(), 4); // All four fields
    }
}
