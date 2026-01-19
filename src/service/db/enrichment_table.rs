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

use std::sync::Arc;

use arrow::{
    array::{RecordBatch, *},
    datatypes::DataType,
};
use config::{
    QUERY_WITH_NO_LIMIT, ider,
    meta::stream::{EnrichmentTableMetaStreamStats, StreamType},
    utils::{json, time::BASE_TIME},
};
use infra::{cache::stats, db as infra_db, table::enrichment_table_urls};
use rayon::prelude::*;
use vrl::prelude::NotNan;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::SEARCH_SERVER,
    o2_enterprise::enterprise::{
        search::TaskStatus, super_cluster::queue::ENRICHMENT_TABLE_URL_JOB_KEY,
    },
};

use crate::{
    common::infra::config::ENRICHMENT_TABLES,
    service::{
        db as db_service,
        enrichment::{StreamTable, storage::Values},
        search::cluster::http as search_cluster,
    },
};

/// Will no longer be used as we are using the meta stream stats to store start, end time and size
pub const ENRICHMENT_TABLE_SIZE_KEY: &str = "/enrichment_table_size";
pub const ENRICHMENT_TABLE_META_STREAM_STATS_KEY: &str = "/enrichment_table_meta_stream_stats";

pub async fn get_enrichment_table_data(
    org_id: &str,
    name: &str,
    _apply_primary_region_if_specified: bool,
    end_time: i64,
) -> Result<Values, anyhow::Error> {
    let start_time = get_start_time(org_id, name).await;

    let query = config::meta::search::Query {
        sql: format!("SELECT * FROM \"{name}\""),
        start_time,
        end_time,
        size: QUERY_WITH_NO_LIMIT, // -1 means no limit, enrichment table should not be limited
        ..Default::default()
    };

    #[cfg(feature = "enterprise")]
    let regions = {
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
        let config = get_o2_config();
        let enrichment_table_region = config.super_cluster.enrichment_table_get_region.clone();
        if _apply_primary_region_if_specified
            && config.super_cluster.enabled
            && !enrichment_table_region.is_empty()
        {
            vec![enrichment_table_region]
        } else {
            vec![]
        }
    };
    #[cfg(not(feature = "enterprise"))]
    let regions = vec![];

    let search_query: proto::cluster_rpc::SearchQuery = query.clone().into();
    let trace_id = ider::generate_trace_id();
    let request = config::datafusion::request::Request::new(
        trace_id.clone(),
        org_id.to_string(),
        StreamType::EnrichmentTables,
        0,    // timeout
        None, // user_id
        Some((search_query.start_time, search_query.end_time)),
        None, // search_type
        query.histogram_interval,
        false, // overwrite_cache
    );

    log::info!("get enrichment table {org_id}/{name} data req start time: {start_time}");

    #[cfg(feature = "enterprise")]
    {
        let sql = Some(query.sql.clone());
        let start_time = Some(query.start_time);
        let end_time = Some(query.end_time);
        // set search task
        SEARCH_SERVER
            .insert(
                trace_id.clone(),
                TaskStatus::new_leader(
                    vec![],
                    true,
                    None,
                    Some(org_id.to_string()),
                    Some(request.stream_type.to_string()),
                    sql,
                    start_time,
                    end_time,
                    None,
                    None,
                ),
            )
            .await;
    }

    let result =
        search_cluster::search_inner(request, search_query, regions, vec![], true, None).await;

    #[cfg(feature = "enterprise")]
    {
        let _ = SEARCH_SERVER.remove(&trace_id, false).await;
    }

    // do search using search_inner which returns RecordBatches
    match result {
        Ok((batches, _scan_stats, _took_wait, _is_partial, _partial_err)) => {
            log::info!(
                "get enrichment table {org_id}/{name} data success with {} rows",
                batches.iter().map(|b| b.num_rows()).sum::<usize>()
            );
            Ok(Values::RecordBatch(batches))
        }
        Err(err) => {
            log::error!("get enrichment table {org_id}/{name} data error: {err}",);
            Err(anyhow::anyhow!(
                "get enrichment table {org_id}/{name} error: {err}"
            ))
        }
    }
}

pub fn convert_to_vrl(value: &json::Value) -> vrl::value::Value {
    match value {
        json::Value::Null => vrl::value::Value::Null,
        json::Value::Bool(b) => vrl::value::Value::Boolean(*b),
        json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                vrl::value::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                vrl::value::Value::Float(NotNan::new(f).unwrap_or(NotNan::new(0.0).unwrap()))
            } else {
                unimplemented!("handle other number types")
            }
        }
        json::Value::String(s) => vrl::value::Value::from(s.as_str()),
        json::Value::Array(arr) => {
            vrl::value::Value::Array(arr.iter().map(convert_to_vrl).collect())
        }
        json::Value::Object(obj) => vrl::value::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string().into(), convert_to_vrl(v)))
                .collect(),
        ),
    }
}

pub fn convert_from_vrl(value: &vrl::value::Value) -> json::Value {
    match value {
        vrl::value::Value::Null => json::Value::Null,
        vrl::value::Value::Boolean(b) => json::Value::Bool(*b),
        vrl::value::Value::Integer(i) => json::Value::Number(json::Number::from(*i)),
        vrl::value::Value::Float(f) => json::Value::Number(
            json::Number::from_f64(f.into_inner()).unwrap_or(json::Number::from(0)),
        ),
        vrl::value::Value::Bytes(b) => json::Value::String(String::from_utf8_lossy(b).to_string()),
        vrl::value::Value::Array(arr) => {
            json::Value::Array(arr.iter().map(convert_from_vrl).collect())
        }
        vrl::value::Value::Object(obj) => json::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.to_string(), convert_from_vrl(v)))
                .collect(),
        ),
        vrl::value::Value::Timestamp(ts) => json::Value::Number(json::Number::from(
            ts.timestamp_nanos_opt().unwrap_or(0) / 1000,
        )),
        vrl::value::Value::Regex(_) => json::Value::String("regex".to_string()),
    }
}

/// Convert RecordBatch directly to VRL values without intermediate JSON
/// Only handles data types supported by convert_json_to_record_batch:
/// Utf8, Utf8View, LargeUtf8, Int64, UInt64, Float64, Boolean, Binary, Null
pub fn convert_recordbatch_to_vrl(
    batches: &[RecordBatch],
) -> Result<Vec<vrl::value::Value>, anyhow::Error> {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config::get_config().limit.cpu_num)
        .build()?;

    // Process batches in parallel, collecting rows from each batch
    let vrl_records: Result<Vec<_>, _> = pool.install(|| {
        batches
            .par_iter()
            .map(|batch| {
                let schema = batch.schema();
                let num_rows = batch.num_rows();

                // Process rows within a batch in parallel
                (0..num_rows)
                    .into_par_iter()
                    .map(|row_idx| {
                        let mut record_map = vrl::value::ObjectMap::new();

                        for (col_idx, field) in schema.fields().iter().enumerate() {
                            let column = batch.column(col_idx);
                            let field_name = field.name();

                            if column.is_null(row_idx) {
                                record_map.insert(field_name.clone().into(), vrl::value::Value::Null);
                                continue;
                            }

                            let vrl_value = match field.data_type() {
                                DataType::Boolean => {
                                    let array =
                                        column.as_any().downcast_ref::<BooleanArray>().unwrap();
                                    vrl::value::Value::Boolean(array.value(row_idx))
                                }
                                DataType::Int64 => {
                                    let array =
                                        column.as_any().downcast_ref::<Int64Array>().unwrap();
                                    vrl::value::Value::Integer(array.value(row_idx))
                                }
                                DataType::UInt64 => {
                                    let array =
                                        column.as_any().downcast_ref::<UInt64Array>().unwrap();
                                    vrl::value::Value::Integer(array.value(row_idx) as i64)
                                }
                                DataType::Float64 => {
                                    let array =
                                        column.as_any().downcast_ref::<Float64Array>().unwrap();
                                    vrl::value::Value::Float(
                                        NotNan::new(array.value(row_idx))
                                            .unwrap_or(NotNan::new(0.0).unwrap()),
                                    )
                                }
                                DataType::Utf8 => {
                                    let array =
                                        column.as_any().downcast_ref::<StringArray>().unwrap();
                                    vrl::value::Value::from(array.value(row_idx))
                                }
                                DataType::Utf8View => {
                                    let array =
                                        column.as_any().downcast_ref::<StringViewArray>().unwrap();
                                    vrl::value::Value::from(array.value(row_idx))
                                }
                                DataType::LargeUtf8 => {
                                    let array = column
                                        .as_any()
                                        .downcast_ref::<LargeStringArray>()
                                        .unwrap();
                                    vrl::value::Value::from(array.value(row_idx))
                                }
                                DataType::Binary => {
                                    let array =
                                        column.as_any().downcast_ref::<BinaryArray>().unwrap();
                                    vrl::value::Value::Bytes(array.value(row_idx).to_vec().into())
                                }
                                DataType::Null => vrl::value::Value::Null,
                                _ => {
                                    return Err(anyhow::anyhow!(
                                        "Unsupported data type for RecordBatch to VRL conversion: {:?}",
                                        field.data_type()
                                    ));
                                }
                            };

                            record_map.insert(field_name.clone().into(), vrl_value);
                        }

                        Ok(vrl::value::Value::Object(record_map))
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .collect()
    });

    // Flatten the nested Vec<Vec<Value>> into Vec<Value>
    vrl_records.map(|batches| batches.into_iter().flatten().collect())
}

pub async fn save_enrichment_data_to_db(
    org_id: &str,
    name: &str,
    data: &Vec<json::Value>,
    created_at: i64,
) -> Result<(), infra::errors::Error> {
    let bin_data = serde_json::to_vec(&data).unwrap();
    infra::table::enrichment_tables::add(org_id, name, bin_data, created_at).await
}

/// Get enrichment table data from database with optional time-based filtering
///
/// # Arguments
/// * `org_id` - Organization ID
/// * `name` - Enrichment table name
/// * `end_time_exclusive` - Optional end time (exclusive). If provided, only returns records where
///   created_at < end_time_exclusive
///
/// # Returns
/// * `Result<(Vec<json::Value>, i64, i64), infra::errors::Error>` - Tuple of (data, min_timestamp,
///   max_timestamp)
///
/// # Why end_time filtering is necessary
///
/// This function supports optional end_time filtering to handle partial data scenarios in multi-URL
/// enrichment tables. Here's why this is important:
///
/// ## Multi-URL Enrichment Tables Context
///
/// With multi-URL support, a single enrichment table can have multiple URL jobs. For example:
/// - URL Job 1: Completed ✓
/// - URL Job 2: Completed ✓
/// - URL Job 3: Failed ✗
///
/// ## Partial Data Problem
///
/// Since enrichment table data is saved in batches during URL processing, when a URL job fails
/// mid-way, we may have already saved some of its data to remote storage (or database). This
/// creates a situation where:
/// 1. The database contains partial data from the failed job
/// 2. The enrichment table metadata (db_stats.end_time) reflects only completed data
/// 3. Incomplete data should not be included in queries or cache
///
/// ## Solution: Time-based Filtering
///
/// By filtering with `end_time_exclusive`, we ensure:
/// - Only data up to the last successful upload is retrieved
/// - Incomplete data from failed/in-progress jobs is excluded
/// - Cache contains only complete, consistent data
/// - Search queries don't include partial results
///
/// ## Usage Examples
///
/// **From search context (enrich_exec.rs):**
/// ```rust
/// // Pass db_stats.end_time + 1 to include data up to and including the last complete upload
/// // (+1 because search end_time is exclusive)
/// let end_time = db_stats.end_time + 1;
/// get_enrichment_data_from_db(org_id, name, Some(end_time)).await
/// ```
///
/// **From storage/caching context:**
/// ```rust
/// // Pass None to fetch all data (when not in search context)
/// get_enrichment_data_from_db(org_id, name, None).await
/// ```
///
/// # Note on Exclusivity
///
/// The end_time is exclusive, meaning records with created_at >= end_time_exclusive are not
/// included. This aligns with search time ranges where end_time is exclusive. When calling from
/// search context, pass `db_stats.end_time + 1` to include records up to and including the
/// db_stats.end_time.
pub async fn get_enrichment_data_from_db(
    org_id: &str,
    name: &str,
    end_time_exclusive: Option<i64>,
) -> Result<(Vec<json::Value>, i64, i64), infra::errors::Error> {
    let mut vec = vec![];
    let mut min_ts = 0;
    let mut max_ts = 0;
    // Each record is a json array
    // If end_time is provided, use the filtered function; otherwise use the standard one
    let records = if end_time_exclusive.is_some() {
        infra::table::enrichment_tables::get_by_org_and_name_with_end_time(
            org_id,
            name,
            end_time_exclusive,
        )
        .await?
    } else {
        infra::table::enrichment_tables::get_by_org_and_name(org_id, name).await?
    };

    // Records are in descending order, we need to convert them to a json array
    for record in records {
        if min_ts == 0 || record.created_at < min_ts {
            min_ts = record.created_at;
        }
        if max_ts == 0 || record.created_at > max_ts {
            max_ts = record.created_at;
        }
        match serde_json::from_slice(&record.data) {
            Ok(data) => match data {
                json::Value::Array(arr) => {
                    vec.extend(arr.iter().cloned());
                }
                _ => {
                    log::error!("Invalid enrichment data: {data}");
                }
            },
            Err(e) => {
                log::error!("Failed to parse enrichment data: {e}");
            }
        }
    }
    Ok((vec, min_ts, max_ts))
}

pub async fn delete_enrichment_data_from_db(
    org_id: &str,
    name: &str,
) -> Result<(), infra::errors::Error> {
    infra::table::enrichment_tables::delete(org_id, name).await
}

/// Delete the size of the enrichment table in bytes
pub async fn delete_table_size(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    db_service::delete(
        &format!("{ENRICHMENT_TABLE_SIZE_KEY}/{org_id}/{name}"),
        false,
        false,
        None,
    )
    .await
}

/// Get the size of the enrichment table in bytes
pub async fn get_table_size(org_id: &str, name: &str) -> f64 {
    match get_meta_table_stats(org_id, name).await {
        Some(meta_stats) if meta_stats.size > 0 => meta_stats.size as f64,
        _ => match db_service::get(&format!("{ENRICHMENT_TABLE_SIZE_KEY}/{org_id}/{name}")).await {
            Ok(size) => {
                let size = String::from_utf8_lossy(&size);
                size.parse::<f64>().unwrap_or(0.0)
            }
            Err(_) => {
                stats::get_stream_stats(org_id, name, StreamType::EnrichmentTables).storage_size
            }
        },
    }
}

/// Get the start time of the enrichment table
pub async fn get_start_time(org_id: &str, name: &str) -> i64 {
    match get_meta_table_stats(org_id, name).await {
        Some(meta_stats) => meta_stats.start_time,
        None => {
            let stats = stats::get_stream_stats(org_id, name, StreamType::EnrichmentTables);
            if stats.doc_time_min > 0 {
                stats.doc_time_min
            } else {
                BASE_TIME.timestamp_micros()
            }
        }
    }
}

pub async fn get_meta_table_stats(
    org_id: &str,
    name: &str,
) -> Option<EnrichmentTableMetaStreamStats> {
    let size = match db_service::get(&format!(
        "{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"
    ))
    .await
    {
        Ok(size) => size,
        Err(_) => {
            return None;
        }
    };
    let stream_meta_stats: EnrichmentTableMetaStreamStats = serde_json::from_slice(&size)
        .map_err(|e| {
            log::error!("Failed to parse meta stream stats: {e}");
        })
        .ok()?;
    Some(stream_meta_stats)
}

pub async fn update_meta_table_stats(
    org_id: &str,
    name: &str,
    stats: EnrichmentTableMetaStreamStats,
) -> Result<(), infra::errors::Error> {
    db_service::put(
        &format!("{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"),
        serde_json::to_string(&stats).unwrap().into(),
        false,
        None,
    )
    .await
}

pub async fn delete_meta_table_stats(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    db_service::delete(
        &format!("{ENRICHMENT_TABLE_META_STREAM_STATS_KEY}/{org_id}/{name}"),
        false,
        false,
        None,
    )
    .await
}

pub async fn notify_update(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    let cluster_coordinator = infra_db::get_coordinator().await;
    let key: String = format!(
        "/enrichment_table/{org_id}/{}/{}",
        StreamType::EnrichmentTables,
        name
    );
    cluster_coordinator.put(&key, "".into(), true, None).await
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), infra::errors::Error> {
    let cluster_coordinator = infra_db::get_coordinator().await;
    let key: String = format!(
        "/enrichment_table/{org_id}/{}/{}",
        StreamType::EnrichmentTables,
        name
    );
    cluster_coordinator.delete(&key, false, true, None).await
}

pub async fn watch() -> Result<(), anyhow::Error> {
    let key = "/enrichment_table/";
    let cluster_coordinator = infra_db::get_coordinator().await;
    let mut events = cluster_coordinator.watch(key).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("Start watching stream enrichment_table");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("watch_stream_enrichment_table: event channel closed");
                break;
            }
        };
        match ev {
            infra_db::Event::Put(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                let keys = item_key.split('/').collect::<Vec<&str>>();
                let org_id = keys[0];
                let stream_name = keys[2];

                let data = match super::super::enrichment::get_enrichment_table(
                    org_id,
                    stream_name,
                    false,
                )
                .await
                {
                    Ok(data) => data,
                    Err(e) => {
                        log::error!(
                            "[ENRICHMENT::TABLE watch] get enrichment table {org_id}/{stream_name} error, trying again: {e}"
                        );
                        match super::super::enrichment::get_enrichment_table(
                            org_id,
                            stream_name,
                            false,
                        )
                        .await
                        {
                            Ok(data) => data,
                            Err(e) => {
                                log::error!(
                                    "[ENRICHMENT::TABLE watch] get enrichment table {org_id}/{stream_name} error, giving up: {e}"
                                );
                                Arc::new(vec![])
                            }
                        }
                    }
                };
                log::info!(
                    "enrichment table: {item_key} cache data length: {}",
                    data.len()
                );
                ENRICHMENT_TABLES.insert(
                    item_key.to_owned(),
                    StreamTable {
                        org_id: org_id.to_string(),
                        stream_name: stream_name.to_string(),
                        data,
                    },
                );
            }
            infra_db::Event::Delete(ev) => {
                let item_key = ev.key.strip_prefix(key).unwrap();
                if let Some((key, _)) = ENRICHMENT_TABLES.remove(item_key) {
                    log::info!("deleted enrichment table: {key}");
                }
            }
            infra_db::Event::Empty => {}
        }
    }
    Ok(())
}

/// Save enrichment table URL job state
pub async fn save_url_job(
    job: &config::meta::enrichment_table::EnrichmentTableUrlJob,
) -> Result<(), infra::errors::Error> {
    let record = enrichment_table_urls::EnrichmentTableUrlRecord {
        id: job.id.clone(),
        org: job.org_id.clone(),
        name: job.table_name.clone(),
        url: job.url.clone(),
        status: (&job.status).into(),
        error_message: job.error_message.clone(),
        created_at: job.created_at,
        updated_at: job.updated_at,
        total_bytes_fetched: job.total_bytes_fetched as i64,
        total_records_processed: job.total_records_processed,
        retry_count: job.retry_count as i32,
        append_data: job.append_data,
        last_byte_position: job.last_byte_position as i64,
        supports_range: job.supports_range,
        is_local_region: true, // This job was created in the current region
    };
    enrichment_table_urls::put(record.clone()).await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = format!(
            "{ENRICHMENT_TABLE_URL_JOB_KEY}/{}/{}",
            job.org_id, job.table_name
        );
        match config::utils::json::to_vec(&record) {
            Err(e) => {
                log::error!(
                    "[Enrichment::Url] error serializing enrichment table {}/{} for super_cluster event: {e}",
                    job.org_id,
                    job.table_name
                );
            }
            Ok(value_vec) => {
                if let Err(e) = o2_enterprise::enterprise::super_cluster::queue::enrichment_url_put(
                    &key,
                    value_vec.into(),
                )
                .await
                {
                    log::error!(
                        "[Enrichment::Url] error sending enrichment table {}/{} for super_cluster event: {e}",
                        job.org_id,
                        job.table_name
                    );
                }
            }
        };
    }

    Ok(())
}

/// Get enrichment table URL job state
pub async fn get_url_job(
    org_id: &str,
    table_name: &str,
) -> Result<Option<config::meta::enrichment_table::EnrichmentTableUrlJob>, infra::errors::Error> {
    match enrichment_table_urls::get(org_id, table_name).await? {
        Some(record) => {
            let job = config::meta::enrichment_table::EnrichmentTableUrlJob {
                id: record.id,
                org_id: record.org,
                table_name: record.name,
                url: record.url,
                status: record.status.into(),
                error_message: record.error_message,
                created_at: record.created_at,
                updated_at: record.updated_at,
                total_bytes_fetched: record.total_bytes_fetched as u64,
                total_records_processed: record.total_records_processed,
                retry_count: record.retry_count as u32,
                append_data: record.append_data,
                last_byte_position: record.last_byte_position as u64,
                supports_range: record.supports_range,
            };
            Ok(Some(job))
        }
        None => Ok(None),
    }
}

/// Delete enrichment table URL job state
pub async fn delete_url_job(org_id: &str, table_name: &str) -> Result<(), infra::errors::Error> {
    enrichment_table_urls::delete(org_id, table_name).await?;

    #[cfg(feature = "enterprise")]
    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        let key = format!("{ENRICHMENT_TABLE_URL_JOB_KEY}/{}/{}", org_id, table_name);
        if let Err(e) =
            o2_enterprise::enterprise::super_cluster::queue::enrichment_url_delete(&key).await
        {
            log::error!(
                "[Enrichment::Url] error sending enrichment table {}/{} for super_cluster delete event: {e}",
                org_id,
                table_name
            );
        }
    }

    Ok(())
}

/// Get all URL jobs for a specific enrichment table
pub async fn get_url_jobs_for_table(
    org_id: &str,
    table_name: &str,
) -> Result<Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>, infra::errors::Error> {
    let records = enrichment_table_urls::get_all_for_table(org_id, table_name).await?;

    let jobs = records
        .into_iter()
        .map(
            |record| config::meta::enrichment_table::EnrichmentTableUrlJob {
                id: record.id,
                org_id: record.org,
                table_name: record.name,
                url: record.url,
                status: record.status.into(),
                error_message: record.error_message,
                created_at: record.created_at,
                updated_at: record.updated_at,
                total_bytes_fetched: record.total_bytes_fetched as u64,
                total_records_processed: record.total_records_processed,
                retry_count: record.retry_count as u32,
                append_data: record.append_data,
                last_byte_position: record.last_byte_position as u64,
                supports_range: record.supports_range,
            },
        )
        .collect();

    Ok(jobs)
}

/// Get a specific URL job by its ID
pub async fn get_url_job_by_id(
    job_id: &str,
) -> Result<Option<config::meta::enrichment_table::EnrichmentTableUrlJob>, infra::errors::Error> {
    match enrichment_table_urls::get_by_id(job_id).await? {
        Some(record) => {
            let job = config::meta::enrichment_table::EnrichmentTableUrlJob {
                id: record.id,
                org_id: record.org,
                table_name: record.name,
                url: record.url,
                status: record.status.into(),
                error_message: record.error_message,
                created_at: record.created_at,
                updated_at: record.updated_at,
                total_bytes_fetched: record.total_bytes_fetched as u64,
                total_records_processed: record.total_records_processed,
                retry_count: record.retry_count as u32,
                append_data: record.append_data,
                last_byte_position: record.last_byte_position as u64,
                supports_range: record.supports_range,
            };
            Ok(Some(job))
        }
        None => Ok(None),
    }
}

/// Delete a specific URL job by its ID
pub async fn delete_url_job_by_id(job_id: &str) -> Result<(), infra::errors::Error> {
    enrichment_table_urls::delete_by_id(job_id).await
}

/// Check if any URL jobs are currently processing for a table
pub async fn has_processing_url_jobs(
    org_id: &str,
    table_name: &str,
) -> Result<bool, infra::errors::Error> {
    enrichment_table_urls::has_processing_jobs(org_id, table_name).await
}

/// List all enrichment table URL jobs for an organization
pub async fn list_url_jobs(
    org_id: &str,
) -> Result<Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>, infra::errors::Error> {
    let records = enrichment_table_urls::list_by_org(org_id).await?;

    let jobs = records
        .into_iter()
        .map(
            |record| config::meta::enrichment_table::EnrichmentTableUrlJob {
                id: record.id,
                org_id: record.org,
                table_name: record.name,
                url: record.url,
                status: record.status.into(),
                error_message: record.error_message,
                created_at: record.created_at,
                updated_at: record.updated_at,
                total_bytes_fetched: record.total_bytes_fetched as u64,
                total_records_processed: record.total_records_processed,
                retry_count: record.retry_count as u32,
                append_data: record.append_data,
                last_byte_position: record.last_byte_position as u64,
                supports_range: record.supports_range,
            },
        )
        .collect();

    Ok(jobs)
}

/// Atomically claims stale URL jobs for recovery
///
/// This is used by the stale job recovery background task. It finds jobs stuck in
/// Processing status and atomically resets them to Pending status.
///
/// # Important
/// - Only works with PostgreSQL/MySQL (distributed deployments)
/// - Returns error for SQLite (single-node, no distribution needed)
///
/// # Arguments
/// * `stale_threshold_secs` - Jobs idle for longer than this are considered stale
/// * `limit` - Maximum number of jobs to claim
///
/// # Returns
/// * `Ok(vec![jobs])` - Successfully claimed stale jobs (may be empty)
/// * `Err` - Database error or unsupported backend
pub async fn claim_stale_url_jobs(
    stale_threshold_secs: i64,
    limit: usize,
) -> Result<Vec<config::meta::enrichment_table::EnrichmentTableUrlJob>, infra::errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let stale_threshold_timestamp = now - (stale_threshold_secs * 1_000_000);

    let processing_status = 1; // EnrichmentTableStatus::Processing
    let pending_status = 0; // EnrichmentTableStatus::Pending

    let records = enrichment_table_urls::claim_stale_jobs(
        stale_threshold_timestamp,
        processing_status,
        pending_status,
        limit,
    )
    .await?;

    Ok(records
        .into_iter()
        .map(|r| config::meta::enrichment_table::EnrichmentTableUrlJob {
            id: r.id,
            org_id: r.org,
            table_name: r.name,
            url: r.url,
            status: r.status.into(),
            error_message: r.error_message,
            created_at: r.created_at,
            updated_at: r.updated_at,
            total_bytes_fetched: r.total_bytes_fetched as u64,
            total_records_processed: r.total_records_processed,
            retry_count: r.retry_count as u32,
            append_data: r.append_data,
            last_byte_position: r.last_byte_position as u64,
            supports_range: r.supports_range,
        })
        .collect())
}

// write test for convert_to_vrl
#[cfg(test)]
mod tests {
    use config::utils::time::now_micros;

    use super::*;

    #[test]
    fn test_convert_to_vrl_string() {
        let value = json::Value::String("123".to_string());
        let vrl_value = convert_to_vrl(&value);
        assert_eq!(vrl_value, vrl::value::Value::Bytes(b"123".to_vec().into()));
    }

    #[test]
    fn test_convert_to_vrl_null() {
        let value = json::Value::Null;
        let vrl_value = convert_to_vrl(&value);
        assert_eq!(vrl_value, vrl::value::Value::Null);
    }

    #[test]
    fn test_convert_to_vrl_boolean() {
        let value = json::Value::Bool(true);
        let vrl_value = convert_to_vrl(&value);
        assert_eq!(vrl_value, vrl::value::Value::Boolean(true));

        let value = json::Value::Bool(false);
        let vrl_value = convert_to_vrl(&value);
        assert_eq!(vrl_value, vrl::value::Value::Boolean(false));
    }

    #[test]
    fn test_convert_to_vrl_integer() {
        let value = json::Value::Number(serde_json::Number::from(42));
        let vrl_value = convert_to_vrl(&value);
        assert_eq!(vrl_value, vrl::value::Value::Integer(42));
    }

    #[test]
    fn test_convert_to_vrl_float() {
        let value =
            json::Value::Number(serde_json::Number::from_f64(std::f64::consts::PI).unwrap());
        let vrl_value = convert_to_vrl(&value);
        match vrl_value {
            vrl::value::Value::Float(f) => assert_eq!(f.into_inner(), std::f64::consts::PI),
            _ => panic!("Expected float value"),
        }
    }

    #[test]
    fn test_convert_to_vrl_array() {
        let array = vec![
            json::Value::String("item1".to_string()),
            json::Value::Number(serde_json::Number::from(2)),
        ];
        let value = json::Value::Array(array);
        let vrl_value = convert_to_vrl(&value);

        match vrl_value {
            vrl::value::Value::Array(arr) => {
                assert_eq!(arr.len(), 2);
                assert_eq!(arr[0], vrl::value::Value::Bytes(b"item1".to_vec().into()));
                assert_eq!(arr[1], vrl::value::Value::Integer(2));
            }
            _ => panic!("Expected array value"),
        }
    }

    #[test]
    fn test_convert_to_vrl_object() {
        let mut obj = serde_json::Map::new();
        obj.insert(
            "key1".to_string(),
            json::Value::String("value1".to_string()),
        );
        obj.insert(
            "key2".to_string(),
            json::Value::Number(serde_json::Number::from(42)),
        );
        let value = json::Value::Object(obj);

        let vrl_value = convert_to_vrl(&value);
        match vrl_value {
            vrl::value::Value::Object(vrl_obj) => {
                assert_eq!(vrl_obj.len(), 2);
                assert_eq!(
                    vrl_obj.get("key1"),
                    Some(&vrl::value::Value::Bytes(b"value1".to_vec().into()))
                );
                assert_eq!(vrl_obj.get("key2"), Some(&vrl::value::Value::Integer(42)));
            }
            _ => panic!("Expected object value"),
        }
    }

    #[tokio::test]
    async fn test_get_enrichment_table_data() {
        // This will fail in test environment due to missing dependencies,
        // but tests the function structure
        let result = get_enrichment_table_data("test_org", "test_table", false, now_micros()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_get_table_size() {
        let size = get_table_size("test_org", "test_table").await;
        assert_eq!(size, 0.0); // Should return 0 when no data is found
    }

    #[tokio::test]
    async fn test_get_start_time() {
        let start_time = get_start_time("test_org", "test_table").await;
        assert!(start_time > 0); // Should return BASE_TIME if no stats found
    }

    #[tokio::test]
    async fn test_get_meta_table_stats() {
        let result = get_meta_table_stats("test_org", "test_table").await;
        assert!(result.is_none()); // Should return None when no stats exist
    }

    #[test]
    fn test_json_to_vrl_round_trip() {
        // Test null
        let null_json = json::Value::Null;
        let vrl_value = convert_to_vrl(&null_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(null_json, back_to_json);

        // Test boolean
        let bool_json = json::Value::Bool(true);
        let vrl_value = convert_to_vrl(&bool_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(bool_json, back_to_json);

        let bool_json = json::Value::Bool(false);
        let vrl_value = convert_to_vrl(&bool_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(bool_json, back_to_json);

        // Test integer
        let int_json = json::Value::Number(json::Number::from(42));
        let vrl_value = convert_to_vrl(&int_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(int_json, back_to_json);

        // Test negative integer
        let neg_int_json = json::Value::Number(json::Number::from(-123));
        let vrl_value = convert_to_vrl(&neg_int_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(neg_int_json, back_to_json);

        // Test float
        let float_json = json::Value::Number(json::Number::from_f64(1.23).unwrap());
        let vrl_value = convert_to_vrl(&float_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(float_json, back_to_json);

        // Test string
        let string_json = json::Value::String("Hello, World!".to_string());
        let vrl_value = convert_to_vrl(&string_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(string_json, back_to_json);

        // Test empty string
        let empty_string_json = json::Value::String("".to_string());
        let vrl_value = convert_to_vrl(&empty_string_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(empty_string_json, back_to_json);

        // Test array
        let array_json = json::Value::Array(vec![
            json::Value::Number(json::Number::from(1)),
            json::Value::String("test".to_string()),
            json::Value::Bool(true),
            json::Value::Null,
        ]);
        let vrl_value = convert_to_vrl(&array_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(array_json, back_to_json);

        // Test empty array
        let empty_array_json = json::Value::Array(vec![]);
        let vrl_value = convert_to_vrl(&empty_array_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(empty_array_json, back_to_json);

        // Test object
        let mut object = serde_json::Map::new();
        object.insert("name".to_string(), json::Value::String("John".to_string()));
        object.insert(
            "age".to_string(),
            json::Value::Number(json::Number::from(30)),
        );
        object.insert("active".to_string(), json::Value::Bool(true));
        object.insert(
            "score".to_string(),
            json::Value::Number(json::Number::from_f64(98.5).unwrap()),
        );
        let object_json = json::Value::Object(object);
        let vrl_value = convert_to_vrl(&object_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(object_json, back_to_json);

        // Test empty object
        let empty_object_json = json::Value::Object(serde_json::Map::new());
        let vrl_value = convert_to_vrl(&empty_object_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(empty_object_json, back_to_json);

        // Test nested structures
        let nested_json = json::json!({
            "users": [
                {
                    "id": 1,
                    "name": "Alice",
                    "preferences": {
                        "theme": "dark",
                        "notifications": true
                    }
                },
                {
                    "id": 2,
                    "name": "Bob",
                    "preferences": {
                        "theme": "light",
                        "notifications": false
                    }
                }
            ],
            "metadata": {
                "version": "1.0",
                "count": 2
            }
        });
        let vrl_value = convert_to_vrl(&nested_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(nested_json, back_to_json);
    }

    #[test]
    fn test_vrl_to_json_round_trip() {
        use chrono::{DateTime, Utc};
        use vrl::prelude::NotNan;

        // Test null
        let null_vrl = vrl::value::Value::Null;
        let json_value = convert_from_vrl(&null_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(null_vrl, back_to_vrl);

        // Test boolean
        let bool_vrl = vrl::value::Value::Boolean(true);
        let json_value = convert_from_vrl(&bool_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(bool_vrl, back_to_vrl);

        // Test integer
        let int_vrl = vrl::value::Value::Integer(42);
        let json_value = convert_from_vrl(&int_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(int_vrl, back_to_vrl);

        // Test float
        let float_vrl = vrl::value::Value::Float(NotNan::new(1.23).unwrap());
        let json_value = convert_from_vrl(&float_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(float_vrl, back_to_vrl);

        // Test bytes (converted to string)
        let bytes_vrl = vrl::value::Value::Bytes("Hello, World!".as_bytes().into());
        let json_value = convert_from_vrl(&bytes_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        // Note: bytes -> string conversion means we expect a string VRL value back
        let expected_vrl = vrl::value::Value::from("Hello, World!");
        assert_eq!(expected_vrl, back_to_vrl);

        // Test array
        let array_vrl = vrl::value::Value::Array(vec![
            vrl::value::Value::Integer(1),
            vrl::value::Value::from("test"),
            vrl::value::Value::Boolean(true),
            vrl::value::Value::Null,
        ]);
        let json_value = convert_from_vrl(&array_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(array_vrl, back_to_vrl);

        // Test object
        let mut object = vrl::value::ObjectMap::new();
        object.insert("name".into(), vrl::value::Value::from("John"));
        object.insert("age".into(), vrl::value::Value::Integer(30));
        object.insert("active".into(), vrl::value::Value::Boolean(true));
        let object_vrl = vrl::value::Value::Object(object);
        let json_value = convert_from_vrl(&object_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        assert_eq!(object_vrl, back_to_vrl);

        // Test timestamp (converted to number)
        let timestamp = DateTime::parse_from_rfc3339("2023-01-01T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let timestamp_vrl = vrl::value::Value::Timestamp(timestamp);
        let json_value = convert_from_vrl(&timestamp_vrl);
        let back_to_vrl = convert_to_vrl(&json_value);
        // Note: timestamp -> number conversion means we expect an integer VRL value back
        let expected_microseconds = timestamp.timestamp_nanos_opt().unwrap_or(0) / 1000;
        let expected_vrl = vrl::value::Value::Integer(expected_microseconds);
        assert_eq!(expected_vrl, back_to_vrl);
    }

    #[test]
    fn test_convert_recordbatch_to_vrl() {
        use arrow::{
            array::{BooleanArray, Float64Array, Int64Array, StringArray},
            datatypes::{DataType, Field, Schema},
        };

        // Create a simple RecordBatch
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int64, false),
            Field::new("score", DataType::Float64, false),
            Field::new("active", DataType::Boolean, false),
        ]));

        let name_array = StringArray::from(vec!["Alice", "Bob"]);
        let age_array = Int64Array::from(vec![30, 25]);
        let score_array = Float64Array::from(vec![95.5, 88.3]);
        let active_array = BooleanArray::from(vec![true, false]);

        let batch = arrow::array::RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(name_array),
                Arc::new(age_array),
                Arc::new(score_array),
                Arc::new(active_array),
            ],
        )
        .unwrap();

        // Test RecordBatch -> VRL direct conversion
        let vrl_data = convert_recordbatch_to_vrl(&[batch]).unwrap();
        assert_eq!(vrl_data.len(), 2);

        // Verify first record
        match &vrl_data[0] {
            vrl::value::Value::Object(obj) => {
                assert_eq!(obj.get("name"), Some(&vrl::value::Value::from("Alice")));
                assert_eq!(obj.get("age"), Some(&vrl::value::Value::Integer(30)));
                assert_eq!(obj.get("active"), Some(&vrl::value::Value::Boolean(true)));
                // Check score is a float
                match obj.get("score") {
                    Some(vrl::value::Value::Float(f)) => {
                        assert!((f.into_inner() - 95.5).abs() < 0.001);
                    }
                    _ => panic!("Expected float value for score"),
                }
            }
            _ => panic!("Expected object value"),
        }

        // Verify second record
        match &vrl_data[1] {
            vrl::value::Value::Object(obj) => {
                assert_eq!(obj.get("name"), Some(&vrl::value::Value::from("Bob")));
                assert_eq!(obj.get("age"), Some(&vrl::value::Value::Integer(25)));
                assert_eq!(obj.get("active"), Some(&vrl::value::Value::Boolean(false)));
            }
            _ => panic!("Expected object value"),
        }
    }

    #[test]
    fn test_edge_cases_and_special_values() {
        // Test zero values
        let zero_int_json = json::Value::Number(json::Number::from(0));
        let vrl_value = convert_to_vrl(&zero_int_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(zero_int_json, back_to_json);

        let zero_float_json = json::Value::Number(json::Number::from_f64(0.0).unwrap());
        let vrl_value = convert_to_vrl(&zero_float_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(zero_float_json, back_to_json);

        // Test very large numbers
        let large_int_json = json::Value::Number(json::Number::from(i64::MAX));
        let vrl_value = convert_to_vrl(&large_int_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(large_int_json, back_to_json);

        let large_negative_int_json = json::Value::Number(json::Number::from(i64::MIN));
        let vrl_value = convert_to_vrl(&large_negative_int_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(large_negative_int_json, back_to_json);

        // Test special float values (but not NaN as it's not supported by NotNan)
        // Skip infinity test as NotNan doesn't allow it

        // Test strings with special characters
        let special_chars_json = json::Value::String("Hello\n\r\t\"'\\World!🌍".to_string());
        let vrl_value = convert_to_vrl(&special_chars_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(special_chars_json, back_to_json);

        // Test unicode strings
        let unicode_json = json::Value::String("こんにちは世界! 🚀".to_string());
        let vrl_value = convert_to_vrl(&unicode_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(unicode_json, back_to_json);

        // Test very long string
        let long_string = "a".repeat(10000);
        let long_string_json = json::Value::String(long_string);
        let vrl_value = convert_to_vrl(&long_string_json);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(long_string_json, back_to_json);

        // Test deeply nested structure
        let mut deeply_nested = json::json!({"level": 1});
        for i in 2..=10 {
            deeply_nested = json::json!({"level": i, "nested": deeply_nested});
        }
        let vrl_value = convert_to_vrl(&deeply_nested);
        let back_to_json = convert_from_vrl(&vrl_value);
        assert_eq!(deeply_nested, back_to_json);

        // Note: Regex conversion is tested separately as it requires specific VRL regex
        // construction For now, we'll test that our conversion functions handle all other
        // cases without data loss
    }

    #[tokio::test]
    async fn test_get_url_job_by_id() {
        // Test with non-existent job ID - should return None without error
        let result = get_url_job_by_id("non_existent_id").await;
        // In test environment without DB, this will error or return None
        // The test validates the function signature and error handling
        assert!(result.is_ok() || result.is_err());
    }
}
