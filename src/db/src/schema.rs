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

use std::sync::atomic::Ordering;

use arrow_schema::{DataType, Field, Schema};
use bytes::Bytes;
use common::meta::stream::StreamSchema;
use config::{
    cluster::LOCAL_NODE_ID, ider::SnowflakeIdGenerator, meta::stream::StreamType, utils::json,
};
use hashbrown::{HashMap, HashSet};
use infra::schema::{
    STREAM_RECORD_ID_GENERATOR, STREAM_SCHEMAS, STREAM_SCHEMAS_LATEST, STREAM_SETTINGS,
    SchemaCache, unwrap_stream_settings,
};
#[cfg(feature = "enterprise")]
use {
    infra::{errors::Error, schema::mk_key},
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

use crate as db;

pub async fn merge(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: &Schema,
    min_ts: Option<i64>,
) -> Result<Option<(Schema, Vec<Field>)>, anyhow::Error> {
    let ret = infra::schema::merge(org_id, stream_name, stream_type, schema, min_ts).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let key = mk_key(org_id, stream_type, stream_name);
        o2_enterprise::enterprise::super_cluster::queue::schema_merge(
            &key,
            json::to_vec(&schema).unwrap().into(),
            infra::db::NEED_WATCH,
            min_ts,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(ret)
}

pub async fn update_setting(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    metadata: std::collections::HashMap<String, String>,
) -> Result<(), anyhow::Error> {
    infra::schema::update_setting(org_id, stream_name, stream_type, metadata.clone()).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let key = mk_key(org_id, stream_type, stream_name);
        o2_enterprise::enterprise::super_cluster::queue::schema_setting(
            &key,
            json::to_vec(&metadata).unwrap().into(),
            infra::db::NEED_WATCH,
            None,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

pub async fn set_stream_is_llm(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    is_llm_stream: bool,
) -> Result<(), anyhow::Error> {
    let mut settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    settings.is_llm_stream = is_llm_stream;

    if is_llm_stream {
        // Provision Gen-AI semantic-convention columns for the stream. Always merge
        // gen_ai_* fields into the Arrow schema so they are available at ingestion
        // time, even for streams that only have legacy llm_* fields or for non-UDS
        // streams. Legacy llm_* columns are left as-is so historical data still reads
        // cleanly.
        ensure_gen_ai_fields_in_schema_inner(org_id, stream_name, stream_type, false).await?;

        // Add to defined_schema_fields only when UDS is already enabled
        append_gen_ai_fields_to_defined_schema_fields(&mut settings.defined_schema_fields);
    }

    let mut metadata = std::collections::HashMap::with_capacity(1);
    metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
    update_setting(org_id, stream_name, stream_type, metadata).await
}

/// Ensure gen_ai_* schema fields are present in a stream's Arrow schema.
///
/// This adds any missing gen_ai_* fields from [`GEN_AI_SCHEMA_FIELDS`] into the
/// stream's Arrow schema so they are available at ingestion time. For streams
/// with User-Defined Schema already enabled, it also appends those fields to
/// `defined_schema_fields`; non-UDS streams are left non-UDS.
///
/// Handles the case where a stream was already marked as an LLM stream but has
/// only legacy `llm_*` fields — calling this ensures the newer `gen_ai_*`
/// columns exist for querying.
pub async fn ensure_gen_ai_fields_in_schema(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    ensure_gen_ai_fields_in_schema_inner(org_id, stream_name, stream_type, true).await
}

async fn ensure_gen_ai_fields_in_schema_inner(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    update_defined_schema_fields: bool,
) -> Result<(), anyhow::Error> {
    let schema_cache = infra::schema::get_cache(org_id, stream_name, stream_type).await?;
    let missing_fields: Vec<Field> = GEN_AI_SCHEMA_FIELDS
        .iter()
        .filter(|f| !schema_cache.contains_field(f.name()))
        .cloned()
        .collect();

    if !missing_fields.is_empty() {
        let gen_ai_schema = Schema::new(missing_fields);
        merge(org_id, stream_name, stream_type, &gen_ai_schema, None).await?;
    }
    if update_defined_schema_fields {
        ensure_gen_ai_fields_in_defined_schema_fields(org_id, stream_name, stream_type).await?;
    }
    Ok(())
}

async fn ensure_gen_ai_fields_in_defined_schema_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) -> Result<(), anyhow::Error> {
    let mut settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    if append_gen_ai_fields_to_defined_schema_fields(&mut settings.defined_schema_fields) {
        let mut metadata = std::collections::HashMap::with_capacity(1);
        metadata.insert("settings".to_string(), json::to_string(&settings).unwrap());
        update_setting(org_id, stream_name, stream_type, metadata).await?;
    }
    Ok(())
}

fn append_gen_ai_fields_to_defined_schema_fields(defined_schema_fields: &mut Vec<String>) -> bool {
    if defined_schema_fields.is_empty() {
        return false;
    }

    let mut updated = false;
    for field in GEN_AI_SCHEMA_FIELDS.iter() {
        if !defined_schema_fields
            .iter()
            .any(|name| name == field.name())
        {
            defined_schema_fields.push(field.name().to_string());
            updated = true;
        }
    }
    if updated {
        defined_schema_fields.sort();
    }
    updated
}

/// Arrow schema fields provisioned on streams marked as LLM streams.
///
/// Column names follow OTEL Gen-AI semantic conventions (after dot→underscore
/// flattening of attribute keys at ingestion). Three columns are OpenObserve
/// extensions kept under the `gen_ai_` namespace per project convention: the
/// derived `gen_ai_usage_total_tokens`, and cost breakdown/estimate fields
/// (the spec does not currently define cost attributes).
static GEN_AI_SCHEMA_FIELDS: std::sync::LazyLock<Vec<Field>> = std::sync::LazyLock::new(|| {
    vec![
        // String fields
        Field::new("gen_ai_operation_name", DataType::Utf8, true),
        Field::new("gen_ai_response_model", DataType::Utf8, true),
        Field::new("gen_ai_provider_name", DataType::Utf8, true),
        Field::new("gen_ai_agent_name", DataType::Utf8, true),
        Field::new("gen_ai_agent_id", DataType::Utf8, true),
        Field::new("gen_ai_input_messages", DataType::Utf8, true),
        Field::new("gen_ai_output_messages", DataType::Utf8, true),
        Field::new("gen_ai_system_instructions", DataType::Utf8, true),
        Field::new("user_id", DataType::Utf8, true),
        Field::new("gen_ai_conversation_id", DataType::Utf8, true),
        // Integer fields
        Field::new("gen_ai_usage_input_tokens", DataType::Int64, true),
        Field::new("gen_ai_usage_output_tokens", DataType::Int64, true),
        Field::new("gen_ai_usage_total_tokens", DataType::Int64, true),
        Field::new(
            "gen_ai_usage_cache_read_input_tokens",
            DataType::Int64,
            true,
        ),
        Field::new(
            "gen_ai_usage_cache_creation_input_tokens",
            DataType::Int64,
            true,
        ),
        // Float fields
        Field::new(
            "gen_ai_response_time_to_first_chunk",
            DataType::Float64,
            true,
        ),
        Field::new("gen_ai_usage_cost", DataType::Float64, true),
        Field::new("gen_ai_usage_cost_input", DataType::Float64, true),
        Field::new("gen_ai_usage_cost_output", DataType::Float64, true),
        Field::new(
            "gen_ai_usage_cost_cache_read_input",
            DataType::Float64,
            true,
        ),
        Field::new(
            "gen_ai_usage_cost_cache_creation_input",
            DataType::Float64,
            true,
        ),
        Field::new(
            "gen_ai_usage_cost_estimated_without_cache",
            DataType::Float64,
            true,
        ),
        Field::new(
            "gen_ai_usage_cost_cache_read_savings",
            DataType::Float64,
            true,
        ),
        Field::new(
            "gen_ai_usage_cost_net_cache_impact",
            DataType::Float64,
            true,
        ),
    ]
});

pub async fn delete_fields(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    deleted_fields: Vec<String>,
) -> Result<(), anyhow::Error> {
    infra::schema::delete_fields(org_id, stream_name, stream_type, deleted_fields.clone()).await?;

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let key = mk_key(org_id, stream_type, stream_name);
        o2_enterprise::enterprise::super_cluster::queue::schema_delete_fields(
            &key,
            json::to_vec(&deleted_fields).unwrap().into(),
            infra::db::NEED_WATCH,
            None,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

pub async fn delete(
    org_id: &str,
    stream_name: &str,
    stream_type: Option<StreamType>,
) -> Result<(), anyhow::Error> {
    let stream_type = stream_type.unwrap_or(StreamType::Logs);
    infra::schema::delete(org_id, stream_type, stream_name, None).await?;
    #[cfg(feature = "enterprise")]
    if stream_type == StreamType::Traces
        && let Err(e) = o2_enterprise::enterprise::llm_evaluations::agent_registry::clear_registry(
            org_id,
            Some(stream_name),
            Some(stream_type.as_str()),
        )
        .await
    {
        log::error!("Failed to delete Gen-AI agent registry rows for {org_id}/{stream_name}: {e}");
    }
    if stream_type == StreamType::EnrichmentTables {
        // Enrichment table size is not deleted by schema delete
        // Since we are storing the current size of the table in bytes in the meta table,
        // when we delete enrichment table, we need to delete the size from the db as well.
        if let Err(e) = super::enrichment_table::delete_table_size(org_id, stream_name).await {
            log::error!("Failed to delete table size: {e}");
        }
        if let Err(e) = super::enrichment_table::delete_meta_table_stats(org_id, stream_name).await
        {
            log::error!("Failed to delete meta table stats: {e}");
        }
    }

    // super cluster
    #[cfg(feature = "enterprise")]
    if get_o2_config().super_cluster.enabled {
        let key = mk_key(org_id, stream_type, stream_name);
        o2_enterprise::enterprise::super_cluster::queue::delete(
            &key,
            false,
            infra::db::NEED_WATCH,
            None,
        )
        .await
        .map_err(|e| Error::Message(e.to_string()))?;
        // sync to other regions to delete data of this stream
        o2_enterprise::enterprise::super_cluster::queue::stream_delete(&key)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
    }

    Ok(())
}

async fn list_stream_schemas(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Vec<StreamSchema> {
    let r = STREAM_SCHEMAS_LATEST.read().await;
    if r.is_empty() {
        return vec![];
    }

    let prefix = match stream_type {
        None => format!("{org_id}/"),
        Some(stream_type) => format!("{org_id}/{stream_type}/"),
    };
    r.iter()
        .filter_map(|(key, val)| {
            key.strip_prefix(&prefix).map(|key| {
                let (stream_type, stream_name) = match stream_type {
                    Some(stream_type) => (stream_type, key.into()),
                    None => {
                        let columns = key.split('/').take(2).collect::<Vec<_>>();
                        assert_eq!(columns.len(), 2, "BUG");
                        (columns[0].into(), columns[1].into())
                    }
                };
                StreamSchema {
                    stream_name,
                    stream_type,
                    schema: if fetch_schema {
                        val.schema().as_ref().clone()
                    } else {
                        // Even when the caller did not ask for the full schema,
                        // preserve the metadata (which carries `settings`,
                        // `created_at`, etc.) so downstream consumers can read
                        // properties like `is_llm_stream` from the cached
                        // schema. The fields list itself is omitted.
                        Schema::empty().with_metadata(val.schema().metadata().clone())
                    },
                }
            })
        })
        .collect()
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    fetch_schema: bool,
) -> Result<Vec<StreamSchema>, anyhow::Error> {
    let r = STREAM_SCHEMAS_LATEST.read().await;
    if !r.is_empty() {
        drop(r);
        return Ok(list_stream_schemas(org_id, stream_type, fetch_schema).await);
    }
    drop(r);

    let db_key = match stream_type {
        None => format!("/schema/{org_id}/"),
        Some(stream_type) => format!("/schema/{org_id}/{stream_type}/"),
    };
    let items = db::list(&db_key).await?;
    let mut schemas: HashMap<(String, StreamType), Vec<(Bytes, i64)>> =
        HashMap::with_capacity(items.len());
    for (key, val) in items {
        let key = key.strip_prefix(&db_key).unwrap();
        let (stream_type, stream_name, start_dt) = match stream_type {
            Some(stream_type) => {
                let columns = key.split('/').take(2).collect::<Vec<_>>();
                assert_eq!(columns.len(), 2, "BUG");
                (stream_type, columns[0].into(), columns[1].parse().unwrap())
            }
            None => {
                let columns = key.split('/').take(3).collect::<Vec<_>>();
                assert_eq!(columns.len(), 3, "BUG");
                (
                    columns[0].into(),
                    columns[1].into(),
                    columns[2].parse().unwrap(),
                )
            }
        };
        let entry = schemas
            .entry((stream_name, stream_type))
            .or_insert(Vec::new());
        entry.push((val, start_dt));
    }
    Ok(schemas
        .into_iter()
        .map(|((stream_name, stream_type), versions)| {
            let latest = versions
                .iter()
                .max_by_key(|(_, start_dt)| *start_dt)
                .map(|(val, _)| {
                    let mut schema: Vec<Schema> = json::from_slice(val).unwrap();
                    if !schema.is_empty() {
                        schema.remove(schema.len() - 1)
                    } else {
                        Schema::empty()
                    }
                })
                .unwrap_or_else(Schema::empty);
            // When the caller didn't request full schema, drop the field list
            // but keep the metadata so settings (e.g. `is_llm_stream`) survive.
            let schema = if fetch_schema {
                latest
            } else {
                Schema::empty().with_metadata(latest.metadata().clone())
            };
            StreamSchema {
                stream_name,
                stream_type,
                schema,
            }
        })
        .collect())
}

pub async fn cache() -> Result<(), anyhow::Error> {
    let db_key = "/schema/";
    let items = db::list(db_key).await?;
    let items_num = items.len();
    let mut schemas: HashMap<String, Vec<(i64, Bytes)>> = HashMap::with_capacity(items_num);

    log::info!("Cache schema got {items_num} items");
    for (i, (key, val)) in items.into_iter().enumerate() {
        let key = key.strip_prefix(db_key).unwrap();
        let columns = key.split('/').take(4).collect::<Vec<_>>();
        assert_eq!(columns.len(), 4, "BUG");
        let item_key = format!("{}/{}/{}", columns[0], columns[1], columns[2]);
        let start_dt: i64 = columns[3].parse().unwrap();
        let entry = schemas.entry(item_key).or_insert(Vec::new());
        entry.push((start_dt, val));
        if i.is_multiple_of(1000) {
            log::info!("Cache schema progress: {i}/{items_num}");
        }
    }
    log::info!("Stream schemas Cached {items_num} schemas");
    let keys_num = schemas.keys().len();
    let keys = schemas.keys().map(|k| k.to_string()).collect::<Vec<_>>();
    for (i, item_key) in keys.iter().enumerate() {
        let Some(mut schema_versions) = schemas.remove(item_key) else {
            continue;
        };
        if schema_versions.is_empty() {
            continue;
        }
        schema_versions.sort_by_key(|k| k.0);
        let latest_schema: Vec<Schema> = match json::from_slice(&schema_versions.last().unwrap().1)
        {
            Ok(s) => s,
            Err(e) => {
                // A corrupt or empty schema entry (e.g. an empty or unreadable
                // value in the metadata store) must not bring down the whole process.
                // Log and skip this stream; it can be repaired manually.
                log::error!("Error parsing schema, key: {item_key}, error: {e}; skipping");
                continue;
            }
        };
        if latest_schema.is_empty() {
            continue;
        }
        let latest_schema = latest_schema.last().unwrap();
        let settings = unwrap_stream_settings(latest_schema).unwrap_or_default();
        if (settings.store_original_data || settings.index_original_data)
            && let dashmap::Entry::Vacant(entry) =
                STREAM_RECORD_ID_GENERATOR.entry(item_key.to_string())
        {
            entry.insert(SnowflakeIdGenerator::new(
                LOCAL_NODE_ID.load(Ordering::Relaxed),
            ));
        }
        let mut w = STREAM_SETTINGS.write().await;
        w.insert(item_key.to_string(), settings);
        infra::schema::set_stream_settings_atomic(w.clone());
        drop(w);
        let mut w = STREAM_SCHEMAS_LATEST.write().await;
        w.insert(
            item_key.to_string(),
            SchemaCache::new(latest_schema.clone()),
        );
        drop(w);
        let schema_versions = schema_versions
            .into_iter()
            .filter_map(
                |(start_dt, data)| match json::from_slice::<Vec<Schema>>(&data) {
                    Ok(mut v) => v.pop().map(|s| (start_dt, s)),
                    Err(e) => {
                        log::error!(
                            "Error parsing schema version, key: {item_key}, \
                             start_dt: {start_dt}, error: {e}; skipping version"
                        );
                        None
                    }
                },
            )
            .collect::<Vec<_>>();
        let mut w = STREAM_SCHEMAS.write().await;
        w.insert(item_key.to_string(), schema_versions);
        drop(w);
        if i.is_multiple_of(1000) {
            log::info!("Stream schemas Cached progress: {}/{}", i, keys.len());
        }
    }
    log::info!("Stream schemas Cached {keys_num} streams");
    Ok(())
}

pub fn filter_schema_version_id(schemas: &[Schema], _start_dt: i64, end_dt: i64) -> Option<usize> {
    let versions = schemas.len();
    for (i, schema) in schemas.iter().enumerate() {
        let metadata = schema.metadata();
        let schema_end_dt: i64 = metadata
            .get("end_dt")
            .unwrap_or(&"0".to_string())
            .parse()
            .unwrap();
        if end_dt < schema_end_dt {
            return Some(i);
        }
    }
    if versions > 0 {
        Some(versions - 1)
    } else {
        None
    }
}

pub async fn list_organizations_from_cache() -> Vec<String> {
    let mut names = HashSet::new();
    let r = STREAM_SCHEMAS_LATEST.read().await;
    for schema_key in r.keys() {
        if !schema_key.contains('/') {
            continue;
        }
        let name = schema_key.split('/').collect::<Vec<&str>>()[0].to_string();
        if !names.contains(&name) {
            names.insert(name);
        }
    }
    names.into_iter().collect::<Vec<String>>()
}

/// Get stream count for an org+type, cached to avoid per-file schema cache scans.
///
/// Stream counts are mostly stagnant (streams rarely added/removed), so we cache
/// aggressively with a 5-minute TTL. This avoids the cost of iterating all schema
/// keys on every file processed during service discovery.
pub async fn get_stream_count_cached(org_id: &str, stream_type: StreamType) -> u64 {
    use std::{
        collections::HashMap as StdHashMap,
        sync::{LazyLock, RwLock},
        time::Instant,
    };

    static CACHE: LazyLock<RwLock<StdHashMap<String, (u64, Instant)>>> =
        LazyLock::new(|| RwLock::new(StdHashMap::new()));

    const TTL_SECS: u64 = 300; // 5 minutes

    let key = format!("{org_id}/{stream_type}");

    if let Ok(cache) = CACHE.read()
        && let Some((count, ts)) = cache.get(&key)
        && ts.elapsed().as_secs() < TTL_SECS
    {
        return *count;
    }

    let count = list_streams_from_cache(org_id, stream_type).await.len() as u64;
    if let Ok(mut cache) = CACHE.write() {
        cache.insert(key, (count, Instant::now()));
    }
    count
}

pub async fn list_streams_from_cache(org_id: &str, stream_type: StreamType) -> Vec<String> {
    let mut names = HashSet::new();
    let r = STREAM_SCHEMAS_LATEST.read().await;
    for schema_key in r.keys() {
        if !schema_key.contains('/') {
            continue;
        }
        let columns = schema_key.split('/').collect::<Vec<&str>>();
        let cur_org_id = columns[0];
        if !org_id.eq(cur_org_id) {
            continue;
        }
        let cur_stream_type = StreamType::from(columns[1]);
        if !stream_type.eq(&cur_stream_type) {
            continue;
        }
        let cur_stream_name = columns[2].to_string();
        names.insert(cur_stream_name);
    }
    names.into_iter().collect::<Vec<String>>()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use arrow_schema::Schema;

    use super::*;

    fn schema_with_end_dt(end_dt: i64) -> Schema {
        let mut meta = HashMap::new();
        meta.insert("end_dt".to_string(), end_dt.to_string());
        Schema::new_with_metadata(vec![] as Vec<arrow_schema::Field>, meta)
    }

    fn schema_without_end_dt() -> Schema {
        Schema::new_with_metadata(vec![] as Vec<arrow_schema::Field>, HashMap::new())
    }

    // ── filter_schema_version_id ──────────────────────────────────────────────

    #[test]
    fn test_filter_schema_version_id_empty_schemas() {
        assert_eq!(filter_schema_version_id(&[], 0, 1000), None);
    }

    #[test]
    fn test_filter_schema_version_id_single_schema_matches() {
        // end_dt=5000, query end_dt=3000 → 3000 < 5000 → returns index 0
        let schemas = vec![schema_with_end_dt(5000)];
        assert_eq!(filter_schema_version_id(&schemas, 0, 3000), Some(0));
    }

    #[test]
    fn test_filter_schema_version_id_single_schema_no_match_returns_last() {
        // end_dt=1000, query end_dt=2000 → 2000 is NOT < 1000 → fallback to last (index 0)
        let schemas = vec![schema_with_end_dt(1000)];
        assert_eq!(filter_schema_version_id(&schemas, 0, 2000), Some(0));
    }

    #[test]
    fn test_filter_schema_version_id_multiple_schemas_finds_first_match() {
        // Three versions with end_dt: 1000, 5000, 9000
        // Query end_dt = 3000 → 3000 < 5000 at index 1 → returns 1
        let schemas = vec![
            schema_with_end_dt(1000),
            schema_with_end_dt(5000),
            schema_with_end_dt(9000),
        ];
        assert_eq!(filter_schema_version_id(&schemas, 0, 3000), Some(1));
    }

    #[test]
    fn test_filter_schema_version_id_query_before_all_versions() {
        // end_dt values: 1000, 2000, 3000; query end_dt = 500 → 500 < 1000 → index 0
        let schemas = vec![
            schema_with_end_dt(1000),
            schema_with_end_dt(2000),
            schema_with_end_dt(3000),
        ];
        assert_eq!(filter_schema_version_id(&schemas, 0, 500), Some(0));
    }

    #[test]
    fn test_filter_schema_version_id_query_after_all_versions() {
        // end_dt values: 1000, 2000, 3000; query end_dt = 5000 → no match → last index (2)
        let schemas = vec![
            schema_with_end_dt(1000),
            schema_with_end_dt(2000),
            schema_with_end_dt(3000),
        ];
        assert_eq!(filter_schema_version_id(&schemas, 0, 5000), Some(2));
    }

    #[test]
    fn test_filter_schema_version_id_schema_missing_end_dt_metadata() {
        // Schema without end_dt → parses as 0 → any end_dt ≥ 0 never satisfies end_dt < 0
        // so falls through to last-index fallback
        let schemas = vec![schema_without_end_dt()];
        // query end_dt = 100 → 100 is NOT < 0 → fallback last index (0)
        assert_eq!(filter_schema_version_id(&schemas, 0, 100), Some(0));
    }

    #[test]
    fn test_filter_schema_version_id_boundary_equal_end_dt() {
        // Condition is strict <, so end_dt == schema end_dt should NOT match
        let schemas = vec![schema_with_end_dt(5000), schema_with_end_dt(9000)];
        // query end_dt = 5000 → 5000 is NOT < 5000 → check next: 5000 < 9000 → returns 1
        assert_eq!(filter_schema_version_id(&schemas, 0, 5000), Some(1));
    }

    #[test]
    fn test_append_gen_ai_fields_to_defined_schema_fields_skips_non_uds_streams() {
        let mut fields = Vec::new();

        let updated = append_gen_ai_fields_to_defined_schema_fields(&mut fields);

        assert!(!updated);
        assert!(fields.is_empty());
    }

    #[test]
    fn test_append_gen_ai_fields_to_defined_schema_fields_adds_missing_cache_fields() {
        let mut fields = vec![
            "trace_id".to_string(),
            "gen_ai_usage_input_tokens".to_string(),
        ];

        let updated = append_gen_ai_fields_to_defined_schema_fields(&mut fields);

        assert!(updated);
        assert!(fields.contains(&"trace_id".to_string()));
        assert!(fields.contains(&"gen_ai_usage_cache_read_input_tokens".to_string()));
        assert!(fields.contains(&"gen_ai_usage_cache_creation_input_tokens".to_string()));
        assert!(fields.contains(&"gen_ai_usage_cost_net_cache_impact".to_string()));
    }

    #[test]
    fn test_append_gen_ai_fields_to_defined_schema_fields_is_idempotent() {
        let mut fields = vec!["trace_id".to_string()];

        assert!(append_gen_ai_fields_to_defined_schema_fields(&mut fields));
        let len_after_first_append = fields.len();

        assert!(!append_gen_ai_fields_to_defined_schema_fields(&mut fields));
        assert_eq!(fields.len(), len_after_first_append);
    }
}
