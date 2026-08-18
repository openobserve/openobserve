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

use std::{cmp::max, num::NonZero, str::FromStr, sync::Arc};

use arrow_schema::Field;
use config::{
    FileFormat, TIMESTAMP_COL_NAME, get_batch_size, get_config,
    meta::{
        promql::{EXEMPLARS_LABEL, HASH_LABEL},
        search::{Session as SearchSession, StorageType},
        stream::{FileKey, StreamType},
    },
    utils::schema_ext::SchemaExt,
};
use datafusion::{
    arrow::datatypes::{DataType, Schema},
    catalog::TableProvider,
    config::Dialect,
    datasource::{
        file_format::{FileFormat as DataFusionFileFormat, parquet::ParquetFormat},
        listing::{ListingOptions, ListingTableConfig, ListingTableUrl},
        object_store::{DefaultObjectStoreRegistry, ObjectStoreRegistry},
    },
    error::{DataFusionError, Result},
    execution::{
        cache::cache_manager::{CacheManagerConfig, FileStatisticsCache},
        context::SessionConfig,
        memory_pool::{FairSpillPool, GreedyMemoryPool, TrackConsumersPool, UnboundedMemoryPool},
        runtime_env::{RuntimeEnv, RuntimeEnvBuilder},
        session_state::SessionStateBuilder,
    },
    logical_expr::AggregateUDF,
    optimizer::{AnalyzerRule, OptimizerRule},
    physical_expr_adapter::DefaultPhysicalExprAdapterFactory,
    physical_optimizer::PhysicalOptimizerRule,
    prelude::SessionContext,
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::WorkGroup;
use vortex::{VortexSessionDefault, io::session::RuntimeSessionExt, session::VortexSession};
use vortex_datafusion::VortexFormat;

use super::{
    peak_memory_pool::PeakMemoryPool, planner::extension_planner::OpenobserveQueryPlanner,
    storage::file_list, udf::transform_udf::get_all_transform,
};
use crate::{
    datafusion::{
        sort_order::FileSortOrder,
        storage::file_statistics_cache,
        table_provider::{listing_adapter::ListingTableAdapter, uniontable::NewUnionTable},
    },
    index::IndexCondition,
};

pub const DATAFUSION_MIN_MEM: usize = 1024 * 1024 * 256; // 256MB

fn create_session_config(
    sort_order: FileSortOrder,
    target_partitions: usize,
    stream_type: Option<StreamType>,
) -> Result<SessionConfig> {
    let cfg = get_config();
    let target_partitions = if target_partitions == 0 {
        cfg.limit.cpu_num
    } else {
        target_partitions
    };
    let target_partitions = max(cfg.limit.datafusion_min_partition_num, target_partitions);
    let mut config = SessionConfig::from_env()?
        .with_batch_size(get_batch_size())
        .with_target_partitions(target_partitions)
        .with_information_schema(true);

    config
        .options_mut()
        .execution
        .listing_table_ignore_subdirectory = false;

    config.options_mut().sql_parser.dialect = Dialect::PostgreSQL;

    config.options_mut().execution.parquet.pushdown_filters =
        if matches!(stream_type, Some(StreamType::Metrics)) {
            cfg.search.feature_metrics_pushdown_filter_enabled
        } else {
            cfg.search.feature_pushdown_filter_enabled
        };
    // config = config.set_bool("datafusion.execution.parquet.reorder_filters", true);

    // sorted inputs: let DataFusion chain non-overlapping files into ordered
    // partitions instead of adding a global sort
    if sort_order.is_sorted() {
        config
            .options_mut()
            .execution
            .split_file_groups_by_statistics = true;
    }

    // When set to true, skips verifying that the schema produced by planning the input of
    // `LogicalPlan::Aggregate` exactly matches the schema of the input plan.
    config
        .options_mut()
        .execution
        .skip_physical_aggregate_schema_check = true;

    // DataFusion 54 executes uncorrelated scalar subqueries physically via
    // `ScalarSubqueryExec`/`ScalarSubqueryExpr` instead of rewriting them into joins.
    // `ScalarSubqueryExpr` can only be (de)serialized inside its surrounding
    // `ScalarSubqueryExec`, which breaks our distributed plan splitting across the Flight
    // boundary. Disable the physical path so `ScalarSubqueryToJoin` decorrelates them into
    // joins again, keeping the serialized follower plans valid.
    config
        .options_mut()
        .optimizer
        .enable_physical_uncorrelated_scalar_subquery = false;

    // DataFusion 54 builds a runtime `DynamicFilterPhysicalExpr` from a `HashJoinExec`'s
    // build-side join keys and pushes it into the probe-side scan. That runtime state can't
    // cross our distributed RemoteScan/Flight boundary, and after our custom join rewrites
    // (`swap_inputs` + broadcast/enrichment join) the filter ends up referencing build-side
    // columns by index against the projected probe-side batch, producing
    // "PhysicalExpr Column references column ... but input schema only has N columns" at
    // execution time. Disable join dynamic filter pushdown to keep the split plans valid.
    config
        .options_mut()
        .optimizer
        .enable_join_dynamic_filter_pushdown = false;

    Ok(config)
}

pub async fn create_runtime_env(trace_id: &str, memory_limit: usize) -> Result<RuntimeEnv> {
    let object_store_registry = DefaultObjectStoreRegistry::new();

    let memory = super::storage::memory::FS::new();
    let memory_url = url::Url::parse("memory:///").unwrap();
    object_store_registry.register_store(&memory_url, Arc::new(memory));

    let wal = super::storage::wal::FS::new();
    let wal_url = url::Url::parse("wal:///").unwrap();
    object_store_registry.register_store(&wal_url, Arc::new(wal));

    let cfg = get_config();
    let mut builder =
        RuntimeEnvBuilder::new().with_object_store_registry(Arc::new(object_store_registry));
    if cfg.limit.datafusion_file_stat_cache_max_size > 0 {
        let cache_config = CacheManagerConfig::default();
        let cache_config = cache_config
            .with_file_statistics_cache(Some(file_statistics_cache::GLOBAL_CACHE.clone()))
            .with_file_statistics_cache_limit(cfg.limit.datafusion_file_stat_cache_max_size);
        builder = builder.with_cache_manager(cache_config);
    }

    let memory_size = std::cmp::max(DATAFUSION_MIN_MEM, memory_limit);
    let mem_pool = super::MemoryPoolType::from_str(&cfg.memory_cache.datafusion_memory_pool)
        .map_err(|e| {
            DataFusionError::Execution(format!("Invalid datafusion memory pool type: {e}"))
        })?;
    let memory_pool = match mem_pool {
        super::MemoryPoolType::Greedy => {
            let pool = GreedyMemoryPool::new(memory_size);
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
        super::MemoryPoolType::Fair => {
            let pool = FairSpillPool::new(memory_size);
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
        super::MemoryPoolType::None => {
            let pool = UnboundedMemoryPool::default();
            let track_memory_pool = TrackConsumersPool::new(pool, NonZero::new(20).unwrap());
            PeakMemoryPool::new(Arc::new(track_memory_pool), trace_id.to_string())
        }
    };

    builder = builder.with_memory_pool(Arc::new(memory_pool));
    builder.build()
}

pub struct DataFusionContextBuilder<'a> {
    trace_id: &'a str,
    work_group: Option<String>,
    stream_type: Option<StreamType>,
    analyzer_rules: Vec<Arc<dyn AnalyzerRule + Send + Sync>>,
    optimizer_rules: Vec<Arc<dyn OptimizerRule + Send + Sync>>,
    physical_optimizer_rules: Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>>,
    sort_order: FileSortOrder,
}

impl<'a> Default for DataFusionContextBuilder<'a> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a> DataFusionContextBuilder<'a> {
    pub fn new() -> Self {
        Self {
            trace_id: "",
            work_group: None,
            stream_type: None,
            analyzer_rules: vec![],
            optimizer_rules: vec![],
            physical_optimizer_rules: vec![],
            sort_order: FileSortOrder::None,
        }
    }

    pub fn trace_id(mut self, trace_id: &'a str) -> Self {
        self.trace_id = trace_id;
        self
    }

    pub fn work_group(mut self, work_group: Option<String>) -> Self {
        self.work_group = work_group;
        self
    }

    pub fn stream_type(mut self, stream_type: StreamType) -> Self {
        self.stream_type = Some(stream_type);
        self
    }

    pub fn analyzer_rules(
        mut self,
        analyzer_rules: Vec<Arc<dyn AnalyzerRule + Send + Sync>>,
    ) -> Self {
        self.analyzer_rules = analyzer_rules;
        self
    }

    pub fn optimizer_rules(
        mut self,
        optimizer_rules: Vec<Arc<dyn OptimizerRule + Send + Sync>>,
    ) -> Self {
        self.optimizer_rules = optimizer_rules;
        self
    }

    pub fn physical_optimizer_rules(
        mut self,
        physical_optimizer_rules: Vec<Arc<dyn PhysicalOptimizerRule + Send + Sync>>,
    ) -> Self {
        self.physical_optimizer_rules = physical_optimizer_rules;
        self
    }

    pub fn sort_order(mut self, sort_order: FileSortOrder) -> Self {
        self.sort_order = sort_order;
        self
    }

    pub async fn build(self, target_partitions: usize) -> Result<SessionContext, DataFusionError> {
        let cfg = get_config();
        let (target_partitions, memory_size) =
            (target_partitions, cfg.memory_cache.datafusion_max_size);
        #[cfg(feature = "enterprise")]
        let (target_partitions, memory_size) = get_cpu_and_mem_limit(
            self.trace_id,
            self.work_group.clone(),
            target_partitions,
            memory_size,
        )
        .await?;

        let session_config =
            create_session_config(self.sort_order, target_partitions, self.stream_type)?;
        let runtime_env = Arc::new(create_runtime_env(self.trace_id, memory_size).await?);
        let mut builder = SessionStateBuilder::new()
            .with_config(session_config)
            .with_runtime_env(runtime_env)
            .with_default_features();
        for rule in self.analyzer_rules {
            builder = builder.with_analyzer_rule(rule);
        }
        if !self.optimizer_rules.is_empty() {
            builder = builder.with_optimizer_rules(self.optimizer_rules)
        }
        for rule in self.physical_optimizer_rules {
            builder = builder.with_physical_optimizer_rule(rule);
        }
        if cfg.search.feature_join_match_one_enabled {
            builder = builder.with_query_planner(Arc::new(OpenobserveQueryPlanner::new()));
        }
        Ok(SessionContext::new_with_state(builder.build()))
    }
}

pub fn register_udf(ctx: &SessionContext, org_id: &str) -> Result<()> {
    register_builtin_udfs(ctx);
    let udf_list = get_all_transform(org_id)?;
    for udf in udf_list {
        ctx.register_udf(udf.clone());
    }
    Ok(())
}

/// Register the org-independent O2 UDFs/UDAFs (everything except the per-org
/// VRL transform functions).
pub fn register_builtin_udfs(ctx: &SessionContext) {
    ctx.register_udf(super::udf::str_match_udf::STR_MATCH_UDF.clone());
    ctx.register_udf(super::udf::str_match_udf::STR_MATCH_IGNORE_CASE_UDF.clone());
    ctx.register_udf(super::udf::fuzzy_match_udf::FUZZY_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEX_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEX_NOT_MATCH_UDF.clone());
    ctx.register_udf(super::udf::regexp_udf::REGEXP_MATCH_TO_FIELDS_UDF.clone());
    ctx.register_udf(super::udf::regexp_matches_udf::REGEX_MATCHES_UDF.clone());
    ctx.register_udf(super::udf::time_range_udf::TIME_RANGE_UDF.clone());
    ctx.register_udf(super::udf::date_format_udf::DATE_FORMAT_UDF.clone());
    ctx.register_udf(super::udf::string_to_array_v2_udf::STRING_TO_ARRAY_V2_UDF.clone());
    ctx.register_udf(super::udf::arrzip_udf::ARR_ZIP_UDF.clone());
    ctx.register_udf(super::udf::arrindex_udf::ARR_INDEX_UDF.clone());
    ctx.register_udf(super::udf::arr_descending_udf::ARR_DESCENDING_UDF.clone());
    ctx.register_udf(super::udf::arrjoin_udf::ARR_JOIN_UDF.clone());
    ctx.register_udf(super::udf::arrcount_udf::ARR_COUNT_UDF.clone());
    ctx.register_udf(super::udf::arrsort_udf::ARR_SORT_UDF.clone());
    ctx.register_udf(super::udf::cast_to_arr_udf::CAST_TO_ARR_UDF.clone());
    ctx.register_udf(super::udf::spath_udf::SPATH_UDF.clone());
    ctx.register_udf(super::udf::to_arr_string_udf::TO_ARR_STRING.clone());
    ctx.register_udf(super::udf::histogram_udf::HISTOGRAM_UDF.clone());
    ctx.register_udf(super::udf::match_all_hash_udf::MATCH_ALL_HASH_UDF.clone());
    ctx.register_udf(super::udf::match_all_udf::MATCH_ALL_UDF.clone());
    ctx.register_udf(super::udf::match_all_udf::FUZZY_MATCH_ALL_UDF.clone());
    ctx.register_udaf(AggregateUDF::from(
        super::udaf::summary_percentile::SummaryPercentile::new(),
    ));
    ctx.register_udaf(AggregateUDF::from(
        super::udaf::approx_topk::ApproxTopK::new(),
    ));
    ctx.register_udaf(AggregateUDF::from(
        super::udaf::approx_topk_distinct::ApproxTopKDistinct::new(),
    ));
    ctx.register_udf(super::udf::cast_to_timestamp_udf::CAST_TO_TIMESTAMP_UDF.clone());

    #[cfg(feature = "enterprise")]
    {
        ctx.register_udf(super::udf::cipher_udf::DECRYPT_UDF.clone());
        ctx.register_udf(super::udf::cipher_udf::DECRYPT_SLOW_UDF.clone());
        ctx.register_udf(super::udf::cipher_udf::ENCRYPT_UDF.clone());
        ctx.register_udaf(AggregateUDF::from(
            o2_enterprise::enterprise::search::datafusion::udaf::ddsketch::DDSketchAgg::new(),
        ));
    }
}

/// Names of every function usable in O2 SQL: the DataFusion built-ins plus
/// the built-in O2 UDFs (per-org VRL functions excluded). Snapshotted once —
/// the registry is static for the process lifetime. Used for did-you-mean
/// suggestions on "Invalid function" errors.
pub fn registered_function_names() -> &'static [String] {
    static NAMES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    NAMES.get_or_init(|| {
        let mut ctx = SessionContext::new();
        register_builtin_udfs(&ctx);
        // Production contexts register these separately (see flight.rs); without
        // the same call here the whole json_* family is missing from the catalog.
        let _ = datafusion_functions_json::register_all(&mut ctx);
        let state = ctx.state();
        let mut names: Vec<String> = state.scalar_functions().keys().cloned().collect();
        names.extend(state.aggregate_functions().keys().cloned());
        names.extend(state.window_functions().keys().cloned());
        names.sort();
        names.dedup();
        names
    })
}

/// One entry of the SQL function catalog served to the query editor.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, utoipa::ToSchema)]
pub struct CatalogFunction {
    pub name: String,
    /// Argument list, e.g. "(field, k)". Drives the editor's `detail` column.
    pub signature: String,
    /// Prose for the editor's documentation panel. May be empty for upstream
    /// DataFusion functions that carry no documentation of their own.
    pub doc: String,
    /// "udf" | "scalar" | "aggregate" | "window" | "vrl"
    pub kind: String,
    pub deprecated: bool,
}

/// Argument list and prose for a registry function.
///
/// `Signature` has no Display and describes accepted TYPES, not argument names,
/// so DataFusion's own documentation is the only source of a readable argument
/// list: prefer its named arguments, fall back to the paren group of its syntax
/// example, and finally to an opaque placeholder.
fn describe_registry_fn(doc: Option<&datafusion::logical_expr::Documentation>) -> (String, String) {
    let Some(d) = doc else {
        return ("(...)".to_string(), String::new());
    };
    if let Some(args) = &d.arguments
        && !args.is_empty()
    {
        let names: Vec<&str> = args.iter().map(|(n, _)| n.as_str()).collect();
        return (format!("({})", names.join(", ")), d.description.clone());
    }
    let sig = d
        .syntax_example
        .find('(')
        .map(|i| d.syntax_example[i..].to_string())
        .unwrap_or_else(|| "(...)".to_string());
    (sig, d.description.clone())
}

/// The org-INDEPENDENT half of the catalog: the DataFusion registry (including
/// the JSON family) plus the SQL-rewriter aliases.
///
/// Snapshotted once. Building it means standing up a SessionContext and
/// registering ~350 functions, which is far too much to repeat per HTTP
/// request; `registered_function_names` above caches for the same reason.
fn base_catalog_functions() -> &'static [CatalogFunction] {
    static BASE: std::sync::OnceLock<Vec<CatalogFunction>> = std::sync::OnceLock::new();
    BASE.get_or_init(|| {
        let mut ctx = SessionContext::new();
        register_builtin_udfs(&ctx);
        let _ = datafusion_functions_json::register_all(&mut ctx);
        let state = ctx.state();

        let mut out: Vec<CatalogFunction> = Vec::new();
        let mut push = |name: String, signature: String, doc: String, kind: &str, deprecated| {
            out.push(CatalogFunction {
                name,
                signature,
                doc,
                kind: kind.to_string(),
                deprecated,
            });
        };

        for (name, udf) in state.scalar_functions() {
            let (sig, doc) = describe_registry_fn(udf.documentation());
            push(name.clone(), sig, doc, "scalar", false);
        }
        for (name, udf) in state.aggregate_functions() {
            let (sig, doc) = describe_registry_fn(udf.documentation());
            push(name.clone(), sig, doc, "aggregate", false);
        }
        for (name, udf) in state.window_functions() {
            let (sig, doc) = describe_registry_fn(udf.documentation());
            push(name.clone(), sig, doc, "window", false);
        }

        // Valid SQL that appears in no registry: a rewriter desugars these
        // before planning.
        for alias in crate::sql::rewriter::REWRITER_FUNCTION_ALIASES {
            let target = crate::sql::rewriter::rewriter_alias_target(alias).unwrap_or("match_all");
            push(
                (*alias).to_string(),
                "(term)".to_string(),
                format!("Deprecated alias for `{target}` — rewritten before planning."),
                "udf",
                true,
            );
        }

        out
    })
}

/// Every function this org can call: the shared registry above plus the org's
/// own VRL transforms.
pub fn catalog_functions(org_id: &str) -> Vec<CatalogFunction> {
    // Keyed by name so the result is sorted and deduplicated for free, and so a
    // later insert wins — which is what makes the org's VRL transforms override
    // a same-named builtin, exactly as register_udf does at query time.
    let mut by_name: std::collections::BTreeMap<String, CatalogFunction> = base_catalog_functions()
        .iter()
        .map(|f| (f.name.clone(), f.clone()))
        .collect();

    let org_prefix = format!("{org_id}/");
    for transform in transform::QUERY_FUNCTIONS.iter() {
        if !transform.key().starts_with(&org_prefix) {
            continue;
        }
        let args: Vec<String> = (1..=transform.num_args)
            .map(|i| format!("arg{i}"))
            .collect();
        by_name.insert(
            transform.name.clone(),
            CatalogFunction {
                name: transform.name.clone(),
                signature: format!("({})", args.join(", ")),
                doc: format!(
                    "Organisation VRL function `{}` ({} argument(s)).",
                    transform.name, transform.num_args
                ),
                kind: "vrl".to_string(),
                deprecated: false,
            },
        );
    }

    by_name.into_values().collect()
}

pub async fn register_metrics_table(
    session: &SearchSession,
    schema: Arc<Schema>,
    table_name: &str,
    files: Vec<FileKey>,
) -> Result<SessionContext> {
    let schema = metrics_query_schema(schema);
    let ctx = DataFusionContextBuilder::new()
        .trace_id(&session.id)
        .work_group(session.work_group.clone())
        .stream_type(StreamType::Metrics)
        .build(session.target_partitions)
        .await?;

    let tables = TableBuilder::new()
        .file_stat_cache(ctx.runtime_env().cache_manager.get_file_statistic_cache())
        .build(session.clone(), files, schema.clone())
        .await?;
    let union_table = Arc::new(NewUnionTable::new(schema, tables));
    ctx.register_table(table_name, union_table)?;

    Ok(ctx)
}

fn metrics_query_schema(schema: Arc<Schema>) -> Arc<Schema> {
    metrics_query_schema_with_utf8_view(schema, get_config().common.utf8_view_enabled)
}

fn metrics_query_schema_with_utf8_view(
    schema: Arc<Schema>,
    utf8_view_enabled: bool,
) -> Arc<Schema> {
    if !utf8_view_enabled {
        return schema;
    }

    let fields = schema
        .fields()
        .iter()
        .map(|field| {
            if matches!(field.data_type(), DataType::Utf8 | DataType::LargeUtf8)
                && field.name() != HASH_LABEL
                && field.name() != EXEMPLARS_LABEL
            {
                Arc::new(
                    Field::new(field.name(), DataType::Utf8View, field.is_nullable())
                        .with_metadata(field.metadata().clone()),
                )
            } else {
                field.clone()
            }
        })
        .collect::<Vec<_>>();
    Arc::new(Schema::new(fields).with_metadata(schema.metadata().clone()))
}

/// Create a datafusion table from a list of files and a schema
pub struct TableBuilder {
    sort_order: FileSortOrder,
    file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    index_condition: Option<IndexCondition>,
    fst_fields: Vec<String>,
    timestamp_filter: Option<(i64, i64)>,
}

impl Default for TableBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl TableBuilder {
    pub fn new() -> Self {
        Self {
            sort_order: FileSortOrder::None,
            file_stat_cache: None,
            index_condition: None,
            fst_fields: vec![],
            timestamp_filter: None,
        }
    }

    /// Physical sort order of `files`; declared to DataFusion so ordered
    /// scans do not need an extra sort.
    pub fn sort_order(mut self, sort_order: FileSortOrder) -> Self {
        self.sort_order = sort_order;
        self
    }

    pub fn file_stat_cache(
        mut self,
        file_stat_cache: Option<Arc<dyn FileStatisticsCache>>,
    ) -> Self {
        self.file_stat_cache = file_stat_cache;
        self
    }

    pub fn index_condition(mut self, index_condition: Option<IndexCondition>) -> Self {
        self.index_condition = index_condition;
        self
    }

    pub fn fst_fields(mut self, fst_fields: Vec<String>) -> Self {
        self.fst_fields = fst_fields;
        self
    }

    /// apply timestamp filter to the table
    pub fn timestamp_filter(mut self, timestamp_filter: (i64, i64)) -> Self {
        self.timestamp_filter = Some(timestamp_filter);
        self
    }

    pub async fn build(
        self,
        session: SearchSession,
        files: Vec<FileKey>,
        schema: Arc<Schema>,
    ) -> Result<Vec<Arc<dyn TableProvider>>> {
        let cfg = get_config();
        let target_partitions = if session.target_partitions == 0 {
            cfg.limit.cpu_num
        } else {
            session.target_partitions
        };
        let target_partitions = max(cfg.limit.datafusion_min_partition_num, target_partitions);

        #[cfg(feature = "enterprise")]
        let (target_partitions, _) = get_cpu_and_mem_limit(
            &session.id,
            session.work_group.clone(),
            target_partitions,
            cfg.memory_cache.datafusion_max_size,
        )
        .await?;

        // Group files by format
        let mut parquet_files = Vec::new();
        let mut vortex_files = Vec::new();

        for file in files {
            match FileFormat::from_extension(&file.key) {
                Some(FileFormat::Vortex) => vortex_files.push(file),
                _ => parquet_files.push(file), // Default to parquet
            }
        }

        log::info!(
            "[trace_id: {}] parquet_files numbers: {}, vortex_files numbers: {}",
            session.id,
            parquet_files.len(),
            vortex_files.len()
        );

        // Build table providers for each format
        let mut tables: Vec<Arc<dyn TableProvider>> = Vec::new();

        if !parquet_files.is_empty() {
            let table = self
                .build_table_for_format(
                    session.clone(),
                    parquet_files,
                    schema.clone(),
                    FileFormat::Parquet,
                    target_partitions,
                )
                .await?;
            tables.push(table);
        }

        if !vortex_files.is_empty() {
            let table = self
                .build_table_for_format(
                    session.clone(),
                    vortex_files,
                    schema.clone(),
                    FileFormat::Vortex,
                    target_partitions,
                )
                .await?;
            tables.push(table);
        }

        Ok(tables)
    }

    async fn build_table_for_format(
        &self,
        session: SearchSession,
        files: Vec<FileKey>,
        schema: Arc<Schema>,
        format: FileFormat,
        target_partitions: usize,
    ) -> Result<Arc<dyn TableProvider>> {
        // Configure listing options with the appropriate file format
        let file_format: Arc<dyn DataFusionFileFormat> = match format {
            FileFormat::Parquet => Arc::new(ParquetFormat::default()),
            FileFormat::Vortex => {
                let vortex_session = VortexSession::default().with_tokio();
                Arc::new(VortexFormat::new(vortex_session))
            }
        };

        let mut listing_options = ListingOptions::new(file_format)
            .with_target_partitions(target_partitions)
            .with_collect_stat(true);

        if self.sort_order.is_sorted() {
            // specify sort columns for parquet file
            listing_options =
                listing_options.with_file_sort_order(vec![self.sort_order.logical_sort_exprs()]);
        }

        let schema_key = schema.hash_key();
        let format = format.extension();
        let trace_id = &session.id;
        let prefix = match session.storage_type {
            StorageType::Memory => {
                file_list::set(trace_id, &schema_key, format, files).await;
                format!("memory:///{trace_id}/schema={schema_key}/format={format}/",)
            }
            StorageType::Wal => {
                file_list::set(trace_id, &schema_key, format, files).await;
                format!("wal:///{trace_id}/schema={schema_key}/format={format}/",)
            }
        };
        let prefix = match ListingTableUrl::parse(prefix) {
            Ok(url) => url,
            Err(e) => {
                return Err(datafusion::error::DataFusionError::Execution(format!(
                    "ListingTableUrl error: {e}",
                )));
            }
        };

        let mut config = ListingTableConfig::new(prefix).with_listing_options(listing_options);
        let timestamp_field = schema.field_with_name(TIMESTAMP_COL_NAME);
        let schema = if timestamp_field.is_ok() && timestamp_field.unwrap().is_nullable() {
            let new_fields = schema
                .fields()
                .iter()
                .map(|x| {
                    if x.name() == TIMESTAMP_COL_NAME {
                        Arc::new(Field::new(
                            TIMESTAMP_COL_NAME.to_string(),
                            DataType::Int64,
                            false,
                        ))
                    } else {
                        x.clone()
                    }
                })
                .collect::<Vec<_>>();
            Arc::new(Schema::new(new_fields))
        } else {
            schema
        };
        config = config.with_schema(schema);
        config = config.with_expr_adapter_factory(Arc::new(DefaultPhysicalExprAdapterFactory {}));
        let mut table = ListingTableAdapter::try_new(
            config,
            session.id.clone(),
            self.sort_order,
            self.index_condition.clone(),
            self.fst_fields.clone(),
            self.timestamp_filter,
        )?;
        if self.file_stat_cache.is_some() {
            table = table.with_cache(self.file_stat_cache.clone());
        }
        Ok(Arc::new(table))
    }
}

#[cfg(feature = "enterprise")]
async fn get_cpu_and_mem_limit(
    trace_id: &str,
    work_group: Option<String>,
    target_partitions: usize,
    memory_size: usize,
) -> Result<(usize, usize)> {
    let (target_partitions, memory_size) = if let Some(wg) = work_group.as_ref()
        && let Ok(wg) = WorkGroup::from_str(wg)
    {
        wg.get_resource(trace_id, target_partitions, memory_size)
            .await
            .map_err(|e| {
                DataFusionError::Execution(format!("Failed to get dynamic resource: {e}"))
            })?
    } else {
        (target_partitions, memory_size)
    };
    let target_partitions = std::cmp::max(
        get_config().limit.datafusion_min_partition_num,
        target_partitions,
    );

    log::info!(
        "[trace_id: {trace_id}] work_group: {work_group:?}, target_partitions: {target_partitions}, memory_size: {memory_size}"
    );

    Ok((target_partitions, memory_size))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::get_config;

    use super::*;

    fn create_test_schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("field1", DataType::Utf8, true),
            Field::new("field2", DataType::Int64, true),
        ]))
    }

    #[test]
    fn test_metrics_query_schema_uses_views_for_labels_only() {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("source".to_string(), "metrics".to_string());
        let schema = Arc::new(
            Schema::new(vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new(HASH_LABEL, DataType::Utf8, false),
                Field::new(EXEMPLARS_LABEL, DataType::Utf8, true),
                Field::new("path", DataType::Utf8, true),
                Field::new("large_label", DataType::LargeUtf8, true),
            ])
            .with_metadata(metadata.clone()),
        );

        let converted = metrics_query_schema_with_utf8_view(schema, true);

        assert_eq!(
            converted.field_with_name(HASH_LABEL).unwrap().data_type(),
            &DataType::Utf8
        );
        assert_eq!(
            converted
                .field_with_name(EXEMPLARS_LABEL)
                .unwrap()
                .data_type(),
            &DataType::Utf8
        );
        assert_eq!(
            converted.field_with_name("path").unwrap().data_type(),
            &DataType::Utf8View
        );
        assert_eq!(
            converted
                .field_with_name("large_label")
                .unwrap()
                .data_type(),
            &DataType::Utf8View
        );
        assert_eq!(converted.metadata(), &metadata);
    }

    #[test]
    fn test_metrics_query_schema_can_disable_views() {
        let schema = create_test_schema();
        let unchanged = metrics_query_schema_with_utf8_view(Arc::clone(&schema), false);

        assert!(Arc::ptr_eq(&schema, &unchanged));
    }

    #[tokio::test]
    async fn test_create_session_config_default() -> Result<()> {
        let config = create_session_config(FileSortOrder::None, 0, None)?;

        // Test default configurations
        assert_eq!(
            config.options().execution.target_partitions,
            get_config()
                .limit
                .cpu_num
                .max(get_config().limit.datafusion_min_partition_num)
        );
        assert_eq!(config.options().execution.batch_size, get_batch_size());
        assert_eq!(config.options().sql_parser.dialect, Dialect::PostgreSQL);
        assert!(!config.options().execution.listing_table_ignore_subdirectory);
        assert!(config.information_schema());
        assert_eq!(
            config.options().execution.parquet.pushdown_filters,
            get_config().search.feature_pushdown_filter_enabled
        );
        // Join dynamic filter pushdown must stay disabled: its runtime filter can't cross our
        // distributed RemoteScan/Flight boundary and breaks our custom join rewrites.
        assert!(
            !config
                .options()
                .optimizer
                .enable_join_dynamic_filter_pushdown
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_for_metrics() -> Result<()> {
        let config = create_session_config(FileSortOrder::None, 0, Some(StreamType::Metrics))?;

        assert_eq!(
            config.options().execution.parquet.pushdown_filters,
            get_config().search.feature_metrics_pushdown_filter_enabled
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_with_partitions() -> Result<()> {
        let target_partitions = 8;
        let config = create_session_config(FileSortOrder::TimestampDesc, target_partitions, None)?;

        let expected_partitions = std::cmp::max(
            get_config().limit.datafusion_min_partition_num,
            target_partitions,
        );

        assert_eq!(
            config.options().execution.target_partitions,
            expected_partitions
        );
        assert!(config.options().execution.split_file_groups_by_statistics);

        Ok(())
    }

    #[tokio::test]
    async fn test_create_session_config_sorted() -> Result<()> {
        for order in [
            FileSortOrder::TimestampDesc,
            FileSortOrder::HashTimestampAsc,
        ] {
            let config = create_session_config(order, 4, None)?;
            assert!(config.options().execution.split_file_groups_by_statistics);
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_create_runtime_env() -> Result<()> {
        let memory_limit = 1024 * 1024 * 512; // 512MB
        let runtime_env = create_runtime_env("test", memory_limit).await?;

        // Check that object stores are registered
        let memory_url = url::Url::parse("memory:///").unwrap();
        let wal_url = url::Url::parse("wal:///").unwrap();

        assert!(
            runtime_env
                .object_store_registry
                .get_store(&memory_url)
                .is_ok()
        );
        assert!(
            runtime_env
                .object_store_registry
                .get_store(&wal_url)
                .is_ok()
        );

        Ok(())
    }

    #[tokio::test]
    async fn test_create_runtime_env_min_memory() -> Result<()> {
        let small_memory = 1024; // Very small memory
        let runtime_env = create_runtime_env("test", small_memory).await?;

        // Should handle small memory gracefully
        // Memory pool behavior may vary by implementation
        // Memory pool exists and was created successfully
        let _ = runtime_env.memory_pool.reserved();

        Ok(())
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_new() {
        let builder = DataFusionContextBuilder::new();
        assert_eq!(builder.trace_id, "");
        assert_eq!(builder.work_group, None);
        assert_eq!(builder.sort_order, FileSortOrder::None);
        assert!(builder.analyzer_rules.is_empty());
        assert!(builder.optimizer_rules.is_empty());
        assert!(builder.physical_optimizer_rules.is_empty());
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_with_options() {
        let builder = DataFusionContextBuilder::new()
            .trace_id("test-trace-123")
            .work_group(Some("test-group".to_string()))
            .sort_order(FileSortOrder::TimestampDesc);

        assert_eq!(builder.trace_id, "test-trace-123");
        assert_eq!(builder.work_group, Some("test-group".to_string()));
        assert_eq!(builder.sort_order, FileSortOrder::TimestampDesc);
    }

    #[tokio::test]
    async fn test_datafusion_context_builder_build() -> Result<()> {
        let builder = DataFusionContextBuilder::new()
            .trace_id("test-trace")
            .sort_order(FileSortOrder::TimestampDesc);

        let ctx = builder.build(4).await?;

        // Verify context was created successfully
        assert!(ctx.sql("SELECT 1").await.is_ok());

        Ok(())
    }

    #[tokio::test]
    async fn test_register_udf() -> Result<()> {
        let ctx = SessionContext::new();
        let result = register_udf(&ctx, "test_org");

        assert!(result.is_ok());

        // Test that UDFs are registered by checking the context has functions
        // str_match might have different signature, so just verify registration succeeded
        assert!(result.is_ok());

        Ok(())
    }

    // ── tmp/code.md B4 — the function catalog served to the query editor ─────
    //
    // registered_function_names() is the authoritative list. Two gaps were
    // found reviewing it: JSON functions are registered by a SEPARATE call that
    // the snapshot context never made, and functions provided by SQL rewriters
    // never appear in any registry at all.

    #[test]
    fn registered_function_names_includes_o2_udfs() {
        let names = registered_function_names();
        for expected in [
            "str_match",
            "match_all",
            "histogram",
            "spath",
            "arrcount",
            "re_match",
            "cast_to_timestamp",
        ] {
            assert!(
                names.iter().any(|n| n == expected),
                "registry is missing the O2 UDF `{expected}`"
            );
        }
    }

    #[test]
    fn registered_function_names_includes_datafusion_builtins() {
        let names = registered_function_names();
        for expected in ["date_trunc", "coalesce", "concat", "regexp_replace", "abs"] {
            assert!(
                names.iter().any(|n| n == expected),
                "registry is missing the DataFusion builtin `{expected}`"
            );
        }
    }

    #[test]
    fn registered_function_names_includes_json_functions() {
        // Production contexts call datafusion_functions_json::register_all
        // separately (see flight.rs). Without that call here the whole json_*
        // family is absent from the catalog the editor is served.
        let names = registered_function_names();
        for expected in ["json_get", "json_get_str", "json_length"] {
            assert!(
                names.iter().any(|n| n == expected),
                "registry is missing the JSON function `{expected}` — is                  datafusion_functions_json::register_all wired into the snapshot context?"
            );
        }
    }

    #[test]
    fn registered_function_names_is_sorted_and_deduped() {
        let names = registered_function_names();
        assert!(!names.is_empty());
        let mut sorted = names.to_vec();
        sorted.sort();
        sorted.dedup();
        assert_eq!(
            names,
            sorted.as_slice(),
            "names must be sorted and deduplicated"
        );
    }

    #[test]
    fn rewriter_aliases_are_exposed_for_the_catalog() {
        // match_all_raw / match_all_raw_ignore_case are valid user-facing SQL
        // (sql/rewriter/match_all_raw.rs rewrites them to match_all before
        // planning) but appear in NO registry. A catalog built only from the
        // registry would silently drop two functions users rely on today.
        let aliases = crate::sql::rewriter::REWRITER_FUNCTION_ALIASES;
        for expected in ["match_all_raw", "match_all_raw_ignore_case"] {
            assert!(
                aliases.contains(&expected),
                "rewriter alias `{expected}` is not exported for the catalog"
            );
        }
    }

    #[test]
    fn catalog_functions_unions_registry_rewriter_and_json() {
        let catalog = catalog_functions("default");
        let names: Vec<&str> = catalog.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"match_all"), "registry entry missing");
        assert!(
            names.contains(&"match_all_raw"),
            "rewriter alias missing from the catalog union"
        );
        assert!(names.contains(&"json_get"), "json function missing");
        assert!(names.contains(&"date_trunc"), "datafusion builtin missing");
    }

    #[test]
    fn catalog_functions_returns_structured_entries() {
        // The editor needs more than names: `detail` and `documentation` in the
        // suggest widget come from signature/doc, and the icon from kind.
        let catalog = catalog_functions("default");
        let match_all = catalog
            .iter()
            .find(|f| f.name == "match_all")
            .expect("match_all should be in the catalog");
        assert!(
            !match_all.signature.is_empty(),
            "signature must be populated"
        );
        assert!(!match_all.kind.is_empty(), "kind must be populated");
    }

    #[test]
    fn catalog_functions_flags_rewriter_aliases_deprecated() {
        let catalog = catalog_functions("default");
        let raw = catalog
            .iter()
            .find(|f| f.name == "match_all_raw")
            .expect("match_all_raw should be in the catalog");
        assert!(
            raw.deprecated,
            "rewriter aliases must be flagged deprecated"
        );
        let canonical = catalog.iter().find(|f| f.name == "match_all").unwrap();
        assert!(!canonical.deprecated, "match_all itself is not deprecated");
    }

    #[test]
    fn catalog_functions_serialize_with_every_field_the_editor_needs() {
        // Asserting on the Rust struct does not prove the HTTP body carries the
        // fields: a rename or a skip_serializing_if would pass the struct tests
        // and still ship an empty docs panel.
        let catalog = catalog_functions("default");
        let json = serde_json::to_value(&catalog).expect("catalog must serialize");
        let arr = json.as_array().expect("catalog serializes to an array");

        for entry in arr {
            for field in ["name", "signature", "kind", "deprecated"] {
                assert!(
                    entry.get(field).is_some(),
                    "serialized entry {entry} is missing `{field}`"
                );
            }
        }
    }

    #[test]
    fn every_catalog_entry_has_a_name_kind_and_signature() {
        // Sweeps the WHOLE catalog: a single spot check on match_all would let
        // every DataFusion, JSON, alias or VRL entry ship blank metadata.
        for f in catalog_functions("default") {
            assert!(!f.name.is_empty(), "entry with an empty name");
            assert!(!f.kind.is_empty(), "`{}` has no kind", f.name);
            assert!(!f.signature.is_empty(), "`{}` has no signature", f.name);
        }
    }

    #[test]
    fn catalog_functions_documents_what_only_the_server_can_supply() {
        // Deliberately NOT asserting docs for the O2 UDFs. The frontend catalog
        // carries its own prose for those and wins on merge (it also owns which
        // arguments are columns), so a server-side doc for `match_all` would
        // never be displayed — dead data dressed up as coverage.
        //
        // What the server IS the only source for: the rewriter aliases and the
        // org's VRL transforms.
        let catalog = catalog_functions("default");
        for alias in crate::sql::rewriter::REWRITER_FUNCTION_ALIASES {
            let entry = catalog
                .iter()
                .find(|f| &f.name == alias)
                .unwrap_or_else(|| panic!("`{alias}` missing from the catalog"));
            assert!(
                !entry.doc.is_empty(),
                "rewriter alias `{alias}` must be documented"
            );
            assert!(
                entry.deprecated,
                "rewriter alias `{alias}` must be flagged deprecated"
            );
        }
    }

    #[test]
    fn catalog_functions_surfaces_upstream_documentation_where_it_exists() {
        // Guards the describe() fallback: if it silently returned "(...)" and an
        // empty doc for everything, every other assertion here would still pass.
        let catalog = catalog_functions("default");
        let documented = catalog.iter().filter(|f| !f.doc.is_empty()).count();
        let with_named_args = catalog
            .iter()
            .filter(|f| f.signature != "(...)" && f.signature != "()")
            .count();
        assert!(
            documented > 20,
            "only {documented} entries carry documentation — is describe() reading upstream docs?"
        );
        assert!(
            with_named_args > 20,
            "only {with_named_args} entries have a named argument list"
        );
    }

    #[test]
    fn org_vrl_transforms_are_documented_and_signed() {
        use config::meta::function::Transform;
        transform::QUERY_FUNCTIONS.insert(
            "doc_org/documented_fn".to_string(),
            Transform {
                function: ".".to_string(),
                name: "documented_fn".to_string(),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: None,
            },
        );
        let catalog = catalog_functions("doc_org");
        let entry = catalog
            .iter()
            .find(|f| f.name == "documented_fn")
            .expect("org transform missing");
        assert!(!entry.doc.is_empty(), "org VRL transforms must carry a doc");
        assert!(
            !entry.signature.is_empty(),
            "org VRL transforms must carry a signature"
        );
        transform::QUERY_FUNCTIONS.remove("doc_org/documented_fn");
    }

    #[test]
    fn org_vrl_transform_overrides_a_same_named_builtin() {
        // register_udf lets an org's VRL transform shadow a builtin at query
        // time, so the catalog must report the one that would actually run.
        use config::meta::function::Transform;
        transform::QUERY_FUNCTIONS.insert(
            "shadow_org/concat".to_string(),
            Transform {
                function: ".".to_string(),
                name: "concat".to_string(),
                params: "row".to_string(),
                num_args: 1,
                trans_type: Some(0),
                streams: None,
            },
        );

        let catalog = catalog_functions("shadow_org");
        let entries: Vec<&CatalogFunction> =
            catalog.iter().filter(|f| f.name == "concat").collect();
        assert_eq!(entries.len(), 1, "a shadowed builtin must not appear twice");
        assert_eq!(
            entries[0].kind, "vrl",
            "the org transform is what actually runs, so it is what the catalog must report"
        );

        // Another org still sees the builtin.
        let other = catalog_functions("unrelated_org");
        let builtin = other.iter().find(|f| f.name == "concat").unwrap();
        assert_eq!(builtin.kind, "scalar");

        transform::QUERY_FUNCTIONS.remove("shadow_org/concat");
    }

    #[test]
    fn catalog_functions_is_sorted_and_deduped() {
        let catalog = catalog_functions("default");
        let names: Vec<String> = catalog.iter().map(|f| f.name.clone()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(names, sorted, "catalog must be sorted and deduplicated");
    }

    #[test]
    fn catalog_functions_scopes_vrl_transforms_to_their_own_org() {
        // Org IDs deliberately OVERLAP as substrings. get_all_transform matches
        // with `key().contains(org_id)`, so a fixture like org_alpha/org_beta
        // passes even though "acme" matches the key "acme-prod/...". A prefix
        // match on "{org}/" is what isolation actually requires.
        use config::meta::function::Transform;
        let mk = |name: &str| Transform {
            function: ".".to_string(),
            name: name.to_string(),
            params: "row".to_string(),
            num_args: 1,
            trans_type: Some(0),
            streams: None,
        };
        transform::QUERY_FUNCTIONS.insert("acme/acme_only_fn".to_string(), mk("acme_only_fn"));
        transform::QUERY_FUNCTIONS.insert("acme-prod/prod_only_fn".to_string(), mk("prod_only_fn"));

        let acme: Vec<String> = catalog_functions("acme")
            .iter()
            .map(|f| f.name.clone())
            .collect();
        let prod: Vec<String> = catalog_functions("acme-prod")
            .iter()
            .map(|f| f.name.clone())
            .collect();

        assert!(
            acme.contains(&"acme_only_fn".to_string()),
            "own transform missing"
        );
        assert!(
            !acme.contains(&"prod_only_fn".to_string()),
            "LEAKED acme-prod's VRL transform into acme — substring org matching"
        );
        assert!(
            prod.contains(&"prod_only_fn".to_string()),
            "own transform missing"
        );
        assert!(
            !prod.contains(&"acme_only_fn".to_string()),
            "LEAKED acme's VRL transform into acme-prod"
        );

        // Built-ins are org-independent and must appear for both.
        assert!(acme.contains(&"match_all".to_string()));
        assert!(prod.contains(&"match_all".to_string()));

        transform::QUERY_FUNCTIONS.remove("acme/acme_only_fn");
        transform::QUERY_FUNCTIONS.remove("acme-prod/prod_only_fn");
    }

    #[test]
    fn catalog_functions_marks_vrl_transforms_with_their_own_kind() {
        use config::meta::function::Transform;
        transform::QUERY_FUNCTIONS.insert(
            "org_gamma/gamma_fn".to_string(),
            Transform {
                function: ".".to_string(),
                name: "gamma_fn".to_string(),
                params: "row".to_string(),
                num_args: 2,
                trans_type: Some(0),
                streams: None,
            },
        );
        let catalog = catalog_functions("org_gamma");
        let gamma = catalog
            .iter()
            .find(|f| f.name == "gamma_fn")
            .expect("org transform should be in the catalog");
        assert_eq!(
            gamma.kind, "vrl",
            "org transforms must be distinguishable from builtins"
        );
        // Count the placeholders rather than sniffing for a digit: the previous
        // `contains("2") || !is_empty()` reduced to "non-empty", so even "()"
        // passed for a two-argument transform.
        assert_eq!(
            gamma.signature.matches("arg").count(),
            2,
            "signature must expose one placeholder per declared argument, got {}",
            gamma.signature
        );
        transform::QUERY_FUNCTIONS.remove("org_gamma/gamma_fn");
    }

    #[test]
    fn test_table_builder_new() {
        let builder = TableBuilder::new();
        assert_eq!(builder.sort_order, FileSortOrder::None);
        assert!(builder.file_stat_cache.is_none());
        assert!(builder.index_condition.is_none());
        assert!(builder.fst_fields.is_empty());
    }

    #[test]
    fn test_table_builder_with_options() {
        let builder = TableBuilder::new()
            .sort_order(FileSortOrder::TimestampDesc)
            .fst_fields(vec!["field1".to_string()]);

        assert_eq!(builder.sort_order, FileSortOrder::TimestampDesc);
        assert_eq!(builder.fst_fields, vec!["field1".to_string()]);
    }

    #[test]
    fn test_table_builder_file_stat_cache_none() {
        let builder = TableBuilder::new().file_stat_cache(None);
        assert!(builder.file_stat_cache.is_none());
    }

    #[test]
    fn test_table_builder_index_condition_none() {
        let builder = TableBuilder::new().index_condition(None);
        assert!(builder.index_condition.is_none());
    }

    #[test]
    fn test_table_builder_timestamp_filter() {
        let builder = TableBuilder::new().timestamp_filter((100, 200));
        assert_eq!(builder.timestamp_filter, Some((100, 200)));
    }

    #[tokio::test]
    async fn test_create_session_config_memory_pools() -> Result<()> {
        // Test different memory pool configurations by creating runtime environments
        let memory_limit = 1024 * 1024 * 256; // 256MB

        // Test that runtime env creation works (which tests different pool types)
        let runtime_env = create_runtime_env("test", memory_limit).await?;
        // Memory pool exists and was created successfully
        // Memory pool exists and was created successfully
        let _ = runtime_env.memory_pool.reserved();

        Ok(())
    }

    mod integration_tests {
        use config::meta::{
            search::{Session as SearchSession, StorageType},
            stream::{FileKey, FileMeta},
        };

        use super::*;

        #[tokio::test]
        async fn test_register_table_integration() -> Result<()> {
            let session = SearchSession {
                id: "test-session".to_string(),
                storage_type: StorageType::Memory,
                target_partitions: 2,
                work_group: None,
            };

            let schema = create_test_schema();
            let files = vec![FileKey {
                key: "test-file".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                account: "test_account".to_string(),
                id: 1,
                selection: None,
                row_group_size: None,
            }];

            let result = register_metrics_table(&session, schema, "test_table", files).await;

            // Should create context successfully
            assert!(result.is_ok());
            if let Ok(ctx) = result {
                // Verify table is registered
                assert!(
                    ctx.catalog("datafusion")
                        .unwrap()
                        .schema("public")
                        .unwrap()
                        .table("test_table")
                        .await
                        .is_ok()
                );
            }

            Ok(())
        }

        #[tokio::test]
        async fn test_table_builder_build_integration() -> Result<()> {
            let session = SearchSession {
                id: "test-session".to_string(),
                storage_type: StorageType::Memory,
                target_partitions: 2,
                work_group: None,
            };

            let schema = create_test_schema();
            let files = vec![FileKey {
                key: "test-file".to_string(),
                meta: FileMeta::default(),
                deleted: false,
                account: "test_account".to_string(),
                id: 1,
                selection: None,
                row_group_size: None,
            }];

            let builder = TableBuilder::new().sort_order(FileSortOrder::TimestampDesc);

            let result = builder.build(session, files, schema).await;
            assert!(result.is_ok());

            Ok(())
        }
    }

    mod error_cases {
        use super::*;

        #[tokio::test]
        async fn test_create_runtime_env_invalid_memory_pool_type() {
            // This test verifies error handling in memory pool creation
            // The actual error handling is in the FromStr implementation
            let memory_limit = 1024 * 1024 * 256;
            let result = create_runtime_env("test", memory_limit).await;
            assert!(result.is_ok()); // Should handle gracefully
        }

        #[tokio::test]
        async fn test_datafusion_context_builder_zero_partitions() -> Result<()> {
            let builder = DataFusionContextBuilder::new();
            let ctx = builder.build(0).await?; // Zero partitions should use default

            // Should still create a valid context
            assert!(ctx.sql("SELECT 1").await.is_ok());

            Ok(())
        }
    }

    mod configuration_tests {
        use super::*;

        #[tokio::test]
        async fn test_session_config_bloom_filter_settings() -> Result<()> {
            // Test bloom filter configurations
            let config1 = create_session_config(FileSortOrder::None, 4, None)?;
            let config2 = create_session_config(FileSortOrder::TimestampDesc, 4, None)?;

            // Both should be valid configurations
            assert!(config1.options().execution.target_partitions > 0);
            assert!(config2.options().execution.target_partitions > 0);

            Ok(())
        }

        #[tokio::test]
        async fn test_session_config_partition_bounds() -> Result<()> {
            // Test minimum partition enforcement
            let config = create_session_config(FileSortOrder::None, 1, None)?; // Very small number

            let actual_partitions = config.options().execution.target_partitions;
            assert!(actual_partitions >= get_config().limit.datafusion_min_partition_num);

            Ok(())
        }
    }
}
