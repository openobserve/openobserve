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

use std::sync::Arc;

use ::datafusion::arrow::datatypes::Schema;
use config::{
    get_config,
    meta::{
        bitvec::BitVec,
        cluster::RoleGroup,
        search::{self},
        stream::{FileKey, PartitionTimeLevel, StreamPartition, StreamType},
    },
    utils::{inverted_index::split_token, json},
    INDEX_FIELD_NAME_FOR_ALL, QUERY_WITH_NO_LIMIT,
};
use hashbrown::{HashMap, HashSet};
use infra::errors::Result;
use proto::cluster_rpc;
#[cfg(feature = "enterprise")]
use {
    config::metrics,
    infra::dist_lock,
    infra::errors::{Error, ErrorCodes},
};

use super::new_sql::NewSql;
use crate::{common::infra::cluster as infra_cluster, service::file_list};

pub mod cache_multi;
pub mod cacher;
pub mod flight;
pub mod flight_leader;
pub mod http;
#[cfg(feature = "enterprise")]
pub mod super_cluster;

#[cfg(feature = "enterprise")]
#[tracing::instrument(name = "work_group:checking", skip_all, fields(user_id = user_id))]
pub async fn work_group_checking(
    trace_id: &str,
    start: std::time::Instant,
    req: &cluster_rpc::SearchRequest,
    work_group: &Option<o2_enterprise::enterprise::search::WorkGroup>,
    locker: &Option<dist_lock::Locker>,
    user_id: Option<&str>,
) -> Result<()> {
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    if super::SEARCH_SERVER
        .insert_sender(trace_id, abort_sender)
        .await
        .is_err()
    {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[&req.org_id])
            .dec();
        dist_lock::unlock(locker).await?;
        log::warn!("[trace_id {trace_id}] search->cluster: request canceled before enter queue");
        return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!(
            "[trace_id {trace_id}] search->cluster: request canceled before enter queue"
        ))));
    }
    tokio::select! {
        res = work_group_need_wait(trace_id, start, req, work_group, user_id) => {
            match res {
                Ok(_) => {
                    return Ok(());
                },
                Err(e) => {
                    metrics::QUERY_PENDING_NUMS
                        .with_label_values(&[&req.org_id])
                        .dec();
                    dist_lock::unlock(locker).await?;
                    return Err(e);
                }
            }
        }
        _ = async {
            let _ = abort_receiver.await;
        } => {
            metrics::QUERY_PENDING_NUMS
                .with_label_values(&[&req.org_id])
                .dec();
            dist_lock::unlock(locker).await?;
            log::warn!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled");
            return Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery(format!("[trace_id {trace_id}] search->cluster: waiting in queue was canceled"))));
        }
    }
}

#[cfg(feature = "enterprise")]
#[tracing::instrument(name = "work_group:need_wait", skip_all, fields(user_id = user_id))]
pub async fn work_group_need_wait(
    trace_id: &str,
    start: std::time::Instant,
    req: &cluster_rpc::SearchRequest,
    work_group: &Option<o2_enterprise::enterprise::search::WorkGroup>,
    user_id: Option<&str>,
) -> Result<()> {
    loop {
        if start.elapsed().as_millis() as u64 >= req.timeout as u64 * 1000 {
            metrics::QUERY_TIMEOUT_NUMS
                .with_label_values(&[&req.org_id])
                .inc();
            return Err(Error::Message(format!(
                "[trace_id {trace_id}] search: request timeout in queue"
            )));
        }
        match work_group.as_ref().unwrap().need_wait(user_id).await {
            Ok(true) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok(false) => {
                return Ok(());
            }
            Err(e) => {
                return Err(Error::Message(e.to_string()));
            }
        }
    }
}

#[tracing::instrument(skip(sql), fields(org_id = sql.org_id, stream_name = stream_name))]
pub(crate) async fn get_file_list(
    _trace_id: &str,
    sql: &NewSql,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Vec<FileKey> {
    let is_local = get_config().common.meta_store_external
        || infra_cluster::get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
            .await
            .unwrap_or_default()
            .len()
            <= 1;
    let (time_min, time_max) = sql.time_range.unwrap();
    let file_list = file_list::query(
        &sql.org_id,
        stream_name,
        stream_type,
        time_level,
        time_min,
        time_max,
        is_local,
    )
    .await
    .unwrap_or_default();

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if sql
            .match_source(
                stream_name,
                &file,
                false,
                false,
                stream_type,
                partition_keys,
            )
            .await
        {
            files.push(file.to_owned());
        }
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    files
}

fn handle_table_response(
    schema: Arc<Schema>,
    sources: Vec<json::Value>,
) -> (Vec<String>, Vec<json::Value>) {
    let columns = schema
        .fields()
        .iter()
        .map(|f| f.name().to_string())
        .collect::<Vec<_>>();
    let mut table = Vec::with_capacity(sources.len());
    for row in &sources {
        let mut new_row = Vec::with_capacity(columns.len());
        let row = row.as_object().unwrap();
        for column in &columns {
            let value = match row.get(column) {
                Some(v) => v.to_owned(),
                None => json::Value::Null,
            };
            new_row.push(value);
        }
        table.push(json::Value::Array(new_row));
    }
    (columns, table)
}

fn handle_metrics_response(sources: Vec<json::Value>) -> Vec<json::Value> {
    // handle metrics response
    let mut results_metrics: HashMap<String, json::Value> = HashMap::with_capacity(16);
    let mut results_values: HashMap<String, Vec<[json::Value; 2]>> = HashMap::with_capacity(16);
    let cfg = get_config();
    for source in sources {
        let fields = source.as_object().unwrap();
        let mut key = Vec::with_capacity(fields.len());
        fields.iter().for_each(|(k, v)| {
            if *k != cfg.common.column_timestamp && k != "value" {
                key.push(format!("{k}_{v}"));
            }
        });
        let key = key.join("_");
        if !results_metrics.contains_key(&key) {
            let mut fields = fields.clone();
            fields.remove(&cfg.common.column_timestamp);
            fields.remove("value");
            results_metrics.insert(key.clone(), json::Value::Object(fields));
        }
        let entry = results_values.entry(key).or_default();
        let value = [
            fields.get(&cfg.common.column_timestamp).unwrap().to_owned(),
            json::Value::String(fields.get("value").unwrap().to_string()),
        ];
        entry.push(value);
    }

    let mut new_sources = Vec::with_capacity(results_metrics.len());
    for (key, metrics) in results_metrics {
        new_sources.push(json::json!({
            "metrics": metrics,
            "values": results_values.get(&key).unwrap(),
        }));
    }

    new_sources
}

// TODO inverted index
async fn _get_file_list_by_inverted_index(
    meta: Arc<super::sql::Sql>,
    mut idx_req: cluster_rpc::SearchRequest,
    file_list: &[FileKey],
) -> Result<(Vec<FileKey>, usize, usize)> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let stream_type = StreamType::from(idx_req.stream_type.as_str());
    let file_list = file_list
        .iter()
        .map(|f| (&f.key, &f.meta))
        .collect::<HashMap<_, _>>();

    // Get all the unique terms which the user has searched.
    let terms = meta
        .fts_terms
        .iter()
        .map(|t| {
            let tokens = split_token(t, &cfg.common.inverted_index_split_chars);
            tokens
                .into_iter()
                .max_by_key(|key| key.len())
                .unwrap_or_default()
        })
        .collect::<HashSet<String>>();

    let fts_condition = terms
        .iter()
        .map(|x| format!("term LIKE '{x}%'"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let fts_condition = if fts_condition.is_empty() {
        fts_condition
    } else if cfg.common.inverted_index_old_format && stream_type == StreamType::Logs {
        format!(
            "((field = '{}' OR field IS NULL) AND ({}))",
            INDEX_FIELD_NAME_FOR_ALL, fts_condition
        )
    } else {
        format!(
            "(field = '{}' AND ({}))",
            INDEX_FIELD_NAME_FOR_ALL, fts_condition
        )
    };

    // Process index terms
    let index_terms = meta
        .index_terms
        .iter()
        .map(|(field, values)| {
            if values.len() > 1 {
                format!("(field = '{field}' AND term IN ('{}'))", values.join("','"))
            } else {
                format!(
                    "(field = '{field}' AND term = '{}')",
                    values.first().unwrap()
                )
            }
        })
        .collect::<Vec<_>>();
    let index_condition = index_terms.join(" OR ");
    let search_condition = if fts_condition.is_empty() {
        index_condition
    } else if index_condition.is_empty() {
        fts_condition
    } else {
        format!("{} OR {}", fts_condition, index_condition)
    };

    let index_stream_name =
        if get_config().common.inverted_index_old_format && stream_type == StreamType::Logs {
            meta.stream_name.to_string()
        } else {
            format!("{}_{}", meta.stream_name, stream_type)
        };
    let query = format!(
        "SELECT file_name, deleted, segment_ids FROM \"{}\" WHERE {}",
        index_stream_name, search_condition,
    );

    idx_req.stream_type = StreamType::Index.to_string();
    idx_req.query.as_mut().unwrap().sql = query;
    idx_req.query.as_mut().unwrap().from = 0;
    idx_req.query.as_mut().unwrap().size = QUERY_WITH_NO_LIMIT;
    idx_req.query.as_mut().unwrap().uses_zo_fn = false;
    idx_req.query.as_mut().unwrap().track_total_hits = false;
    idx_req.query.as_mut().unwrap().query_fn = "".to_string();

    let idx_resp: search::Response = http::search(idx_req).await?;
    // get deleted file
    let deleted_files = idx_resp
        .hits
        .iter()
        .filter_map(|hit| {
            if hit.get("deleted").unwrap().as_bool().unwrap() {
                Some(hit.get("file_name").unwrap().as_str().unwrap().to_string())
            } else {
                None
            }
        })
        .collect::<HashSet<_>>();

    // Merge bitmap segment_ids of the same file
    let mut idx_file_list: HashMap<String, FileKey> = HashMap::default();
    for item in idx_resp.hits.iter() {
        let filename = match item.get("file_name") {
            None => continue,
            Some(v) => v.as_str().unwrap(),
        };
        if deleted_files.contains(filename) {
            continue;
        }
        let prefixed_filename = format!(
            "files/{}/{}/{}/{}",
            meta.org_id, stream_type, meta.stream_name, filename
        );
        let Some(file_meta) = file_list.get(&prefixed_filename) else {
            continue;
        };
        let segment_ids = match item.get("segment_ids") {
            None => None,
            Some(v) => hex::decode(v.as_str().unwrap()).ok(),
        };
        let entry = idx_file_list
            .entry(prefixed_filename.clone())
            .or_insert(FileKey {
                key: prefixed_filename,
                meta: (*file_meta).clone(),
                deleted: false,
                segment_ids: None,
            });
        match (&entry.segment_ids, &segment_ids) {
            (Some(_), None) => {}
            (Some(bin_data), Some(segment_ids)) => {
                let mut bv = BitVec::from_slice(bin_data);
                bv |= BitVec::from_slice(segment_ids);
                entry.segment_ids = Some(bv.into_vec());
            }
            (None, _) => {
                entry.segment_ids = segment_ids;
            }
        }
    }
    let mut idx_file_list = idx_file_list
        .into_iter()
        .map(|(_, f)| f)
        .collect::<Vec<_>>();
    // sorted by _timestamp
    idx_file_list.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
    Ok((
        idx_file_list,
        idx_resp.scan_size,
        start.elapsed().as_millis() as usize,
    ))
}
