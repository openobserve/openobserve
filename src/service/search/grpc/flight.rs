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

use std::{collections::HashSet, sync::Arc};

use ::datafusion::{
    common::tree_node::TreeNode, datasource::TableProvider, physical_plan::ExecutionPlan,
    prelude::SessionContext,
};
use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE,
    datafusion::request::FlightSearchRequest,
    get_config,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::ScanStats,
        sql::TableReferenceExt,
        stream::{FileKey, StreamType},
    },
};
use datafusion::{
    common::TableReference,
    physical_optimizer::{PhysicalOptimizerRule, filter_pushdown::FilterPushdown},
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use hashbrown::HashMap;
use infra::{
    errors::{Error, ErrorCodes},
    schema::{
        get_stream_setting_fts_fields, get_stream_setting_index_fields,
        get_stream_setting_index_updated_at, unwrap_stream_created_at, unwrap_stream_settings,
    },
};
use itertools::Itertools;
use parking_lot::Mutex;
use rayon::slice::ParallelSliceMut;

use crate::service::{
    db,
    search::{
        datafusion::{
            distributed_plan::{
                NewEmptyExecVisitor, ReplaceTableScanExec, codec::get_physical_extension_codec,
                rewrite::tantivy_optimize_rewrite,
            },
            exec::{DataFusionContextBuilder, register_udf},
            optimizer::physical_optimizer::{
                index::IndexRule, index_optimizer::FollowerIndexOptimizerRule,
                rewrite_match::RewriteMatchPhysical,
            },
            table_provider::{enrich_table::EnrichTable, uniontable::NewUnionTable},
        },
        grpc::QueryParams,
        index::IndexCondition,
        inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
        match_file,
    },
};

#[tracing::instrument(name = "service:search:grpc:flight:do_get::search", skip_all, fields(org_id = req.query_identifier.org_id))]
pub async fn search(
    trace_id: &str,
    req: &FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>, ScanStats), Error> {
    let cfg = get_config();

    let org_id = req.query_identifier.org_id.to_string();
    let stream_type = StreamType::from(req.query_identifier.stream_type.as_str());
    let work_group = req.super_cluster_info.work_group.clone();

    let trace_id = Arc::new(trace_id.to_string());
    log::info!("[trace_id {trace_id}] flight->search: start");

    // create datafusion context, just used for decode plan, the params can use default
    let mut ctx = DataFusionContextBuilder::new()
        .trace_id(&trace_id)
        .work_group(work_group.clone())
        .build(cfg.limit.cpu_num)
        .await?;

    // register udf
    register_udf(&ctx, &org_id)?;
    datafusion_functions_json::register_all(&mut ctx)?;

    // Decode physical plan from bytes
    let proto = get_physical_extension_codec();
    let physical_plan = physical_plan_from_bytes_with_extension_codec(
        &req.search_info.plan,
        &ctx.task_ctx(),
        &proto,
    )?;

    // replace empty table to real table
    let mut visitor = NewEmptyExecVisitor::default();
    if physical_plan.visit(&mut visitor).is_err() || !visitor.has_empty_exec() {
        return Err(Error::Message(
            "flight->search: physical plan visit error: there is no EmptyTable".to_string(),
        ));
    }
    let empty_exec = visitor.plan();

    // here need reset the option because when init ctx we don't know this information
    if empty_exec.sorted_by_time() {
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
    if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(format!(
            "stream [{stream_name}] is being deleted"
        ))));
    }

    log::info!(
        "[trace_id {trace_id}] flight->search: part_id: {}, stream: {org_id}/{stream_type}/{stream_name}",
        req.query_identifier.partition
    );

    // construct latest schema map
    let latest_schema = empty_exec.full_schema();
    let mut latest_schema_map = HashMap::with_capacity(latest_schema.fields().len());
    for field in latest_schema.fields() {
        latest_schema_map.insert(field.name(), field);
    }

    let db_schema = infra::schema::get(&org_id, &stream_name, stream_type)
        .await
        .unwrap_or(arrow_schema::Schema::empty());
    let stream_settings = unwrap_stream_settings(&db_schema);
    let stream_created_at = unwrap_stream_created_at(&db_schema);
    let fst_fields = get_stream_setting_fts_fields(&stream_settings)
        .into_iter()
        .filter(|v| latest_schema_map.contains_key(v))
        .collect_vec();
    let index_fields = get_stream_setting_index_fields(&stream_settings)
        .into_iter()
        .filter(|v| latest_schema_map.contains_key(v))
        .collect_vec();
    let index_updated_at = get_stream_setting_index_updated_at(&stream_settings, stream_created_at);

    // construct partition filters
    let search_partition_keys: Vec<(String, String)> = req
        .index_info
        .equal_keys
        .iter()
        .filter_map(|v| {
            latest_schema_map
                .contains_key(&v.key)
                .then_some((v.key.to_string(), v.value.to_string()))
        })
        .collect::<Vec<_>>();

    // get all tables
    let mut tables = Vec::new();
    let mut scan_stats = ScanStats::new();
    let file_stats_cache = ctx.runtime_env().cache_manager.get_file_statistic_cache();

    // optimize physical plan, current for tantivy index optimize
    let index_optimize_mode = req.index_info.index_optimize_mode.clone();
    let index_condition_ref = Arc::new(Mutex::new(None));
    let index_optimizer_rule_ref = Arc::new(Mutex::new(index_optimize_mode.map(Into::into)));
    let mut physical_plan = optimizer_physical_plan(
        physical_plan,
        &ctx,
        &latest_schema,
        (req.search_info.start_time, req.search_info.end_time),
        fst_fields.clone(),
        index_fields,
        index_condition_ref.clone(),
        index_optimizer_rule_ref.clone(),
    )?;
    let index_condition = { index_condition_ref.lock().clone() };
    let idx_optimize_rule = { index_optimizer_rule_ref.lock().clone() };

    let query_params = Arc::new(QueryParams {
        trace_id: trace_id.to_string(),
        org_id: org_id.clone(),
        stream,
        stream_type,
        stream_name: stream_name.to_string(),
        time_range: (req.search_info.start_time, req.search_info.end_time),
        work_group: work_group.clone(),
        use_inverted_index: index_condition.is_some()
            && cfg.common.inverted_index_enabled
            && (!index_condition.as_ref().unwrap().is_condition_all()
                || idx_optimize_rule.is_some()),
    });

    log::info!(
        "[trace_id {trace_id}] flight->search: use_inverted_index: {}, index_condition: {index_condition:?}, index_optimizer_rule: {idx_optimize_rule:?}",
        query_params.use_inverted_index
    );

    // search in object storage
    let mut tantivy_file_list = Vec::new();
    if !req.search_info.file_id_list.is_empty() {
        let (mut file_list, file_list_took) = get_file_list_by_ids(
            &trace_id,
            &org_id,
            stream_type,
            &stream_name,
            Some(query_params.time_range),
            &search_partition_keys,
            &req.search_info.file_id_list,
        )
        .await?;
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search in: part_id: {}, get file_list by ids, files: {}, took: {} ms",
                    req.query_identifier.partition,
                    file_list.len(),
                    file_list_took,
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search get file_list by ids".to_string())
                    .search_role("follower".to_string())
                    .duration(file_list_took)
                    .build()
            )
        );

        let tantivy_optimize_start = std::time::Instant::now();
        let mut storage_idx_optimize_rule = idx_optimize_rule.clone();
        (tantivy_file_list, file_list) = handle_tantivy_optimize(
            &trace_id,
            req,
            &mut storage_idx_optimize_rule, // pass by mutable reference
            file_list,
            index_updated_at,
        )
        .await?;
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search: handle tantivy optimize, tantivy files: {}, datafusion files: {}",
                    tantivy_file_list.len(),
                    file_list.len()
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search handle tantivy optimize".to_string())
                    .search_role("follower".to_string())
                    .duration(tantivy_optimize_start.elapsed().as_millis() as usize)
                    .build()
            )
        );

        // Apply sampling if configured (enterprise feature)
        #[cfg(feature = "enterprise")]
        if let Some(sampling_config) = &req.search_info.sampling_config {
            o2_enterprise::enterprise::search::sampling::execution::apply_sampling_to_files(
                &mut file_list,
                sampling_config,
                Some(query_params.time_range),
                req.search_info.histogram_interval,
                &trace_id,
            );
        }

        // sort by max_ts, the latest file should be at the top
        let sort_start = std::time::Instant::now();
        if empty_exec.sorted_by_time() {
            file_list.par_sort_unstable_by(|a, b| b.meta.max_ts.cmp(&a.meta.max_ts));
        }
        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] flight->search: sort file list"),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search sort file list".to_string())
                    .search_role("follower".to_string())
                    .duration(sort_start.elapsed().as_millis() as usize)
                    .build()
            )
        );

        let storage_search_start = std::time::Instant::now();
        let (tbls, stats, _) = match super::storage::search(
            query_params.clone(),
            latest_schema.clone(),
            &file_list,
            empty_exec.sorted_by_time(),
            file_stats_cache.clone(),
            index_condition.clone(),
            fst_fields.clone(),
            storage_idx_optimize_rule,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                super::super::datafusion::storage::file_list::clear(&trace_id);
                log::error!(
                    "[trace_id {trace_id}] flight->search: search storage parquet error: {e}"
                );
                return Err(e);
            }
        };
        log::info!(
            "{}",
            search_inspector_fields(
                format!(
                    "[trace_id {trace_id}] flight->search: storage search completed, {} files",
                    file_list.len()
                ),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search storage search".to_string())
                    .search_role("follower".to_string())
                    .duration(storage_search_start.elapsed().as_millis() as usize)
                    .build()
            )
        );
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // search in WAL memory first to capture the snapshot_time
    // IMPORTANT: WAL data is NEVER sampled - it's always returned in full
    // Sampling only applies to parquet files (applied above in file_list processing)
    let mut memtable_ids = HashSet::new();
    if LOCAL_NODE.is_ingester() {
        let (tbls, stats, ids) = match super::wal::search_memtable(
            query_params.clone(),
            latest_schema.clone(),
            &search_partition_keys,
            empty_exec.sorted_by_time(),
            index_condition.clone(),
            fst_fields.clone(),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id {trace_id}] flight->search: search wal memtable error: {e:?}"
                );
                return Err(e);
            }
        };
        memtable_ids.extend(ids);
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // Now search in WAL parquet with snapshot_time filter
    if LOCAL_NODE.is_ingester() {
        let (tbls, stats, _) = match super::wal::search_parquet(
            query_params.clone(),
            latest_schema.clone(),
            &search_partition_keys,
            empty_exec.sorted_by_time(),
            file_stats_cache.clone(),
            index_condition.clone(),
            fst_fields.clone(),
            memtable_ids,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // clear session data
                super::super::datafusion::storage::file_list::clear(&trace_id);
                log::error!("[trace_id {trace_id}] flight->search: search wal parquet error: {e}");
                return Err(e);
            }
        };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // due to we rewrite empty exec in rewrite match_all
    let mut visitor = NewEmptyExecVisitor::default();
    if physical_plan.visit(&mut visitor).is_err() || !visitor.has_empty_exec() {
        return Err(Error::Message(
            "flight->search: physical plan visit error: there is no EmptyTable".to_string(),
        ));
    }
    let empty_exec = visitor.plan();

    // if the stream type is enrichment tables and the enrich mode is true, we need to load
    // enrichment data from db to datafusion tables
    if stream_type == StreamType::EnrichmentTables && req.query_identifier.enrich_mode {
        // get the enrichment table from db
        let enrichment_table = EnrichTable::new(
            &org_id,
            &stream_name,
            empty_exec.full_schema().clone(),
            query_params.time_range,
        );
        // add the enrichment table to the tables
        tables.push(Arc::new(enrichment_table) as _);
    }

    // create a Union Plan to merge all tables
    let start = std::time::Instant::now();
    let union_table = Arc::new(NewUnionTable::new(empty_exec.schema().clone(), tables));
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] flight->search: created union table"),
            SearchInspectorFieldsBuilder::new()
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
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search union table scan".to_string())
                .search_role("follower".to_string())
                .duration(scan_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    let rewrite_start = std::time::Instant::now();
    let mut rewriter = ReplaceTableScanExec::new(union_exec);
    physical_plan = physical_plan.rewrite(&mut rewriter)?.data;
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] flight->search: physical plan rewrite"),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search physical plan rewrite".to_string())
                .search_role("follower".to_string())
                .duration(rewrite_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    if cfg.common.feature_pushdown_filter_enabled {
        let pushdown_filter = FilterPushdown::new();
        physical_plan = pushdown_filter.optimize(physical_plan, ctx.state().config_options())?;
    }

    if cfg.common.feature_dynamic_pushdown_filter_enabled {
        let pushdown_filter = FilterPushdown::new_post_optimization();
        physical_plan = pushdown_filter.optimize(physical_plan, ctx.state().config_options())?;
    }

    if !tantivy_file_list.is_empty() {
        let tantivy_start = std::time::Instant::now();
        scan_stats.add(&collect_stats(&tantivy_file_list));
        physical_plan = tantivy_optimize_rewrite(
            query_params.clone(),
            tantivy_file_list,
            index_condition,
            idx_optimize_rule.unwrap(), // guaranteed Some, if tantivy_file_list is not empty
            physical_plan,
        )?;
        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] flight->search: tantivy optimize rewrite"),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:do_get::search tantivy optimize rewrite".to_string())
                    .search_role("follower".to_string())
                    .duration(tantivy_start.elapsed().as_millis() as usize)
                    .build()
            )
        );
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] flight->search: generated physical plan, took: {} ms",
                start.elapsed().as_millis()
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:do_get::search generated physical plan".to_string())
                .search_role("follower".to_string())
                .duration(start.elapsed().as_millis() as usize)
                .build()
        )
    );

    Ok((ctx, physical_plan, scan_stats))
}

#[allow(clippy::too_many_arguments)]
fn optimizer_physical_plan(
    plan: Arc<dyn ExecutionPlan>,
    ctx: &SessionContext,
    schema: &Schema,
    time_range: (i64, i64),
    fst_fields: Vec<String>,
    index_fields: Vec<String>,
    index_condition_ref: Arc<Mutex<Option<IndexCondition>>>,
    index_optimizer_rule_ref: Arc<Mutex<Option<IndexOptimizeMode>>>,
) -> Result<Arc<dyn ExecutionPlan>, Error> {
    let index_fields: HashSet<String> = index_fields.iter().cloned().collect();
    let index_rule = IndexRule::new(index_fields.clone(), index_condition_ref.clone());
    let mut plan = index_rule.optimize(plan, ctx.state().config_options())?;

    // if the index rule can't optimize, we should take the index optimizer rule
    if !index_rule.can_optimize() {
        index_optimizer_rule_ref.lock().take();
    }

    // if the index condition is some, and the index optimizer rule is none,
    // and filter only have _timestamp filter, we can try to optimize the plan
    if index_condition_ref.lock().is_some()
        && index_optimizer_rule_ref.lock().is_none()
        && index_rule.can_optimize()
    {
        let index_optimizer_rule =
            FollowerIndexOptimizerRule::new(time_range, index_optimizer_rule_ref.clone());
        plan = index_optimizer_rule.optimize(plan, ctx.state().config_options())?;
    }

    let rewrite_match_rule = RewriteMatchPhysical::new(
        fst_fields
            .clone()
            .into_iter()
            .map(|f| {
                (
                    f.clone(),
                    schema.field_with_name(&f).unwrap().data_type().clone(),
                )
            })
            .collect(),
    );
    let plan = rewrite_match_rule.optimize(plan, ctx.state().config_options())?;

    // reset the index_condition if index_optimizer_rule is none and index_condition is all
    let index_condition = index_condition_ref.lock().clone();
    if index_condition.is_some()
        && index_condition.as_ref().unwrap().is_condition_all()
        && index_optimizer_rule_ref.lock().is_none()
    {
        index_condition_ref.lock().take();
    }

    Ok(plan)
}

#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip_all, fields(org_id = org_id, stream_name = stream_name))]
async fn get_file_list_by_ids(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    equal_items: &[(String, String)],
    ids: &[i64],
) -> Result<(Vec<FileKey>, usize), Error> {
    let start = std::time::Instant::now();
    let stream_settings = infra::schema::get_settings(org_id, stream_name, stream_type)
        .await
        .unwrap_or_default();
    let partition_keys = stream_settings.partition_keys;
    let file_list = crate::service::file_list::query_by_ids(
        trace_id,
        org_id,
        stream_type,
        stream_name,
        time_range,
        ids,
    )
    .await?;

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if match_file(
            org_id,
            stream_type,
            stream_name,
            time_range,
            &file,
            &partition_keys,
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

async fn handle_tantivy_optimize(
    trace_id: &str,
    req: &FlightSearchRequest,
    idx_optimize_rule: &mut Option<IndexOptimizeMode>,
    file_list: Vec<FileKey>,
    index_updated_at: i64,
) -> Result<(Vec<FileKey>, Vec<FileKey>), Error> {
    // early return if not simple count, histogram or topn
    if !matches!(
        idx_optimize_rule,
        Some(IndexOptimizeMode::SimpleCount)
            | Some(IndexOptimizeMode::SimpleHistogram(..))
            | Some(IndexOptimizeMode::SimpleTopN(..))
            | Some(IndexOptimizeMode::SimpleDistinct(..))
    ) {
        return Ok((vec![], file_list));
    }

    let index_updated_at = update_index_updated_at(idx_optimize_rule, index_updated_at).await;

    let (tantivy_files, datafusion_files) = split_file_list_by_time_range(
        file_list,
        req.search_info.start_time,
        req.search_info.end_time,
        index_updated_at,
    );
    // set optimize rule to None, because datafusion should not use it
    *idx_optimize_rule = None;

    log::debug!(
        "[trace_id {}] flight->search: after_split_file tantivy_files: {}, datafusion_files: {}, optimize_rule: {:?}",
        trace_id,
        tantivy_files.len(),
        datafusion_files.len(),
        idx_optimize_rule
    );

    Ok((tantivy_files, datafusion_files))
}

/// update index_updated_at if needed
async fn update_index_updated_at(
    idx_optimize_rule: &Option<IndexOptimizeMode>,
    index_updated_at: i64,
) -> i64 {
    if matches!(
        idx_optimize_rule,
        Some(IndexOptimizeMode::SimpleHistogram(..))
    ) {
        let ttv_timestamp_updated_at =
            db::metas::tantivy_index::get_ttv_timestamp_updated_at().await;
        return index_updated_at.max(ttv_timestamp_updated_at);
    }

    if matches!(idx_optimize_rule, Some(IndexOptimizeMode::SimpleTopN(..))) {
        let ttv_secondary_index_updated_at =
            db::metas::tantivy_index::get_ttv_secondary_index_updated_at().await;
        return index_updated_at.max(ttv_secondary_index_updated_at);
    }

    index_updated_at
}

// if the file in the [start_time, end_time], it will be in tantivy group
// otherwise it will be in the datafusion group
// (tantivy group, datafusion group)
fn split_file_list_by_time_range(
    file_list: Vec<FileKey>,
    start_time: i64,
    end_time: i64,
    index_updated_at: i64,
) -> (Vec<FileKey>, Vec<FileKey>) {
    file_list.into_iter().partition(|file| {
        file.meta.min_ts >= start_time
            && file.meta.max_ts <= end_time
            && file.meta.min_ts >= index_updated_at
            && file.meta.index_size > 0
    })
}

fn collect_stats(files: &[FileKey]) -> ScanStats {
    let mut scan_stats = ScanStats::new();
    scan_stats.files = files.len() as i64;
    for file in files.iter() {
        scan_stats.records += file.meta.records;
        scan_stats.original_size += file.meta.original_size;
        scan_stats.compressed_size += file.meta.compressed_size;
        scan_stats.idx_scan_size += file.meta.index_size;
    }
    scan_stats
}
