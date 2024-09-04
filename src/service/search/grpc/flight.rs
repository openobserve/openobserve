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
        stream::{FileKey, StreamType},
    },
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
use proto::cluster_rpc;

use crate::service::{
    db,
    search::datafusion::{
        distributed_plan::{
            codec::{ComposedPhysicalExtensionCodec, EmptyExecPhysicalExtensionCodec},
            empty_exec::NewEmptyExec,
            NewEmptyExecVisitor, ReplaceTableScanExec,
        },
        exec::{prepare_datafusion_context, register_udf},
        table_provider::uniontable::NewUnionTable,
    },
};

#[tracing::instrument(name = "service:search:grpc:search", skip_all, fields(org_id = req.org_id))]
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
    let ctx =
        prepare_datafusion_context(work_group.clone(), vec![], false, cfg.limit.cpu_num).await?;

    // register UDF
    register_udf(&ctx, &org_id).await;

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
    let search_partition_keys: Option<Vec<(String, String)>> = req
        .equal_keys
        .iter()
        .filter_map(|v| {
            if schema_latest_map.contains_key(&v.key) {
                Some((v.key.to_string(), v.value.to_string()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .into();

    let query_params = Arc::new(super::QueryParams {
        trace_id: trace_id.to_string(),
        org_id: org_id.to_string(),
        stream_type,
        stream_name: stream_name.to_string(),
        time_range: Some((req.start_time, req.end_time)),
        work_group: work_group.clone(),
    });

    // get all tables
    let mut tables = Vec::new();
    let mut scan_stats = ScanStats::new();
    let file_stats_cache = ctx.runtime_env().cache_manager.get_file_statistic_cache();

    // search in object storage
    if !req.file_list.is_empty() {
        let file_list: Vec<FileKey> = req.file_list.iter().map(FileKey::from).collect();
        let (tbls, stats) = match super::storage::search(
            query_params.clone(),
            schema_latest.clone(),
            &file_list,
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
            search_partition_keys.clone(),
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
            search_partition_keys.clone(),
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
