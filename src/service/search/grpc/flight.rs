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
    common::tree_node::TreeNode,
    datasource::TableProvider,
    physical_plan::{displayable, ExecutionPlan},
    prelude::SessionContext,
};
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::{ScanStats, SearchType},
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
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>), Error> {
    let cfg = get_config();
    // let start = std::time::Instant::now();
    let org_id = req.org_id.to_string();
    let stream_type = StreamType::from(req.stream_type.as_str());
    let work_group = req.work_group.clone();

    let trace_id = Arc::new(req.trace_id.to_string());
    // TODO: timeout
    // let timeout = if req.timeout > 0 {
    //     req.timeout as u64
    // } else {
    //     cfg.limit.query_timeout
    // };

    // create datafusion context
    // TODO: reset these flags
    let search_type = SearchType::Normal;
    let without_optimizer = false;
    let sort_by_timestamp_desc = false;
    let target_partitions = cfg.limit.cpu_num; // TODO: need to calculate by if we can cache all the  parquet file 
    let limit = None;
    let ctx = prepare_datafusion_context(
        Some(work_group.clone()),
        &search_type,
        without_optimizer,
        sort_by_timestamp_desc,
        target_partitions,
        limit,
    )
    .await?;

    // register UDF
    register_udf(&ctx, &org_id).await;

    // Decode physical plan from bytes
    let proto = ComposedPhysicalExtensionCodec {
        codecs: vec![Arc::new(EmptyExecPhysicalExtensionCodec {})],
    };
    let mut physical_plan = physical_plan_from_bytes_with_extension_codec(&req.plan, &ctx, &proto)?;

    let plan = displayable(physical_plan.as_ref())
        .set_show_schema(false)
        .indent(true)
        .to_string();
    println!("{}", plan);

    // replace empty table to real table
    let mut visitor = NewEmptyExecVisitor::default();
    if physical_plan.visit(&mut visitor).is_err() || visitor.get_data().is_none() {
        return Err(Error::Message(
            "search->storage: physical plan visit error: there is no EmptyTable".to_string(),
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
    // let stream_settings = unwrap_stream_settings(&schema_latest).unwrap_or_default();
    // let defined_schema_fields = stream_settings.defined_schema_fields.unwrap_or_default();

    // TODO the leader need check is_wildcard and defined_schema_fields to reduce the schema
    let query_params = Arc::new(super::QueryParams {
        trace_id: trace_id.to_string(),
        org_id: org_id.to_string(),
        stream_type,
        stream_name: stream_name.to_string(),
        time_range: Some((req.start_time, req.end_time)),
        work_group: work_group.to_string(),
    });

    // get all tables
    let mut tables = Vec::new();
    let mut scan_stats = ScanStats::new();

    // search in object storage
    if req.search_type != cluster_rpc::SearchType::WalOnly as i32 {
        let file_list: Vec<FileKey> = req.file_list.iter().map(FileKey::from).collect();
        let (tbls, _, stats) =
            match super::storage::search(query_params.clone(), schema_latest.clone(), &file_list)
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    super::super::datafusion::storage::file_list::clear(&trace_id);
                    log::error!(
                        "[trace_id {}] search->storage: search storage parquet error: {}",
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
    let mut wal_lock_files = Vec::new();
    if LOCAL_NODE.is_ingester() {
        let (tbls, lock_files, stats) =
            match super::wal::search_parquet(query_params.clone(), schema_latest.clone()).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    super::super::datafusion::storage::file_list::clear(&trace_id);
                    log::error!(
                        "[trace_id {}] search->storage: search wal parquet error: {}",
                        trace_id,
                        e
                    );
                    return Err(e);
                }
            };
        tables.extend(tbls);
        scan_stats.add(&stats);
        wal_lock_files = lock_files;
    }

    // search in WAL memory
    if LOCAL_NODE.is_ingester() {
        let (tbls, _, stats) =
            match super::wal::search_memtable(query_params.clone(), schema_latest.clone()).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    super::super::datafusion::storage::file_list::clear(&trace_id);
                    // release wal lock files
                    crate::common::infra::wal::release_files(&wal_lock_files).await;
                    log::error!(
                        "[trace_id {}] search->storage: search wal memtable error: {}",
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

    // TODO: release wal files
    // clear session data
    // datafusion::storage::file_list::clear(&trace_id);
    // release wal lock files
    // crate::common::infra::wal::release_files(&wal_lock_files).await;

    Ok((ctx, physical_plan))
}
