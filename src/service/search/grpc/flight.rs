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

use ::datafusion::{
    common::tree_node::TreeNode, datasource::TableProvider, physical_plan::ExecutionPlan,
    prelude::SessionContext,
};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::ScanStats,
        stream::{FileKey, StreamPartition, StreamType},
    },
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
use proto::cluster_rpc;
use rayon::slice::ParallelSliceMut;

use crate::service::{
    db,
    search::{
        datafusion::{
            distributed_plan::{
                codec::{ComposedPhysicalExtensionCodec, EmptyExecPhysicalExtensionCodec},
                empty_exec::NewEmptyExec,
                NewEmptyExecVisitor, ReplaceTableScanExec,
            },
            exec::{prepare_datafusion_context, register_udf},
            table_provider::uniontable::NewUnionTable,
        },
        match_file,
    },
};

#[tracing::instrument(name = "service:search:grpc:flight:do_get::search", skip_all, fields(org_id = req.org_id))]
pub async fn search(
    req: &cluster_rpc::FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>, ScanStats), Error> {
    // let start = std::time::Instant::now();
    let cfg = get_config();

    let org_id = req.org_id.to_string();
    let stream_type = StreamType::from(req.stream_type.as_str());
    let work_group = req.work_group.clone();

    let trace_id = Arc::new(req.trace_id.to_string());
    log::info!("[trace_id {trace_id}] flight->search: start");

    // create datafusion context, just used for decode plan, the params can use default
    let mut ctx =
        prepare_datafusion_context(work_group.clone(), vec![], false, cfg.limit.cpu_num).await?;

    // register UDF
    register_udf(&ctx, &org_id)?;
    datafusion_functions_json::register_all(&mut ctx)?;

    // Decode physical plan from bytes
    let proto = ComposedPhysicalExtensionCodec {
        codecs: vec![Arc::new(EmptyExecPhysicalExtensionCodec {})],
    };
    let mut physical_plan = physical_plan_from_bytes_with_extension_codec(&req.plan, &ctx, &proto)?;

    // replace empty table to real table
    let mut visitor = NewEmptyExecVisitor::default();
    if physical_plan.visit(&mut visitor).is_err() || visitor.get_data().is_none() {
        return Err(Error::Message(
            "flight->search: physical plan visit error: there is no EmptyTable".to_string(),
        ));
    }
    let empty_exec = visitor
        .get_data()
        .unwrap()
        .as_any()
        .downcast_ref::<NewEmptyExec>()
        .unwrap();

    // get stream name
    let stream_name = empty_exec.name();

    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(&org_id, stream_type, stream_name, None) {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(format!(
            "stream [{}] is being deleted",
            &stream_name
        ))));
    }

    log::info!(
        "[trace_id {trace_id}] flight->search: part_id: {}, stream: {}/{}/{}",
        req.partition,
        org_id,
        stream_type,
        stream_name,
    );

    // construct latest schema map
    let schema_latest = empty_exec.schema();
    let mut schema_latest_map = HashMap::with_capacity(schema_latest.fields().len());
    for field in schema_latest.fields() {
        schema_latest_map.insert(field.name(), field);
    }

    // construct partition filters
    let search_partition_keys: Vec<(String, String)> = req
        .equal_keys
        .iter()
        .filter_map(|v| {
            if schema_latest_map.contains_key(&v.key) {
                Some((v.key.to_string(), v.value.to_string()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let query_params = Arc::new(super::QueryParams {
        trace_id: trace_id.to_string(),
        org_id: org_id.to_string(),
        stream_type,
        stream_name: stream_name.to_string(),
        time_range: Some((req.start_time, req.end_time)),
        work_group: work_group.clone(),
        use_inverted_index: req.use_inverted_index,
        inverted_index_type: req.index_type.clone(),
    });

    // get all tables
    let mut tables = Vec::new();
    let mut scan_stats = ScanStats::new();
    let file_stats_cache = ctx.runtime_env().cache_manager.get_file_statistic_cache();

    // search in object storage
    if !req.file_id_list.is_empty() {
        let stream_settings = infra::schema::get_settings(&org_id, stream_name, stream_type)
            .await
            .unwrap_or_default();
        let (file_list, file_list_took) = get_file_list_by_ids(
            &trace_id,
            &org_id,
            stream_type,
            stream_name,
            query_params.time_range,
            &stream_settings.partition_keys,
            &search_partition_keys,
            &req.file_id_list,
            &req.idx_file_list,
        )
        .await?;
        log::info!(
            "[trace_id {trace_id}] flight->search in: part_id: {}, get file_list by ids, num: {}, took: {} ms",
            req.partition,
            file_list.len(),
            file_list_took,
        );

        let (tbls, stats) = match super::storage::search(
            query_params.clone(),
            schema_latest.clone(),
            &file_list,
            &req.equal_keys,
            &req.match_all_keys,
            empty_exec.sorted_by_time(),
            file_stats_cache.clone(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                super::super::datafusion::storage::file_list::clear(&trace_id);
                log::error!(
                    "[trace_id {}] flight->search: search storage parquet error: {}",
                    trace_id,
                    e
                );
                return Err(e);
            }
        };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // search in WAL parquet
    if LOCAL_NODE.is_ingester() {
        let (tbls, stats) = match super::wal::search_parquet(
            query_params.clone(),
            schema_latest.clone(),
            &search_partition_keys,
            empty_exec.sorted_by_time(),
            file_stats_cache.clone(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                super::super::datafusion::storage::file_list::clear(&trace_id);
                log::error!(
                    "[trace_id {}] flight->search: search wal parquet error: {}",
                    trace_id,
                    e
                );
                return Err(e);
            }
        };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // search in WAL memory
    if LOCAL_NODE.is_ingester() {
        let (tbls, stats) = match super::wal::search_memtable(
            query_params.clone(),
            schema_latest.clone(),
            &search_partition_keys,
            empty_exec.sorted_by_time(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id {}] flight->search: search wal memtable error: {}",
                    trace_id,
                    e
                );
                return Err(e);
            }
        };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // create a Union Plan to merge all tables
    let union_table = Arc::new(NewUnionTable::try_new(schema_latest.clone(), tables)?);

    let union_exec = union_table
        .scan(
            &ctx.state(),
            empty_exec.projection(),
            empty_exec.filters(),
            empty_exec.limit(),
        )
        .await?;
    let mut rewriter = ReplaceTableScanExec::new(union_exec);
    physical_plan = physical_plan.rewrite(&mut rewriter)?.data;

    log::info!("[trace_id {trace_id}] flight->search: generated physical plan");

    Ok((ctx, physical_plan, scan_stats))
}

#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip_all, fields(org_id = org_id, stream_name = stream_name))]
async fn get_file_list_by_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    partition_keys: &[StreamPartition],
    equal_items: &[(String, String)],
    ids: &[i64],
    idx_file_list: &[cluster_rpc::IdxFileName],
) -> Result<(Vec<FileKey>, usize), Error> {
    let start = std::time::Instant::now();
    let file_list = crate::service::file_list::query_by_ids(trace_id, ids).await?;
    // if there are any files in idx_files_list, use them to filter the files we got from ids,
    // otherwise use all the files we got from ids
    let file_list = if idx_file_list.is_empty() {
        file_list
    } else {
        let mut files = Vec::with_capacity(idx_file_list.len());
        let file_list_map: HashMap<_, _> =
            file_list.into_iter().map(|f| (f.key.clone(), f)).collect();
        for idx_file in idx_file_list.iter() {
            if let Some(file) = file_list_map.get(&idx_file.key) {
                let mut new_file = file.clone();
                if let Some(segment_ids) = idx_file.segment_ids.as_ref() {
                    new_file.segment_ids = Some(segment_ids.clone());
                }
                files.push(new_file);
            }
        }
        files
    };

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if match_file(
            org_id,
            stream_type,
            stream_name,
            time_range,
            &file,
            false,
            partition_keys,
            equal_items,
        )
        .await
        {
            files.push(file);
        }
    }
    files.par_sort_unstable_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    Ok((files, start.elapsed().as_millis() as usize))
}
