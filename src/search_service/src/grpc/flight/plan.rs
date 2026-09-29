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

use std::sync::Arc;

use ::datafusion::{
    common::tree_node::TreeNode, datasource::TableProvider, physical_plan::ExecutionPlan,
    prelude::SessionContext,
};
use arrow_schema::SchemaRef;
use config::{
    cluster::LOCAL_NODE,
    datafusion::request::FlightSearchRequest,
    get_config,
    meta::{
        search::ScanStats,
        sql::TableReferenceExt,
        stream::{FileKey, StreamType},
    },
};
use datafusion::{
    common::TableReference,
    physical_optimizer::{
        PhysicalOptimizerRule, filter_pushdown::FilterPushdown, limit_pushdown::LimitPushdown,
        projection_pushdown::ProjectionPushdown,
    },
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use infra::errors::{Error, ErrorCodes};

use super::scan::{FileRoute, collect_stats};
use crate::{
    datafusion::{
        distributed_plan::{
            NewEmptyExecVisitor, ReplaceTableScanExec, codec::get_physical_extension_codec,
            rewrite::aggregate_optimize_rewrite,
        },
        exec::{DataFusionContextBuilder, register_udf},
        sort_order::FileSortOrder,
        table_provider::{enrich_table::EnrichTable, uniontable::NewUnionTable},
    },
    grpc::QueryParams,
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    tantivy::aggregate::IndexAggregate,
};

/// The stream the leader plan reads, taken from its placeholder scan before any rewrite.
pub(super) struct ScanTarget {
    pub(super) stream: TableReference,
    pub(super) stream_type: StreamType,
    pub(super) schema: SchemaRef,
    pub(super) sort_order: FileSortOrder,
}

pub(super) async fn decode_plan(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>, ScanTarget), Error> {
    let cfg = get_config();
    let org_id = req.query_identifier.org_id.as_str();
    let stream_type = StreamType::from(req.query_identifier.stream_type.as_str());

    // create datafusion context, just used for decode plan, the params can use default
    let mut ctx = DataFusionContextBuilder::new()
        .trace_id(trace_id)
        .work_group(req.super_cluster_info.work_group.clone())
        .stream_type(stream_type)
        .build(cfg.limit.cpu_num)
        .await?;

    // register udf
    register_udf(&ctx, org_id)?;
    datafusion_functions_json::register_all(&mut ctx)?;

    // Decode physical plan from bytes
    let proto = get_physical_extension_codec();
    let physical_plan = physical_plan_from_bytes_with_extension_codec(
        &req.search_info.plan,
        &ctx.task_ctx(),
        &proto,
    )?;

    // replace empty table to real table
    let visitor = find_placeholder(&physical_plan)?;
    let empty_exec = visitor.plan();

    // here need reset the option because when init ctx we don't know this information
    if empty_exec.sort_order().is_sorted() {
        ctx.state_ref().write().config_mut().options_mut().set(
            "datafusion.execution.split_file_groups_by_statistics",
            "true",
        )?;
    }

    // get stream name
    let stream = TableReference::from(empty_exec.name());
    let stream_name = stream.stream_name().to_string();
    let stream_type = stream.get_stream_type(stream_type);

    // check if we are allowed to search
    if infra::cache::deleting_streams::contains(org_id, stream_type, &stream_name, None) {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(format!(
            "stream [{stream_name}] is being deleted"
        ))));
    }

    log::info!(
        "[trace_id {trace_id}] flight->search: part_id: {}, stream: {org_id}/{stream_type}/{stream_name}",
        req.query_identifier.partition
    );

    let target = ScanTarget {
        stream,
        stream_type,
        schema: empty_exec.full_schema(),
        sort_order: empty_exec.sort_order(),
    };
    Ok((ctx, physical_plan, target))
}

pub(super) async fn assemble_plan(
    query: &QueryParams,
    req: &FlightSearchRequest,
    ctx: &SessionContext,
    physical_plan: Arc<dyn ExecutionPlan>,
    mut tables: Vec<Arc<dyn TableProvider>>,
    route: FileRoute,
    scan_stats: &mut ScanStats,
) -> Result<Arc<dyn ExecutionPlan>, Error> {
    let trace_id = query.trace_id.as_str();

    // due to we rewrite empty exec in rewrite match_all
    let visitor = find_placeholder(&physical_plan)?;
    let empty_exec = visitor.plan();

    // if the stream type is enrichment tables and the enrich mode is true, we need to load
    // enrichment data from db to datafusion tables
    if query.stream_type == StreamType::EnrichmentTables && req.query_identifier.enrich_mode {
        // get the enrichment table from db
        let enrichment_table = EnrichTable::new(
            &query.org_id,
            &query.stream,
            empty_exec.full_schema().clone(),
            query.time_range,
        );
        // add the enrichment table to the tables
        tables.push(Arc::new(enrichment_table) as _);
    }

    // Scan projections refer to the full schema, not the placeholder's projected output.
    let start = std::time::Instant::now();
    let union_table = NewUnionTable::new(empty_exec.full_schema(), tables);
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] flight->search: created union table"),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search union table creation".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );

    let scan_start = std::time::Instant::now();
    let union_exec = union_table
        .scan(
            &ctx.state(),
            empty_exec.projection(),
            empty_exec.filters(),
            empty_exec.limit(),
        )
        .await?;
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] flight->search: union table scan"),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search union table scan".to_string())
                .search_role("follower".to_string())
                .duration(scan_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    let rewrite_start = std::time::Instant::now();
    let mut rewriter = ReplaceTableScanExec::new(union_exec);
    let physical_plan = physical_plan.rewrite(&mut rewriter)?.data;
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] flight->search: physical plan rewrite"),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search physical plan rewrite".to_string())
                .search_role("follower".to_string())
                .duration(rewrite_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    let physical_plan = apply_pushdowns_and_optimizations(
        trace_id,
        ctx,
        physical_plan,
        scan_stats,
        route.metadata_count,
        route.index_aggregate,
    )?;

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] flight->search: generated physical plan, took: {} ms",
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .trace_id(trace_id.to_string())
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search generated physical plan".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );
    Ok(physical_plan)
}

fn apply_pushdowns_and_optimizations(
    trace_id: &str,
    ctx: &SessionContext,
    mut physical_plan: Arc<dyn ExecutionPlan>,
    scan_stats: &mut ScanStats,
    metadata_count_file_list: Vec<FileKey>,
    index_aggregate: Option<IndexAggregate>,
) -> Result<Arc<dyn ExecutionPlan>, Error> {
    let cfg = get_config();

    let pushdown_filter = FilterPushdown::new();
    physical_plan = pushdown_filter
        .optimize(physical_plan, ctx.state().config_options())
        .map_err(|e| {
            log::error!("[trace_id {trace_id}] flight->search: pushdown filter error: {e}");
            e
        })?;
    let limit_pushdown = LimitPushdown::new();
    physical_plan = limit_pushdown
        .optimize(physical_plan, ctx.state().config_options())
        .map_err(|e| {
            log::error!("[trace_id {trace_id}] flight->search: limit pushdown error: {e}");
            e
        })?;
    let projection_pushdown = ProjectionPushdown::new();
    physical_plan = projection_pushdown
        .optimize(physical_plan, ctx.state().config_options())
        .map_err(|e| {
            log::error!("[trace_id {trace_id}] flight->search: projection pushdown error: {e}");
            e
        })?;

    if cfg.search.feature_dynamic_pushdown_filter_enabled {
        let pushdown_filter = FilterPushdown::new_post_optimization();
        physical_plan = pushdown_filter.optimize(physical_plan, ctx.state().config_options()).map_err(|e| {
            log::error!("[trace_id {trace_id}] flight->search: pushdown filter post optimization error: {e}");
            e
        })?;
    }

    if !metadata_count_file_list.is_empty() || index_aggregate.is_some() {
        let index_optimize_start = std::time::Instant::now();
        scan_stats.add(&collect_stats(&metadata_count_file_list));
        if let Some(aggregate) = &index_aggregate {
            scan_stats.add(&collect_stats(&aggregate.files));
        }
        physical_plan =
            aggregate_optimize_rewrite(metadata_count_file_list, index_aggregate, physical_plan)?;
        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] flight->search: index optimize rewrite"),
                SearchInspectorFieldsBuilder::new()
                    .trace_id(trace_id.to_string())
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search index optimize rewrite".to_string())
                    .search_role("follower".to_string())
                    .duration(index_optimize_start.elapsed().as_millis() as usize)
                    .build()
            )
        );
    }

    Ok(physical_plan)
}

fn find_placeholder(plan: &Arc<dyn ExecutionPlan>) -> Result<NewEmptyExecVisitor, Error> {
    let mut visitor = NewEmptyExecVisitor::default();
    if plan.visit(&mut visitor).is_err() || !visitor.has_empty_exec() {
        return Err(Error::Message(
            "flight->search: physical plan visit error: there is no EmptyTable".to_string(),
        ));
    }
    Ok(visitor)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};

    use super::*;
    use crate::datafusion::{
        distributed_plan::empty_exec::NewEmptyExec, table_provider::empty_table::NewEmptyTable,
    };

    #[tokio::test]
    async fn test_union_table_scan_uses_full_schema() -> datafusion::common::Result<()> {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("log", DataType::Utf8View, true),
            Field::new("latency_ms", DataType::Float64, true),
        ]));
        let ctx = SessionContext::new();
        let placeholder = NewEmptyTable::new("logs", schema.clone());
        for projection in [None, Some(vec![2]), Some(vec![2, 0]), Some(vec![])] {
            let plan = placeholder
                .scan(&ctx.state(), projection.as_ref(), &[], None)
                .await?;
            let empty_exec = plan.downcast_ref::<NewEmptyExec>().unwrap();
            for table_count in [0, 1, 2] {
                let tables = (0..table_count)
                    .map(|_| {
                        Arc::new(datafusion::datasource::empty::EmptyTable::new(
                            schema.clone(),
                        )) as Arc<dyn TableProvider>
                    })
                    .collect();
                let union_table = NewUnionTable::new(empty_exec.full_schema(), tables);
                let scan = union_table
                    .scan(
                        &ctx.state(),
                        empty_exec.projection(),
                        empty_exec.filters(),
                        empty_exec.limit(),
                    )
                    .await?;
                assert_eq!(scan.schema(), empty_exec.schema());
                let batches = datafusion::physical_plan::collect(scan, ctx.task_ctx()).await?;
                assert!(batches.iter().all(|batch| batch.num_rows() == 0));
            }
        }
        Ok(())
    }
}
